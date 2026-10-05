/**
 * purchase-receipts.controller.js
 *
 * FIX: categoryId, supplierId, storageLocation, measurementUnit, packageSize
 *      were being sent from the frontend per-item but never saved to
 *      PurchaseReceiptItem and never applied to StockItem on approve.
 *
 * Changes:
 *  1. createReceipt: for existing items, save categoryId, supplierId,
 *     storageLocation, measurementUnit, packageSize in pendingItemData
 *     so approveReceipt can apply them.
 *  2. approveReceipt: when updating an existing StockItem, apply
 *     categoryId, supplierId, storageLocation, measurementUnit, packageSize
 *     from pendingItemData if present.
 *  3. JSON.parse guard: handle empty string pendingItemData gracefully.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
// At the top of purchase-receipts.controller.js, add:
const NOTIFY_ROLES = ['inventory_manager', 'owner', 'manager'];

// Then the existing notify helper becomes:
async function notify(io, createNotification, payload) {
  try {
    for (const role of NOTIFY_ROLES) {
      await createNotification(io, { ...payload, recipientId: 'broadcast', recipientRole: role });
    }
  } catch (err) {
    console.error('[receipts] notification error (non-fatal):', err);
  }
}

// ── Helper: receiptNumber ─────────────────────────────────────────────────────
async function generateReceiptNumber() {
  const count = await prisma.purchaseReceipt.count();
  const num   = String(count + 1001).padStart(4, '0');
  return `REC-${num}`;
}

// ── Helper: paymentStatus ─────────────────────────────────────────────────────
function derivePaymentStatus(totalCost, amountPaid) {
  const total = totalCost  ?? 0;
  const paid  = amountPaid ?? 0;
  if (paid <= 0)     return 'unpaid';
  if (paid >= total) return 'paid';
  return 'partially_paid';
}

// ── Helper: safe JSON parse ───────────────────────────────────────────────────
// FIX: pendingItemData can be an empty string "" — guard against that.
function safeParsePendingData(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === 'null') return null;
    try { return JSON.parse(trimmed); } catch { return null; }
  }
  return null;
}

// ── Helper: notification ──────────────────────────────────────────────────────
async function notify(io, createNotification, payload) {
  try {
    for (const role of ['inventory_manager', 'owner']) {
      await createNotification(io, { ...payload, recipientId: 'broadcast', recipientRole: role });
    }
  } catch (err) {
    console.error('[receipts] notification error (non-fatal):', err);
  }
}

// =============================================================================
// GET /api/inventory/receipts
// =============================================================================
const getAllReceipts = async (req, res) => {
  try {
    const { from, to, status } = req.query;

    const where = {};

    // ── Status filter ──────────────────────────────────────────────────────
    if (status && status !== 'all') {
      where.status = status;
    }

    // ── Date filter — check BOTH purchaseDate and createdAt ────────────────
    // Old receipts may have been submitted without an explicit purchaseDate,
    // in which case it defaults to new Date() at creation. We filter on
    // purchaseDate when present, falling back to createdAt for nulls.
    // The safest approach: filter on createdAt (always present) so no
    // receipts are silently excluded.
    if (from || to) {
      where.createdAt = {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) }),
      };
    }

    const receipts = await prisma.purchaseReceipt.findMany({
      where,
      include: {
        // ── Include the full item + its pending metadata ───────────────────
        items: {
          include: {
            item: {
              include: {
                category: true,
                supplier: true,
              },
            },
          },
          orderBy: { id: 'asc' },
        },
        // ── Include payment records ────────────────────────────────────────
        payments:    { orderBy: { paidAt: 'asc' } },
        pendingItems: true,   // ← was missing; needed for approval queue display
        manager:     { select: { id: true, name: true, email: true } },
        supplierRef: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();

    const enriched = receipts.map(r => ({
      ...r,
      // ── Parse pendingItemData on each item so frontend gets objects ───────
      items: r.items.map(it => ({
        ...it,
        pendingItemData: it.pendingItemData
          ? (typeof it.pendingItemData === 'string'
              ? (() => { try { return JSON.parse(it.pendingItemData); } catch { return null; } })()
              : it.pendingItemData)
          : null,
      })),
      remaining: Math.max(0, (r.totalCost ?? 0) - (r.amountPaid ?? 0)),
      isOverdue: !!(
        r.dueDate &&
        new Date(r.dueDate) < now &&
        r.paymentStatus !== 'paid'
      ),
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[receipts] getAllReceipts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
// =============================================================================
// POST /api/inventory/receipts
// FIX: existing items now save their per-item metadata in pendingItemData
//      so approveReceipt can apply categoryId, supplierId, etc.
// =============================================================================
const createReceipt = async (req, res) => {
  try {
     const managerId = req.inventoryManagerId;  // was: req.user.id
    const actorName = req.user.name ?? 'Inventory Manager';

    const {
      notes, totalCost, items,
      supplierName, supplierId,
      purchaseDate, paymentMethod,
      amountPaid, dueDate,
    } = req.body;

    if (!items) return res.status(400).json({ error: 'items are required' });

    let parsedItems = [];
    try {
      parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    } catch {
      return res.status(400).json({ error: 'Invalid items JSON' });
    }

    if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
      return res.status(400).json({ error: 'items array must not be empty' });
    }

    for (const item of parsedItems) {
      if (item.isNew) {
        if (!item.newName || !item.newUnit)
          return res.status(400).json({ error: 'New items require newName and newUnit' });
        if (!item.quantity || parseFloat(item.quantity) <= 0)
          return res.status(400).json({ error: 'New item quantity must be > 0' });
      } else {
        if (!item.itemId || !item.quantity || parseFloat(item.quantity) <= 0)
          return res.status(400).json({ error: 'Each existing item needs itemId and quantity > 0' });
        const exists = await prisma.stockItem.findUnique({ where: { id: item.itemId } });
        if (!exists) return res.status(404).json({ error: `Stock item not found: ${item.itemId}` });
      }
    }

    const receiptNumber  = await generateReceiptNumber();
    const parsedTotal    = totalCost  ? parseFloat(totalCost)  : null;
    const parsedAmtPaid  = amountPaid ? parseFloat(amountPaid) : 0;
    const paymentStatus  = derivePaymentStatus(parsedTotal, parsedAmtPaid);

    const receipt = await prisma.purchaseReceipt.create({
      data: {
        receiptNumber,
        managerId,
        supplierId:    supplierId   || null,
        supplierName:  supplierId   ? null : (supplierName || null),
        purchaseDate:  purchaseDate ? new Date(purchaseDate) : new Date(),
        totalCost:     parsedTotal,
        receiptPhoto: req.file?.filename ?? null,
        notes:         notes        || null,
        paymentMethod: paymentMethod || null,
        amountPaid:    parsedAmtPaid,
        paymentStatus,
        dueDate:       dueDate      ? new Date(dueDate) : null,
        status:        'pending_approval',

        items: {
          create: parsedItems.map(item => {
            // FIX: both new AND existing items store their full metadata
            // in pendingItemData so approveReceipt can apply all fields.
            const meta = {
              newName:         item.newName         || null,
              newUnit:         item.newUnit         || null,
              packageSize:     item.packageSize     || null,
              measurementUnit: item.measurementUnit || null,
              categoryId:      item.categoryId      || null,
              supplierId:      item.supplierId      || supplierId || null,
              storageLocation: item.storageLocation || null,
              newMinQty:       item.newMinQty       || null,
              notes:           item.notes           || null,
              expiryDate:      item.expiryDate      || null,
              sellingPrice:    item.sellingPrice    || null,
              unitCost:        item.unitCost        || null,
            };

            return {
              itemId:          item.isNew ? null : item.itemId,
              quantity:        parseFloat(item.quantity),
              unitCost:        item.unitCost     ? parseFloat(item.unitCost)     : null,
              sellingPrice:    item.sellingPrice ? parseFloat(item.sellingPrice) : null,
              // FIX: always save metadata — not just for new items
              pendingItemData: JSON.stringify(meta),
            };
          }),
        },
      },
      include: {
        items:       { include: { item: true } },
        manager:     { select: { id: true, name: true } },
        supplierRef: { select: { id: true, name: true } },
      },
    });

    try {
      const { createNotification } = require('./notifications.controller');
      const io            = req.app.get('io');
      const supplierLabel = receipt.supplierRef?.name ?? supplierName ?? 'Unknown supplier';
      const totalLabel    = parsedTotal ? `${parsedTotal.toLocaleString()} EGP` : 'amount TBD';

      await notify(io, createNotification, {
        type:  'receipt_pending_approval',
        title: '📋 Receipt awaiting approval',
        body:  `${actorName} submitted ${receiptNumber} from ${supplierLabel} — ${totalLabel}. Needs approval before stock is updated.`,
        data:  { receiptId: receipt.id, receiptNumber },
      });
    } catch (notifErr) {
      console.error('[receipts] notification error (non-fatal):', notifErr);
    }

    res.status(201).json(receipt);
  } catch (err) {
    console.error('[receipts] createReceipt error:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// =============================================================================
// POST /api/inventory/receipts/:id/approve
// FIX: apply categoryId, supplierId, storageLocation, measurementUnit,
//      packageSize from pendingItemData to StockItem on approve.
// =============================================================================
const approveReceipt = async (req, res) => {
  try {
    const { id }    = req.params;
    const managerId = req.inventoryManagerId;  // was: req.user.id
    const actorName = req.user.name ?? 'Manager';

    const receipt = await prisma.purchaseReceipt.findUnique({
      where:   { id },
      include: { items: { include: { item: true } }, supplierRef: true },
    });

    if (!receipt)
      return res.status(404).json({ error: 'Receipt not found' });
    if (receipt.status === 'approved')
      return res.status(400).json({ error: 'Receipt already approved' });
    if (receipt.status === 'rejected')
      return res.status(400).json({ error: 'Cannot approve a rejected receipt' });

    const approved = await prisma.$transaction(async (tx) => {
      const stockUpdates = [];

      for (const receiptItem of receipt.items) {
        // FIX: use safe parser — handles "", null, undefined, object, string
        const pd = safeParsePendingData(receiptItem.pendingItemData);

        let stockItemId = receiptItem.itemId;

        if (!stockItemId && pd?.newName) {
          // ── New item ────────────────────────────────────────────────────────
          const pkgCount = parseFloat(receiptItem.quantity) || 0;
          const pkgSize  = pd.packageSize ? parseFloat(pd.packageSize) : null;

          let stockItem = await tx.stockItem.findFirst({
            where: { name: pd.newName },
          });

          if (!stockItem) {
            stockItem = await tx.stockItem.create({
              data: {
                name:            pd.newName,
                unit:            pd.newUnit,
                packageSize:     pkgSize,
                measurementUnit: pd.measurementUnit  || null,
                packageCount:    pkgCount,
                quantity:        pkgCount,
                minQuantity:     pd.newMinQty ? parseFloat(pd.newMinQty) : 0,
                purchasePrice:   pd.unitCost  ? parseFloat(pd.unitCost)  : null,
                sellingPrice:    pd.sellingPrice ? parseFloat(pd.sellingPrice) : null,
                categoryId:      pd.categoryId      || null,
                supplierId:      pd.supplierId      || receipt.supplierId || null,
                storageLocation: pd.storageLocation || null,
                expiryDate:      pd.expiryDate ? new Date(pd.expiryDate) : null,
                notes:           pd.notes || null,
              },
            });
            stockUpdates.push({ itemId: stockItem.id, name: stockItem.name, qty: pkgCount, qtyBefore: 0, qtyAfter: pkgCount, isNew: true });
          } else {
            const qtyBefore = stockItem.packageCount ?? stockItem.quantity;
            await tx.stockItem.update({
              where: { id: stockItem.id },
              data: {
                packageCount: { increment: pkgCount },
                quantity:     { increment: pkgCount },
                ...(receiptItem.unitCost     && { purchasePrice: parseFloat(receiptItem.unitCost) }),
                ...(receiptItem.sellingPrice && { sellingPrice:  parseFloat(receiptItem.sellingPrice) }),
              },
            });
            stockUpdates.push({ itemId: stockItem.id, name: stockItem.name, qty: pkgCount, qtyBefore, qtyAfter: qtyBefore + pkgCount, isNew: false });
          }

          await tx.purchaseReceiptItem.update({
            where: { id: receiptItem.id },
            data:  { itemId: stockItem.id },
          });

          stockItemId = stockItem.id;

        } else if (stockItemId) {
          // ── Existing item ───────────────────────────────────────────────────
          const currentStock = await tx.stockItem.findUnique({ where: { id: stockItemId } });
          if (!currentStock) continue;

          const qty       = parseFloat(receiptItem.quantity) || 0;
          const qtyBefore = currentStock.packageCount ?? currentStock.quantity;
          const qtyAfter  = qtyBefore + qty;

          // FIX: build update payload including metadata fields from pendingItemData
          const metaUpdate = {};
          if (pd) {
            // Only overwrite if the current value is null/empty AND pd has a value
            if (!currentStock.categoryId      && pd.categoryId)      metaUpdate.categoryId      = pd.categoryId;
            if (!currentStock.supplierId      && pd.supplierId)      metaUpdate.supplierId      = pd.supplierId;
            if (!currentStock.storageLocation && pd.storageLocation) metaUpdate.storageLocation = pd.storageLocation;
            if (!currentStock.measurementUnit && pd.measurementUnit) metaUpdate.measurementUnit = pd.measurementUnit;
            if (!currentStock.packageSize     && pd.packageSize)     metaUpdate.packageSize     = parseFloat(pd.packageSize);
            if (!currentStock.notes           && pd.notes)           metaUpdate.notes           = pd.notes;
          }
          // Always update supplier from receipt-level if item has none
          if (!currentStock.supplierId && receipt.supplierId) {
            metaUpdate.supplierId = receipt.supplierId;
          }

          await tx.stockItem.update({
            where: { id: stockItemId },
            data: {
              packageCount: { increment: qty },
              quantity:     { increment: qty },
              ...(receiptItem.unitCost     && { purchasePrice: parseFloat(receiptItem.unitCost) }),
              ...(receiptItem.sellingPrice && { sellingPrice:  parseFloat(receiptItem.sellingPrice) }),
              ...metaUpdate,   // FIX: apply metadata
            },
          });

          stockUpdates.push({ itemId: stockItemId, name: currentStock.name, qty, qtyBefore, qtyAfter, isNew: false });
        }

        // ── Movement record ────────────────────────────────────────────────────
        if (stockItemId && stockUpdates.length > 0) {
          const upd = stockUpdates[stockUpdates.length - 1];
          await tx.inventoryMovement.create({
            data: {
              itemId:      stockItemId,
              type:        'PURCHASE',
              quantity:    upd.qty,
              qtyBefore:   upd.qtyBefore,
              qtyAfter:    upd.qtyAfter,
              actorId:     managerId,
              actorRole:   'inventory_manager',
              actorName,
              referenceId: receipt.id,
              notes:       `Approved: ${receipt.receiptNumber ?? receipt.id}`,
            },
          });
        }
      }

      const updatedReceipt = await tx.purchaseReceipt.update({
        where: { id },
        data:  { status: 'approved' },
        include: {
          items:       { include: { item: true } },
          manager:     { select: { id: true, name: true } },
          supplierRef: { select: { id: true, name: true } },
        },
      });

      return { updatedReceipt, stockUpdates };
    });

    try {
      const { createNotification } = require('./notifications.controller');
      const io            = req.app.get('io');
      const supplierLabel = receipt.supplierRef?.name ?? receipt.supplierName ?? 'Unknown';
      const itemCount     = approved.stockUpdates.length;
      const newCount      = approved.stockUpdates.filter(s => s.isNew).length;

      await notify(io, createNotification, {
        type:  'receipt_approved',
        title: '✅ Receipt approved',
        body:  `${actorName} approved ${receipt.receiptNumber ?? receipt.id} from ${supplierLabel} — ${itemCount} item(s) added to stock${newCount > 0 ? ` (${newCount} new)` : ''}.`,
        data:  { receiptId: id, receiptNumber: receipt.receiptNumber },
      });
    } catch (notifErr) {
      console.error('[receipts] approval notification error (non-fatal):', notifErr);
    }

    res.json({
      message:      'Receipt approved — stock updated',
      receipt:      approved.updatedReceipt,
      stockUpdates: approved.stockUpdates,
    });
  } catch (err) {
    console.error('[receipts] approveReceipt error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// =============================================================================
// POST /api/inventory/receipts/:id/reject
// =============================================================================
const rejectReceipt = async (req, res) => {
  try {
    const { id }     = req.params;
    const { reason } = req.body;
    const actorName  = req.user.name ?? 'Manager';

    const receipt = await prisma.purchaseReceipt.findUnique({ where: { id } });
    if (!receipt)
      return res.status(404).json({ error: 'Receipt not found' });
    if (receipt.status === 'approved')
      return res.status(400).json({ error: 'Cannot reject an already approved receipt' });
    if (receipt.status === 'rejected')
      return res.status(400).json({ error: 'Receipt already rejected' });

    const updated = await prisma.purchaseReceipt.update({
      where: { id },
      data:  { status: 'rejected', rejectionNote: reason || null },
    });

    try {
      const { createNotification } = require('./notifications.controller');
      const io            = req.app.get('io');
      const supplierLabel = receipt.supplierName ?? 'Unknown supplier';
      await notify(io, createNotification, {
        type:  'receipt_rejected',
        title: '❌ Receipt rejected',
        body:  `${actorName} rejected ${receipt.receiptNumber ?? receipt.id} from ${supplierLabel}${reason ? `: ${reason}` : ''}.`,
        data:  { receiptId: id, receiptNumber: receipt.receiptNumber, reason },
      });
    } catch (notifErr) {
      console.error('[receipts] rejection notification error (non-fatal):', notifErr);
    }

    res.json({ message: 'Receipt rejected', receipt: updated });
  } catch (err) {
    console.error('[receipts] rejectReceipt error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// =============================================================================
// DELETE /api/inventory/receipts/:id
// =============================================================================
const deleteReceipt = async (req, res) => {
  try {
    const { id } = req.params;

    const receipt = await prisma.purchaseReceipt.findUnique({
      where:   { id },
      include: { items: true },
    });

    if (!receipt)
      return res.status(404).json({ error: 'Receipt not found' });

    if (receipt.status === 'approved') {
      return res.status(400).json({
        error: 'Cannot delete an approved receipt. Stock has already been updated.',
      });
    }

    await prisma.purchaseReceipt.delete({ where: { id } });
    res.json({ message: 'Receipt deleted successfully' });
  } catch (err) {
    console.error('[receipts] deleteReceipt error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// =============================================================================
// GET /api/inventory/receipts/pending
// =============================================================================
const getPendingReceipts = async (req, res) => {
  try {
    const receipts = await prisma.purchaseReceipt.findMany({
      where: { status: 'pending_approval' },
      include: {
        items: {
          include: {
            item: {
              include: { category: true, supplier: true },
            },
          },
          orderBy: { id: 'asc' },
        },
        payments:     { orderBy: { paidAt: 'asc' } },
        pendingItems: true,  // ← was missing
        manager:      { select: { id: true, name: true } },
        supplierRef:  { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const enriched = receipts.map(r => ({
      ...r,
      items: r.items.map(it => ({
        ...it,
        pendingItemData: it.pendingItemData
          ? (typeof it.pendingItemData === 'string'
              ? (() => { try { return JSON.parse(it.pendingItemData); } catch { return null; } })()
              : it.pendingItemData)
          : null,
      })),
      remaining: Math.max(0, (r.totalCost ?? 0) - (r.amountPaid ?? 0)),
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[receipts] getPendingReceipts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// =============================================================================
// GET /api/inventory/receipts/supplier-analytics
// =============================================================================
const getSupplierAnalytics = async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      include: {
        purchaseReceipts: {
          where: { status: 'approved' },
          select: {
  id:            true,
  receiptNumber: true,
  receiptPhoto:  true,
  totalCost:     true,
  amountPaid:    true,
  paymentStatus: true,
  dueDate:       true,
  purchaseDate:  true,
},
        },
      },
    });

    const now = new Date();

    const analytics = suppliers.map(s => {
      const receipts         = s.purchaseReceipts;
      const totalPurchases   = receipts.reduce((a, r) => a + (r.totalCost  ?? 0), 0);
      const totalPaid        = receipts.reduce((a, r) => a + (r.amountPaid ?? 0), 0);
      const totalOutstanding = Math.max(0, totalPurchases - totalPaid);
      const overdueCount     = receipts.filter(r =>
        r.dueDate && new Date(r.dueDate) < now && r.paymentStatus !== 'paid'
      ).length;
      const upcomingDue = receipts.filter(r => {
        if (!r.dueDate || r.paymentStatus === 'paid') return false;
        const days = Math.ceil((new Date(r.dueDate).getTime() - now.getTime()) / 86400000);
        return days >= 0 && days <= 7;
      }).length;

      return {
        id: s.id, name: s.name, phone: s.phone, email: s.email,
        receiptCount: receipts.length,
        totalPurchases, totalPaid, totalOutstanding,
        overdueCount, upcomingDue,
      };
    });

    analytics.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    res.json(analytics);
  } catch (err) {
    console.error('[receipts] getSupplierAnalytics error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllReceipts,
  createReceipt,
  approveReceipt,
  rejectReceipt,
  deleteReceipt,
  getPendingReceipts,
  getSupplierAnalytics,
};