const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET /api/inventory/issuances
const getAllIssuances = async (req, res) => {
  try {
    const { shiftId, from, to } = req.query;

    const where = {
      ...(shiftId && { shiftId }),
      ...((from || to) && {
        createdAt: {
          ...(from && { gte: new Date(from) }),
          ...(to   && { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) }),
        },
      }),
    };

    const issuances = await prisma.shiftIssuance.findMany({
      where,
      include: {
        items:   { include: { item: true } },
        shift:   { select: { id: true, type: true, status: true } },
        manager: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(issuances);
  } catch (err) {
    console.error('getAllIssuances error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/inventory/issuances
const createIssuance = async (req, res) => {
  try {
    const { shiftId, notes, items } = req.body;
    const managerId  = req.user.id;
    const actorName  = req.user.name ?? 'Inventory Manager';
    const actorRole  = req.user.role ?? 'inventory_manager';

    if (!shiftId)
      return res.status(400).json({ error: 'shiftId is required' });
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ error: 'items array is required' });
    for (const i of items) {
      if (!i.itemId || !i.quantity || i.quantity <= 0)
        return res.status(400).json({ error: 'Each item needs itemId and quantity > 0' });
    }

    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      include: { staff: { select: { id: true, shift_name: true } } },
    });
    if (!shift)       return res.status(404).json({ error: 'Shift not found' });
    if (shift.status !== 'open')
      return res.status(400).json({ error: 'Shift is already closed' });

    // ── Validate stock availability before touching anything ──────────────
    for (const i of items) {
      const stock = await prisma.stockItem.findUnique({ where: { id: i.itemId } });
      if (!stock)
        return res.status(404).json({ error: `Stock item ${i.itemId} not found` });
      if (stock.packageCount < i.quantity)
        return res.status(400).json({
          error: `Not enough stock for "${stock.name}" — available: ${stock.packageCount} ${stock.unit}`,
        });
    }

    // ── Transaction: create issuance + deduct stock + audit + movements ───
    const issuance = await prisma.$transaction(async tx => {
      const created = await tx.shiftIssuance.create({
        data: {
          shiftId,
          managerId,
          notes,
          items: {
            create: items.map(i => ({ itemId: i.itemId, quantity: i.quantity })),
          },
        },
        include: {
          items:   { include: { item: true } },
          shift:   { select: { id: true, type: true } },
          manager: { select: { id: true, name: true } },
        },
      });

      for (const i of items) {
        const stock = await tx.stockItem.findUnique({ where: { id: i.itemId } });
        const qtyBefore = stock.quantity;
        const qtyAfter  = Math.max(0, qtyBefore - i.quantity);

        await tx.stockItem.update({
          where: { id: i.itemId },
          data:  {
            quantity:     { decrement: i.quantity },
            packageCount: { decrement: i.quantity },
          },
        });

        await tx.inventoryMovement.create({
          data: {
            itemId:      i.itemId,
            type:        'ISSUANCE',
            quantity:    -i.quantity,
            qtyBefore,
            qtyAfter,
            actorId:     managerId,
            actorRole,
            actorName,
            referenceId: created.id,
            notes:       `Issued to ${shift.type} shift (${shiftId})${notes ? ` — ${notes}` : ''}`,
          },
        });

        await tx.stockAuditLog.create({
          data: {
            itemId:         i.itemId,
            action:         'issuance',
            quantityBefore: qtyBefore,
            quantityAfter:  qtyAfter,
            delta:          -i.quantity,
            actorId:        managerId,
            actorRole,
            notes:          `Issuance ${created.id} → shift ${shiftId}`,
          },
        });
      }

      return created;
    });

    // ── Notify shift staff ────────────────────────────────────────────────
    try {
      const { createNotification } = require('./notifications.controller');
      const io = req.app.get('io');
      const staffId   = shift.staff?.id;
      const staffName = shift.staff?.shift_name ?? 'Staff';
      const itemSummary = issuance.items
        .slice(0, 2)
        .map(i => `${i.quantity} ${i.item.unit} ${i.item.name}`)
        .join(', ') + (issuance.items.length > 2 ? ` +${issuance.items.length - 2} more` : '');

      if (staffId) {
        await createNotification(io, {
          recipientId:   staffId,
          recipientRole: 'staff',
          type:          'stock_issued',
          title:         '📦 Stock issued to your shift',
          body:          `${actorName} issued: ${itemSummary}`,
          data:          { issuanceId: issuance.id, shiftId },
        });
      }

      if (io) {
        io.emit('stock_issued', {
          issuanceId: issuance.id,
          shiftId,
          shiftType:  shift.type,
          staffName,
          items:      issuance.items.map(i => ({
            name: i.item.name, unit: i.item.unit, quantity: i.quantity,
          })),
          issuedBy: actorName,
        });
      }
    } catch (notifErr) {
      console.error('Issuance notification error (non-fatal):', notifErr);
    }

    res.status(201).json(issuance);
  } catch (err) {
    if (err.code === 'P2025')
      return res.status(404).json({ error: 'Stock item not found' });
    console.error('createIssuance error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/inventory/issuances/:id
// Restores stock quantities (reverses the issuance)
const deleteIssuance = async (req, res) => {
  try {
    const managerId = req.user.id;
    const actorRole = req.user.role ?? 'inventory_manager';
    const actorName = req.user.name ?? 'Inventory Manager';

    const issuance = await prisma.shiftIssuance.findUnique({
      where:   { id: req.params.id },
      include: { items: { include: { item: true } }, shift: true },
    });
    if (!issuance) return res.status(404).json({ error: 'Issuance not found' });

    await prisma.$transaction(async tx => {
      for (const i of issuance.items) {
        const stock     = await tx.stockItem.findUnique({ where: { id: i.itemId } });
        const qtyBefore = stock.quantity;
        const qtyAfter  = qtyBefore + i.quantity;

        await tx.stockItem.update({
          where: { id: i.itemId },
          data:  {
            quantity:     { increment: i.quantity },
            packageCount: { increment: i.quantity },
          },
        });

        await tx.inventoryMovement.create({
          data: {
            itemId:      i.itemId,
            type:        'ISSUANCE_REVERSAL',
            quantity:    i.quantity,
            qtyBefore,
            qtyAfter,
            actorId:     managerId,
            actorRole,
            actorName,
            referenceId: issuance.id,
            notes:       `Issuance ${issuance.id} deleted — stock restored`,
          },
        });

        await tx.stockAuditLog.create({
          data: {
            itemId:         i.itemId,
            action:         'issuance_reversal',
            quantityBefore: qtyBefore,
            quantityAfter:  qtyAfter,
            delta:          i.quantity,
            actorId:        managerId,
            actorRole,
            notes:          `Deleted issuance ${issuance.id}`,
          },
        });
      }

      await tx.shiftIssuance.delete({ where: { id: req.params.id } });
    });

    res.json({ message: 'Issuance deleted and stock restored successfully' });
  } catch (err) {
    if (err.code === 'P2025')
      return res.status(404).json({ error: 'Issuance not found' });
    console.error('deleteIssuance error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getAllIssuances, createIssuance, deleteIssuance };