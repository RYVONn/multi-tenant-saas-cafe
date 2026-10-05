const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── GET /api/inventory/consumption ──────────────────────────────────────────

const getConsumptionLogs = async (req, res) => {
  try {
    const { shiftId } = req.query;
    const logs = await prisma.consumptionLog.findMany({
      where: shiftId ? { shiftId } : undefined,
      include: {
        items: { include: { item: true } },
        shift: { select: { id: true, type: true, status: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(logs);
  } catch (err) {
    console.error('getConsumptionLogs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── POST /api/inventory/consumption ─────────────────────────────────────────

const createConsumptionLog = async (req, res) => {
  try {
    const { shiftId, notes, items } = req.body;

    if (!shiftId)
      return res.status(400).json({ error: 'shiftId is required' });
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'items array is required' });

    for (const i of items) {
      const hasItem = i.itemId || (i.customName && i.customName.trim());
      if (!hasItem)
        return res.status(400).json({ error: 'Each item needs itemId or customName' });
      if (!i.quantity || i.quantity <= 0)
        return res.status(400).json({ error: 'Each item needs quantity > 0' });
    }

    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift)
      return res.status(404).json({ error: 'Shift not found' });
    if (shift.status !== 'open')
      return res.status(400).json({ error: 'Cannot log consumption for a closed shift' });
    if (shift.staffId !== req.user.id)
      return res.status(403).json({ error: 'Not your shift' });

    // Split items into inventory vs custom
    const inventoryItems = items.filter(i => i.itemId && !i.customName?.trim());
    const customItems    = items.filter(i => !i.itemId && i.customName?.trim());

    // Validate stock availability for inventory items
    if (inventoryItems.length > 0) {
      const stockItems = await prisma.stockItem.findMany({
        where: { id: { in: inventoryItems.map(i => i.itemId) } }
      });

      for (const i of inventoryItems) {
        const stock = stockItems.find(s => s.id === i.itemId);
        if (!stock)
          return res.status(404).json({ error: `Stock item not found: ${i.itemId}` });
        if (stock.quantity < i.quantity)
          return res.status(400).json({
            error: `Not enough stock for "${stock.name}" — available: ${stock.quantity} ${stock.unit}, requested: ${i.quantity}`
          });
      }
    }

    const actorId   = req.user.id;
    const actorRole = req.user.role ?? 'staff';
    const actorName = req.user.shift_name ?? req.user.name ?? 'Staff';

    const log = await prisma.$transaction(async (tx) => {
      const created = await tx.consumptionLog.create({
        data: {
          shiftId,
          notes: notes ?? null,
          items: {
            create: [
              // Inventory items — itemId set, customName null
              ...inventoryItems.map(i => ({
                itemId:     i.itemId,
                customName: null,
                quantity:   i.quantity,
              })),
              // Custom items — itemId null, customName set
              ...customItems.map(i => ({
                itemId:     null,
                customName: i.customName.trim(),
                quantity:   i.quantity,
              })),
            ]
          }
        },
        include: {
          items: { include: { item: true } },
          shift: { select: { id: true, type: true } }
        }
      });

      // Deduct stock + write movement + audit for inventory items only
      for (const i of inventoryItems) {
        const stock = await tx.stockItem.findUnique({ where: { id: i.itemId } });
        if (!stock) continue;

        const qtyBefore = stock.quantity;
        const qtyAfter  = Math.max(0, qtyBefore - i.quantity);

        await tx.stockItem.update({
          where: { id: i.itemId },
          data: {
            quantity:     { decrement: i.quantity },
            packageCount: { decrement: i.quantity },
          }
        });

        await tx.inventoryMovement.create({
          data: {
            itemId:      i.itemId,
            type:        'consumption',
            quantity:    -i.quantity,
            qtyBefore,
            qtyAfter,
            actorId,
            actorRole,
            actorName,
            referenceId: created.id,
            notes:       `Shift consumption — ${shiftId}`,
          }
        }).catch(e => console.error('Movement write failed (non-fatal):', e));

        await tx.stockAuditLog.create({
          data: {
            itemId:         i.itemId,
            action:         'consumption',
            quantityBefore: qtyBefore,
            quantityAfter:  qtyAfter,
            delta:          -i.quantity,
            actorId,
            actorRole,
            notes:          `ConsumptionLog ${created.id} — shift ${shiftId}`,
          }
        }).catch(e => console.error('Audit log write failed (non-fatal):', e));
      }

      return created;
    });

    // Notify inventory managers (non-fatal)
    try {
      const { createNotification } = require('./notifications.controller');
      const io = req.app.get('io');

      const itemSummary = log.items
        .slice(0, 2)
        .map(i => i.item?.name ?? i.customName ?? 'item')
        .join(', ') + (log.items.length > 2 ? ` +${log.items.length - 2} more` : '');

      await createNotification(io, {
        recipientId:   'broadcast',
        recipientRole: 'inventory_manager',
        type:          'consumption_logged',
        title:         `Consumption logged — ${shift.type} shift`,
        body:          `${actorName} used: ${itemSummary}`,
        data:          { logId: log.id, shiftId },
      });
    } catch (notifErr) {
      console.error('Consumption notification error (non-fatal):', notifErr);
    }

    res.status(201).json(log);
  } catch (err) {
    if (err.code === 'P2025')
      return res.status(404).json({ error: 'Stock item not found' });
    console.error('createConsumptionLog error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── DELETE /api/inventory/consumption/:id ────────────────────────────────────

const deleteConsumptionLog = async (req, res) => {
  try {
    const log = await prisma.consumptionLog.findUnique({
      where: { id: req.params.id },
      include: { shift: true }
    });

    if (!log)
      return res.status(404).json({ error: 'Log not found' });
    if (log.shift.status === 'closed')
      return res.status(400).json({ error: 'Cannot delete log from a closed shift' });

    await prisma.consumptionLog.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('deleteConsumptionLog error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getConsumptionLogs, createConsumptionLog, deleteConsumptionLog };