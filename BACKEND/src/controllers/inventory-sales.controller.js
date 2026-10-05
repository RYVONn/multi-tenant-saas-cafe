/**
 * inventory-sales.controller.js
 *
 * Fixes applied vs the broken version in production:
 *  1. amountPaid  → amountReceived  everywhere (field was renamed in schema)
 *  2. paymentStatus default  'pending' → 'unpaid'  (normalised status set)
 *  3. updatePayment now validates the NEW status set: unpaid | partially_paid | paid
 *  4. Stray amountPaid reference inside tx.inventorySale.create data removed.
 *  5. All other logic (low-stock cooldown, notifications, movements) unchanged.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Low-stock notification cooldown ──────────────────────────────────────────
// Shared map so the cooldown survives across multiple requests in the same
// process without hitting the DB.
const _lowStockCooldown      = new Map();
const LOW_STOCK_COOLDOWN_MS  = 10 * 60 * 1000; // 10 minutes per item

/**
 * Fire a low-stock notification when an item's packageCount falls at or below
 * its minQuantity, but no more than once per LOW_STOCK_COOLDOWN_MS per item.
 */
async function maybeNotifyLowStock(io, createNotification, item, actorName) {
  try {
    const count = item.packageCount ?? item.quantity ?? 0;
    const min   = item.minQuantity  ?? 0;
    if (count > min) return; // still above threshold — nothing to do

    const lastSent = _lowStockCooldown.get(item.id) ?? 0;
    if (Date.now() - lastSent < LOW_STOCK_COOLDOWN_MS) return; // cooldown active

    _lowStockCooldown.set(item.id, Date.now());
    setTimeout(() => _lowStockCooldown.delete(item.id), LOW_STOCK_COOLDOWN_MS);

    for (const role of ['inventory_manager', 'owner']) {
      await createNotification(io, {
        recipientId:   'broadcast',
        recipientRole: role,
        type:          'low_stock',
        title:         '⚠️ Low stock alert',
        body:          `${item.name} is at ${count} ${item.unit}(s) — minimum is ${min}. Triggered after sale by ${actorName}.`,
        data:          { itemId: item.id, currentCount: count, minQuantity: min },
      });
    }
  } catch (err) {
    console.error('maybeNotifyLowStock error (non-fatal):', err);
  }
}

// Export shared helpers so shifts.controller can reuse them.
module.exports._lowStockCooldown     = _lowStockCooldown;
module.exports.LOW_STOCK_COOLDOWN_MS = LOW_STOCK_COOLDOWN_MS;
module.exports.maybeNotifyLowStock   = maybeNotifyLowStock;

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory/sales
// ─────────────────────────────────────────────────────────────────────────────
const getAll = async (req, res) => {
  try {
    const { from, to } = req.query;

    const where = (from || to) ? {
      saleDate: {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) }),
      },
    } : {};

    const sales = await prisma.inventorySale.findMany({
      where,
      include: {
        items:       { include: { item: true } },
        manager:     { select: { id: true, name: true } },
        supplierRef: { select: { id: true, name: true } },
        payments:    true,               // include instalment ledger
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const enriched = sales.map(s => ({
      ...s,
      invoiceNumber: `INV-${s.id.slice(-6).toUpperCase()}`,  // ← رقم للعرض
      remaining: Math.max(0, s.totalAmount - (s.amountReceived ?? 0)),
      isOverdue: !!(s.dueDate && new Date(s.dueDate) < now && s.paymentStatus !== 'paid'),
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[sales] getAll error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/inventory/sales
// ─────────────────────────────────────────────────────────────────────────────
const create = async (req, res) => {
  try {
    const managerId = req.inventoryManagerId;  // was: req.user.id
    const actorName = req.user.name ?? req.user.shift_name ?? 'Manager';

    if (!managerId) {
      return res.status(401).json({ error: 'Unauthorized: manager ID missing from token' });
    }

    // ── Destructure body ────────────────────────────────────────────────────
    // FIX: was `amountPaid` — field is now `amountReceived` in the schema.
    const {
      customerName,
      customerPhone,
      notes,
      paymentMethod,
      paymentStatus,
      saleDate,
      supplierId,
      amountReceived,   // ← FIXED (was amountPaid)
    } = req.body;

    if (!customerName?.trim()) {
      return res.status(400).json({ error: 'customerName is required' });
    }

    // ── Parse items ─────────────────────────────────────────────────────────
    let parsedItems;
    try {
      parsedItems = typeof req.body.items === 'string'
        ? JSON.parse(req.body.items)
        : req.body.items;
    } catch {
      return res.status(400).json({ error: 'items must be valid JSON' });
    }

    if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
      return res.status(400).json({ error: 'items array is required and must not be empty' });
    }

    const invoiceImagePath = req.file
      ? req.file.path.replace(/\\/g, '/')
      : null;

    // Capture item IDs after the transaction for low-stock checks.
    const postSaleItemIds = [];

    // ── Transaction ─────────────────────────────────────────────────────────
    const sale = await prisma.$transaction(async (tx) => {
      let totalAmount   = 0;
      const saleItemsData = [];

      for (const i of parsedItems) {
        if (!i.itemId) {
          throw new Error('Each item must have an itemId');
        }
        if (!i.quantity || Number(i.quantity) <= 0) {
          throw new Error('Each item quantity must be greater than 0');
        }

        const stockItem = await tx.stockItem.findUnique({ where: { id: i.itemId } });
        if (!stockItem) {
          throw new Error(`Stock item not found: ${i.itemId}`);
        }

        const availableCount = stockItem.packageCount ?? stockItem.quantity;
        if (availableCount < Number(i.quantity)) {
          throw new Error(
            `Insufficient stock for "${stockItem.name}": ` +
            `available ${availableCount} ${stockItem.unit}(s), requested ${i.quantity}`
          );
        }

        const unitPrice = (i.unitPrice != null)
          ? Number(i.unitPrice)
          : (stockItem.sellingPrice ?? 0);

        const subtotal = unitPrice * Number(i.quantity);
        totalAmount   += subtotal;

        saleItemsData.push({
          itemId:   i.itemId,
          quantity: Number(i.quantity),
          unitPrice,
          subtotal,
        });
      }

      // ── Derive initial payment status ─────────────────────────────────────
      // If the caller supplied amountReceived we can derive an accurate status
      // immediately; otherwise default to 'unpaid'.
      const parsedAmountReceived = amountReceived ? parseFloat(amountReceived) : 0;
      let   resolvedPaymentStatus;

      if (paymentStatus && ['unpaid', 'partially_paid', 'paid'].includes(paymentStatus)) {
        // Caller sent a canonical status — trust it.
        resolvedPaymentStatus = paymentStatus;
      } else {
        // Derive from numbers so the DB is always consistent.
        if (parsedAmountReceived <= 0)                          resolvedPaymentStatus = 'unpaid';
        else if (parsedAmountReceived >= totalAmount)           resolvedPaymentStatus = 'paid';
        else                                                    resolvedPaymentStatus = 'partially_paid';
      }

      // ── Create the sale record ────────────────────────────────────────────
      const newSale = await tx.inventorySale.create({
        data: {
          managerId,
          supplierId:      supplierId              || null,
          customerName:    customerName.trim(),
          customerPhone:   customerPhone?.trim()   || null,
          notes:           notes?.trim()            || null,
          totalAmount,
          // FIX: field is amountReceived, NOT amountPaid
          amountReceived:  parsedAmountReceived,
          paymentMethod:   paymentMethod           || 'cash',
          // FIX: default was 'pending' — now 'unpaid'
          paymentStatus:   resolvedPaymentStatus,
          invoiceImage:    invoiceImagePath,
          saleDate:        saleDate ? new Date(saleDate) : new Date(),
          items: { create: saleItemsData },
        },
        include: {
          items:       { include: { item: true } },
          manager:     { select: { id: true, name: true } },
          supplierRef: { select: { id: true, name: true } },
        },
      });

      // ── Decrement stock + record movements ────────────────────────────────
      for (const i of saleItemsData) {
        const current   = await tx.stockItem.findUnique({ where: { id: i.itemId } });
        const qtyBefore = current.packageCount ?? current.quantity;
        const qtyAfter  = Math.max(0, qtyBefore - i.quantity);

        await tx.stockItem.update({
          where: { id: i.itemId },
          data: {
            packageCount: { decrement: i.quantity },
            quantity:     { decrement: i.quantity },
          },
        });

        await tx.inventoryMovement.create({
          data: {
            itemId:      i.itemId,
            type:        'SALE',
            quantity:    -i.quantity,
            qtyBefore,
            qtyAfter,
            actorId:     managerId,
            actorRole:   'inventory_manager',
            actorName,
            referenceId: newSale.id,
            notes:       `Sale to ${customerName.trim()}`,
          },
        });

        postSaleItemIds.push(i.itemId);
      }

      return newSale;
    }); // end $transaction

    // ── Notifications (outside transaction) ──────────────────────────────────
    try {
      const { createNotification } = require('./notifications.controller');
      const io = req.app.get('io');

      // Sale-completed notification
      const totalItems  = sale.items.length;
      const itemSummary = sale.items
        .slice(0, 2)
        .map(i => `${i.quantity} × ${i.item.name}`)
        .join(', ') + (totalItems > 2 ? ` +${totalItems - 2} more` : '');

      for (const role of ['inventory_manager', 'owner']) {
        await createNotification(io, {
          recipientId:   'broadcast',
          recipientRole: role,
          type:          'sale_completed',
          title:         '🛒 Sale completed',
          body:          `${actorName} sold ${itemSummary} to ${customerName.trim()} — ${sale.totalAmount.toLocaleString()} EGP`,
          data:          { saleId: sale.id, totalAmount: sale.totalAmount },
        });
      }

      // Low-stock notifications
      for (const itemId of postSaleItemIds) {
        const fresh = await prisma.stockItem.findUnique({ where: { id: itemId } });
        if (fresh) {
          await maybeNotifyLowStock(io, createNotification, fresh, actorName);
        }
      }
    } catch (notifErr) {
      console.error('[sales] notification error (non-fatal):', notifErr);
    }

    res.status(201).json(sale);
  } catch (err) {
    console.error('[sales] create error:', err.message);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/inventory/sales/:id/payment-status
// Simple one-field status override (for manual correction by a manager).
// For recording actual money received use payments.controller → recordSalePayment.
// ─────────────────────────────────────────────────────────────────────────────
const updatePayment = async (req, res) => {
  try {
    const { paymentStatus } = req.body;

    // FIX: old code accepted 'pending' and 'partial' which no longer exist.
    const VALID_STATUSES = ['unpaid', 'partially_paid', 'paid'];
    if (!VALID_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({
        error: `Invalid paymentStatus. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    const sale = await prisma.inventorySale.update({
      where: { id: req.params.id },
      data:  { paymentStatus },
    });

    res.json(sale);
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Sale not found' });
    }
    console.error('[sales] updatePayment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Re-export everything (Object.assign preserves the already-exported helpers above).
module.exports = Object.assign(module.exports, { getAll, create, updatePayment });