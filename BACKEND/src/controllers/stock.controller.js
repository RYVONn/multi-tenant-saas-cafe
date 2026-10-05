'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path   = require('path');
const fs     = require('fs');

const getAllStock = async (req, res) => {
  try {
    const showArchived = req.query.archived === 'true';
    
    // Safe where clause — بيتعامل مع حالة إن isArchived مش موجود بعد
    let whereClause = {};
    try {
      // لو الـ migration اتعملت، فلتر صح
      whereClause = { isArchived: showArchived };
      await prisma.stockItem.findFirst({ where: whereClause, take: 1 });
    } catch (fieldErr) {
      // لو الـ field مش موجود بعد، رجع كل الـ items
      console.warn('[Stock] isArchived field not in schema yet — returning all items');
      whereClause = {};
    }

    const items = await prisma.stockItem.findMany({
      where:   whereClause,
      include: { category: true, supplier: true },
      orderBy: { name: 'asc' },
    });
    res.json(items);
  } catch (err) {
    console.error('getAllStock error:', err);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
};
// ─── POST /api/inventory/stock ────────────────────────────────────────────────
const createStockItem = async (req, res) => {
  try {
    const {
      name, unit, packageSize, measurementUnit,
      packageCount, quantity, minQuantity,
      sku, barcode, categoryId, supplierId,
      purchasePrice, sellingPrice, tax,
      storageLocation, expiryDate, notes,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    if (!unit?.trim()) return res.status(400).json({ error: 'unit is required' });

    const pkgCount = parseFloat(packageCount ?? quantity ?? 0) || 0;

    const item = await prisma.stockItem.create({
      data: {
        name:            name.trim(),
        unit:            unit.trim(),
        packageSize:     packageSize     ? parseFloat(packageSize)     : null,
        measurementUnit: measurementUnit || null,
        packageCount:    pkgCount,
        quantity:        pkgCount,
        minQuantity:     minQuantity ? parseFloat(minQuantity) : 0,
        sku:             sku?.trim()          || null,
        barcode:         barcode?.trim()      || null,
        categoryId:      categoryId           || null,
        supplierId:      supplierId           || null,
        purchasePrice:   purchasePrice  ? parseFloat(purchasePrice)  : null,
        sellingPrice:    sellingPrice   ? parseFloat(sellingPrice)   : null,
        tax:             tax            ? parseFloat(tax)            : null,
        storageLocation: storageLocation || null,
        expiryDate:      expiryDate      ? new Date(expiryDate)      : null,
        notes:           notes           || null,
      },
      include: { category: true, supplier: true },
    });

    res.status(201).json(item);
  } catch (err) {
    console.error('createStockItem error:', err);
    if (err.code === 'P2002') return res.status(409).json({ error: 'An item with this name or SKU already exists' });
    res.status(500).json({ error: err.message ?? 'Server error' });
  }
};

// ─── PATCH /api/inventory/stock/:id ──────────────────────────────────────────
const updateStockItem = async (req, res) => {
  try {
    const { id } = req.params;
    const body   = req.body;
    const data   = {};

    if ('name'             in body) data.name            = body.name?.trim() || undefined;
    if ('unit'             in body) data.unit            = body.unit          || undefined;
    if ('packageSize'      in body) data.packageSize     = body.packageSize     ? parseFloat(body.packageSize)     : null;
    if ('measurementUnit'  in body) data.measurementUnit = body.measurementUnit || null;

    if ('packageCount' in body) {
      const pc = parseFloat(body.packageCount) || 0;
      data.packageCount = pc;
      data.quantity     = pc;
    } else if ('quantity' in body) {
      const q = parseFloat(body.quantity) || 0;
      data.quantity     = q;
      data.packageCount = q;
    }

    if ('minQuantity'     in body) data.minQuantity     = parseFloat(body.minQuantity)    || 0;
    if ('purchasePrice'   in body) data.purchasePrice   = body.purchasePrice  ? parseFloat(body.purchasePrice)  : null;
    if ('sellingPrice'    in body) data.sellingPrice    = body.sellingPrice   ? parseFloat(body.sellingPrice)   : null;
    if ('categoryId'      in body) data.categoryId      = body.categoryId     || null;
    if ('supplierId'      in body) data.supplierId      = body.supplierId     || null;
    if ('storageLocation' in body) data.storageLocation = body.storageLocation || null;
    if ('expiryDate'      in body) data.expiryDate      = body.expiryDate     ? new Date(body.expiryDate)       : null;
    if ('notes'           in body) data.notes           = body.notes          || null;
    if ('sku'             in body) data.sku             = body.sku?.trim()    || null;
    if ('barcode'         in body) data.barcode         = body.barcode?.trim()|| null;
    if ('tax'             in body) data.tax             = body.tax            ? parseFloat(body.tax)            : null;

    const item = await prisma.stockItem.update({
      where:   { id },
      data,
      include: { category: true, supplier: true },
    });

    res.json(item);
  } catch (err) {
    console.error('updateStockItem error:', err);
    if (err.code === 'P2025') return res.status(404).json({ error: 'Item not found' });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Duplicate name or SKU' });
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── PATCH /api/inventory/stock/:id/archive ───────────────────────────────────
// Any inventory manager can archive. Archived items vanish from active lists.
const archiveStockItem = async (req, res) => {
  const { id } = req.params;
  try {
    const item = await prisma.stockItem.findUnique({ where: { id } });
    if (!item)            return res.status(404).json({ error: 'Item not found' });
    if (item.isArchived)  return res.status(400).json({ error: 'Item is already archived' });

    const updated = await prisma.stockItem.update({
      where: { id },
      data:  { isArchived: true, archivedAt: new Date() },
      include: { category: true, supplier: true },
    });

    return res.json({ message: `"${item.name}" archived successfully`, item: updated });
  } catch (err) {
    console.error('archiveStockItem error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};

// ─── DELETE /api/inventory/stock/:id ─────────────────────────────────────────
// Safe delete: blocks if item has any financial/operational history.
// Returns structured ref counts so frontend can show a meaningful message.
const deleteStockItem = async (req, res) => {
  const { id } = req.params;
  try {
    const item = await prisma.stockItem.findUnique({
      where: { id },
      select: {
        id: true, name: true,
        _count: {
          select: {
            movements:           true,
            purchaseReceiptItems: true,
            saleItems:           true,
            consumptionItems:    true,
            auditLogs:           true,
            wasteItems:          true,
            issuanceItems:       true,
            stockRequestItems:   true,
          },
        },
      },
    });

    if (!item) return res.status(404).json({ error: 'Item not found' });

    const refs = {
      movements:    item._count.movements,
      receipts:     item._count.purchaseReceiptItems,
      sales:        item._count.saleItems,
      consumptions: item._count.consumptionItems,
      auditLogs:    item._count.auditLogs,
      waste:        item._count.wasteItems,
      issuances:    item._count.issuanceItems,
      requests:     item._count.stockRequestItems,
    };

    const totalRefs = Object.values(refs).reduce((a, b) => a + b, 0);

    if (totalRefs > 0) {
      return res.status(409).json({
        blocked:  true,
        itemName: item.name,
        refs,
        totalRefs,
        message: `"${item.name}" has ${totalRefs} linked record(s) and cannot be deleted. Archive it instead, or use force delete (owner only).`,
      });
    }

    // No references — safe to delete directly
    await prisma.stockItem.delete({ where: { id } });
    return res.json({ message: `"${item.name}" deleted successfully`, id });

  } catch (err) {
    console.error('deleteStockItem error:', err);
    if (err.code === 'P2025') return res.status(404).json({ error: 'Item not found' });
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};

// ─── DELETE /api/inventory/stock/:id/force ────────────────────────────────────
// Owner only. Wipes all references then deletes the item permanently.
const forceDeleteStockItem = async (req, res) => {
  const { id } = req.params;
  try {
    const item = await prisma.stockItem.findUnique({ where: { id } });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    await prisma.$transaction([
      // Hard-delete all child records with required FK to this item
      prisma.inventoryMovement.deleteMany({    where: { itemId: id } }),
      prisma.stockAuditLog.deleteMany({        where: { itemId: id } }),
      prisma.shiftIssuanceItem.deleteMany({    where: { itemId: id } }),
      prisma.inventorySaleItem.deleteMany({    where: { itemId: id } }),
      prisma.inventoryWasteItem.deleteMany({   where: { itemId: id } }),

      // Nullable FK — null them out to preserve parent record history
      prisma.consumptionLogItem.updateMany({   where: { itemId: id }, data: { itemId: null } }),
      prisma.stockRequestItem.updateMany({     where: { itemId: id }, data: { itemId: null } }),
      prisma.purchaseReceiptItem.updateMany({  where: { itemId: id }, data: { itemId: null } }),

      // Finally delete the item itself
      prisma.stockItem.delete({ where: { id } }),
    ]);

    // Clean up image file if present
    if (item.imageUrl) {
      const fullPath = path.join(__dirname, '..', '..', item.imageUrl.replace(/^\//, ''));
      if (fs.existsSync(fullPath)) {
        try { fs.unlinkSync(fullPath); } catch (_) {}
      }
    }

    return res.json({
      message: `"${item.name}" permanently deleted along with all ${Object.keys({ movements: 1, auditLogs: 1, issuances: 1, sales: 1, waste: 1 }).length} reference types.`,
      id,
    });
  } catch (err) {
    console.error('forceDeleteStockItem error:', err);
    return res.status(500).json({ error: 'Force delete failed', detail: err.message });
  }
};

module.exports = {
  getAllStock,
  createStockItem,
  updateStockItem,
  archiveStockItem,
  deleteStockItem,
  forceDeleteStockItem,
};