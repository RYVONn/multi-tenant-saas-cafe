/**
 * override-consumption.controller.js
 *
 * POST /api/inventory/shifts/:shiftId/override-consumption
 *
 * Allows Inventory Managers and Managers to manually assign
 * consumption to a specific shift (e.g. when staff forgot to log it).
 *
 * Body:
 *   {
 *     items: [{ itemId: string; quantity: number }],
 *     notes?: string,
 *     overrideDate?: string   // ISO date string, defaults to now
 *   }
 *
 * Creates:
 *   - ConsumptionLog  (attached to the shift)
 *   - ConsumptionLogItem rows (with isManagerOverride = true)
 *   - InventoryMovement rows (type = "SHIFT_USAGE", notes includes override marker)
 *   - StockAuditLog rows
 *   - Deducts packageCount / quantity from StockItem
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const overrideShiftConsumption = async (req, res) => {
  try {
    const { id: shiftId } = req.params;
    const { items, notes, overrideDate } = req.body;

    // ── Validate ─────────────────────────────────────────────────────────────
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required and must not be empty' });
    }

    for (const it of items) {
      if (!it.itemId || typeof it.quantity !== 'number' || it.quantity <= 0) {
        return res.status(400).json({ error: 'Each item must have itemId and a positive quantity' });
      }
    }

    // ── Verify shift exists ───────────────────────────────────────────────────
    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
    });
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    // ── Fetch stock items ─────────────────────────────────────────────────────
    const itemIds = items.map(i => i.itemId);
    const stockItems = await prisma.stockItem.findMany({
      where: { id: { in: itemIds } },
    });

    const stockMap = Object.fromEntries(stockItems.map(s => [s.id, s]));

    // Check all items exist and have sufficient stock
    for (const it of items) {
      const stock = stockMap[it.itemId];
      if (!stock) {
        return res.status(404).json({ error: `Stock item ${it.itemId} not found` });
      }
      if (stock.packageCount < it.quantity) {
        return res.status(400).json({
          error: `Insufficient stock for ${stock.name}: available ${stock.packageCount}, requested ${it.quantity}`,
        });
      }
    }

    // ── Manager info ──────────────────────────────────────────────────────────
    const actorId   = req.user.id;
    const actorName = req.user.name ?? req.user.email ?? 'Manager';
    const actorRole = req.user.role ?? 'inventory_manager';

    const effectiveDate = overrideDate ? new Date(overrideDate) : new Date();
    const overrideMarker = 'Inventory Manager Override';
    const fullNotes = notes
      ? `[${overrideMarker}] ${notes}`
      : `[${overrideMarker}]`;

    // ── Transactionally create everything ─────────────────────────────────────
    const result = await prisma.$transaction(async tx => {
      // 1. Create ConsumptionLog attached to the shift
      const log = await tx.consumptionLog.create({
        data: {
          shiftId,
          notes: fullNotes,
          createdAt: effectiveDate,
          items: {
            create: items.map(it => ({
              itemId:            it.itemId,
              quantity:          it.quantity,
              // Store override metadata in customName field as a JSON marker
              // (avoids schema migration — parsed by the frontend)
              customName: JSON.stringify({
                __override: true,
                overrideBy:   actorName,
                overrideRole: actorRole,
                overrideDate: effectiveDate.toISOString(),
              }),
            })),
          },
        },
        include: { items: { include: { item: true } } },
      });

      // 2. Update stock levels and create movement records for each item
      const movements = [];
      for (const it of items) {
        const stock = stockMap[it.itemId];
        const newPackageCount = Math.max(0, stock.packageCount - it.quantity);
        const newQuantity     = stock.packageSize
          ? newPackageCount * stock.packageSize
          : newPackageCount;

        // Deduct stock
        await tx.stockItem.update({
          where: { id: it.itemId },
          data: {
            packageCount: newPackageCount,
            quantity:     newQuantity,
            updatedAt:    new Date(),
          },
        });

        // InventoryMovement
        const movement = await tx.inventoryMovement.create({
          data: {
            itemId:      it.itemId,
            type:        'SHIFT_USAGE',
            quantity:    -it.quantity,
            qtyBefore:   stock.packageCount,
            qtyAfter:    newPackageCount,
            actorId,
            actorRole,
            actorName,
            referenceId: log.id,
            notes:       fullNotes,
            createdAt:   effectiveDate,
          },
        });
        movements.push(movement);

        // StockAuditLog
        await tx.stockAuditLog.create({
          data: {
            itemId:         it.itemId,
            action:         'OVERRIDE_CONSUMPTION',
            quantityBefore: stock.packageCount,
            quantityAfter:  newPackageCount,
            delta:          -it.quantity,
            actorId,
            actorRole,
            notes:          fullNotes,
            createdAt:      effectiveDate,
          },
        });

        // Keep local map in sync for subsequent iterations in same transaction
        stockMap[it.itemId] = { ...stock, packageCount: newPackageCount, quantity: newQuantity };
      }

      return { log, movements };
    });

    return res.status(201).json({
      success:    true,
      message:    'Consumption assigned to shift successfully',
      logId:      result.log.id,
      shiftId,
      itemsCount: items.length,
      movements:  result.movements.length,
    });

  } catch (err) {
    console.error('overrideShiftConsumption error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};

// ─── GET /api/inventory/shifts/:shiftId/consumption ───────────────────────────
// Returns all consumption logs for a shift, flagging override entries
const getShiftConsumption = async (req, res) => {
  try {
  const { id: shiftId } = req.params;

    const logs = await prisma.consumptionLog.findMany({
      where: { shiftId },
      include: {
        items: {
          include: { item: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Parse override metadata from customName JSON
    const enriched = logs.map(log => ({
      ...log,
      isManagerOverride: log.notes?.includes('[Inventory Manager Override]') ?? false,
      items: log.items.map(item => {
        let overrideMeta = null;
        if (item.customName) {
          try {
            const parsed = JSON.parse(item.customName);
            if (parsed.__override) overrideMeta = parsed;
          } catch { /* not JSON, leave as-is */ }
        }
        return { ...item, overrideMeta };
      }),
    }));

    return res.json(enriched);
  } catch (err) {
    console.error('getShiftConsumption error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { overrideShiftConsumption, getShiftConsumption };