// BACKEND/src/controllers/inventory-waste.controller.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getAll = async (req, res) => {
  try {
    const waste = await prisma.inventoryWaste.findMany({
      include: { items: { include: { item: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(waste);
  } catch (err) {
    console.error('getAll waste error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const create = async (req, res) => {
  try {
    const { reason, notes, wasteDate, items } = req.body;
    const actorId   = req.user.id;
    const actorRole = req.user.role;
    const actorName = req.user.name ?? req.user.shift_name ?? 'User';

    if (!reason) return res.status(400).json({ error: 'reason is required' });

    let parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    if (!Array.isArray(parsedItems) || !parsedItems.length)
      return res.status(400).json({ error: 'items required' });

    const waste = await prisma.$transaction(async tx => {
      const newWaste = await tx.inventoryWaste.create({
        data: {
          managerId: actorRole === 'inventory_manager' ? actorId : null,
          staffId:   actorRole === 'staff'             ? actorId : null,
          reason,
          notes:     notes || null,
         image: req.file?.filename ?? null,
          wasteDate: wasteDate ? new Date(wasteDate) : new Date(),
          items: {
            create: parsedItems.map(i => ({ itemId: i.itemId, quantity: i.quantity })),
          },
        },
        include: { items: { include: { item: true } } },
      });

      for (const i of parsedItems) {
        const stock = await tx.stockItem.findUnique({ where: { id: i.itemId } });
        if (!stock) throw new Error(`Item not found: ${i.itemId}`);

        const qtyBefore = stock.quantity;
        const qtyAfter  = Math.max(0, qtyBefore - i.quantity);

        // ✅ Keep both quantity AND packageCount in sync
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
            type:        'WASTE',
            quantity:    -i.quantity,
            qtyBefore,
            qtyAfter,
            actorId,
            actorRole,
            actorName,
            referenceId: newWaste.id,
            notes:       reason,
          },
        });

        await tx.stockAuditLog.create({
          data: {
            itemId:         i.itemId,
            action:         'waste',
            quantityBefore: qtyBefore,
            quantityAfter:  qtyAfter,
            delta:          -i.quantity,
            actorId,
            actorRole,
            notes:          `Waste: ${reason}`,
          },
        });
      }

      return newWaste;
    });

    // ── Notify inventory managers + owners about the waste record ─────────────
    try {
      const { createNotification } = require('./notifications.controller');
      const io = req.app.get('io');

      const totalItems = parsedItems.length;
      const itemSummary = waste.items
        .slice(0, 2)
        .map(i => `${i.quantity} ${i.item.unit} ${i.item.name}`)
        .join(', ') + (totalItems > 2 ? ` +${totalItems - 2} more` : '');

      for (const role of ['inventory_manager', 'owner']) {
        await createNotification(io, {
          recipientId:   'broadcast',
          recipientRole: role,
          type:          'waste_logged',
          title:         'Waste record logged',
          body:          `${actorName} logged waste — ${reason}: ${itemSummary}`,
          data:          { wasteId: waste.id },
        });
      }
    } catch (notifErr) {
      console.error('Waste notification error (non-fatal):', notifErr);
    }

    res.status(201).json(waste);
  } catch (err) {
    console.error('create waste error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getAll, create };