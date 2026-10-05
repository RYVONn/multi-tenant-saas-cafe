/**
 * payments.controller.js
 *
 * Handles:
 *  - Recording payments against purchase receipts (AP)
 *  - Recording payments received against sales (AR)
 *  - AP summary report
 *  - AR summary report
 *
 * Payment-status rules (shared for both receipts and sales):
 *   amountPaid/Received = 0                   → 'unpaid'
 *   amountPaid/Received > 0 && remaining > 0  → 'partially_paid'
 *   remaining <= 0                             → 'paid'
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Derive canonical payment status from totals.
 * @param {number} total      - total amount owed/billed
 * @param {number} paid       - cumulative amount paid/received so far
 * @returns {'paid'|'partially_paid'|'unpaid'}
 */
function derivePaymentStatus(total, paid) {
  if (!total || total <= 0) return paid > 0 ? 'paid' : 'unpaid';
  const remaining = total - paid;
  if (remaining <= 0)  return 'paid';
  if (paid > 0)        return 'partially_paid';
  return 'unpaid';
}

/**
 * Emit a payment notification (non-fatal).
 */
async function notifyPayment(io, createNotification, { type, title, body, data }) {
  try {
    for (const role of ['inventory_manager', 'owner']) {
      await createNotification(io, {
        recipientId:   'broadcast',
        recipientRole: role,
        type,
        title,
        body,
        data,
      });
    }
  } catch (err) {
    console.error('[payments] notification error (non-fatal):', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNTS PAYABLE — Purchase Receipts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/inventory/receipts/:id/payment
 * Body: { amount, method?, note?, paidAt? }
 *
 * Records a payment instalment against a purchase receipt and recalculates
 * paymentStatus.
 */
const recordReceiptPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;
    const actorName = req.user.name ?? 'Manager';

    const { amount, method, note, paidAt } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const receipt = await prisma.purchaseReceipt.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });

    const currentPaid = receipt.amountPaid ?? 0;
    const total       = receipt.totalCost  ?? 0;
    const newPaid     = currentPaid + parsedAmount;
    const newStatus   = derivePaymentStatus(total, newPaid);

    const [payment] = await prisma.$transaction([
      prisma.receiptPayment.create({
        data: {
          receiptId:  id,
          amount:     parsedAmount,
          method:     method  || null,
          note:       note    || null,
          paidAt:     paidAt  ? new Date(paidAt) : new Date(),
          recordedBy: managerId,
        },
      }),
      prisma.purchaseReceipt.update({
        where: { id },
        data: {
          amountPaid:    newPaid,
          paymentStatus: newStatus,
        },
      }),
    ]);

    // Notification
    const io               = req.app.get('io');
    const { createNotification } = require('./notifications.controller');
    const remaining        = Math.max(0, total - newPaid);
    const supplierLabel    = receipt.supplierName ?? 'supplier';
    const statusLabel      = newStatus === 'paid' ? '✅ fully paid' : `⚠️ ${remaining.toFixed(2)} EGP remaining`;

    await notifyPayment(io, createNotification, {
      type:  'receipt_payment_recorded',
      title: `Receipt payment recorded`,
      body:  `${actorName} recorded ${parsedAmount.toFixed(2)} EGP for receipt from ${supplierLabel} — ${statusLabel}`,
      data:  { receiptId: id, amountPaid: newPaid, paymentStatus: newStatus, remaining },
    });

    const updated = await prisma.purchaseReceipt.findUnique({
      where:   { id },
      include: { payments: true, supplierRef: { select: { id: true, name: true } } },
    });

    res.status(201).json({ payment, receipt: updated });
  } catch (err) {
    console.error('[payments] recordReceiptPayment error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

/**
 * PATCH /api/inventory/receipts/:id/due-date
 * Body: { dueDate }
 */
const setReceiptDueDate = async (req, res) => {
  try {
    const { id } = req.params;
    const { dueDate } = req.body;

    const updated = await prisma.purchaseReceipt.update({
      where: { id },
      data:  { dueDate: dueDate ? new Date(dueDate) : null },
    });

    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Receipt not found' });
    console.error('[payments] setReceiptDueDate error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/inventory/accounts-payable
 * Query: ?status=unpaid|partially_paid|paid|overdue&from=&to=
 *
 * Returns AP summary + itemised receipts with outstanding balances.
 */
const getAccountsPayable = async (req, res) => {
  try {

    const { status, from, to } = req.query;
    const now = new Date();

    const where = { status: 'approved' }; // only approved receipts enter AP

    if (status === 'overdue') {
      where.paymentStatus = { in: ['unpaid', 'partially_paid'] };
      where.dueDate       = { lt: now };
    } else if (status && status !== 'all') {
      where.paymentStatus = status;
    }

    if (from || to) {
      where.purchaseDate = {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) }),
        
      };
    }

    const receipts = await prisma.purchaseReceipt.findMany({
      where,
      include: {
        payments:    true,
        supplierRef: { select: { id: true, name: true, phone: true } },
        manager:     { select: { id: true, name: true } },
        items:       { include: { item: true } },
      },
     orderBy: [
   { dueDate: 'asc' },
  { createdAt: 'desc' },
  
],
    });

    // Compute summary
    const summary = receipts.reduce(
      (acc, r) => {
        const total     = r.totalCost    ?? 0;
        const paid      = r.amountPaid   ?? 0;
        const remaining = Math.max(0, total - paid);
        const isOverdue = r.dueDate && new Date(r.dueDate) < now
                       && r.paymentStatus !== 'paid';

        acc.totalOwed      += total;
        acc.totalPaid      += paid;
        acc.totalRemaining += remaining;
        if (r.paymentStatus === 'paid')          acc.paidCount++;
        if (r.paymentStatus === 'partially_paid') acc.partialCount++;
        if (r.paymentStatus === 'unpaid')         acc.unpaidCount++;
        if (isOverdue)                            acc.overdueCount++;
        return acc;
      },
      { totalOwed: 0, totalPaid: 0, totalRemaining: 0, paidCount: 0, partialCount: 0, unpaidCount: 0, overdueCount: 0 }
    );

    const enriched = receipts.map(r => ({
      ...r,
      remaining: Math.max(0, (r.totalCost ?? 0) - (r.amountPaid ?? 0)),
      isOverdue: !!(r.dueDate && new Date(r.dueDate) < now && r.paymentStatus !== 'paid'),
    }));
   console.log('[AP] receipts count:', enriched.length);
    res.json({ summary, receipts: enriched });
  } catch (err) {
    console.error('[payments] getAccountsPayable error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNTS RECEIVABLE — Sales
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/inventory/sales/:id/payment
 * Body: { amount, method?, note?, receivedAt? }
 */
const recordSalePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.user.id;
    const actorName = req.user.name ?? 'Manager';

    const { amount, method, note, receivedAt } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!parsedAmount || parsedAmount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const sale = await prisma.inventorySale.findUnique({ where: { id } });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    const currentReceived = sale.amountReceived ?? 0;
    const total           = sale.totalAmount    ?? 0;
    const newReceived     = currentReceived + parsedAmount;
    const newStatus       = derivePaymentStatus(total, newReceived);

    const [payment] = await prisma.$transaction([
      prisma.salePayment.create({
        data: {
          saleId:     id,
          amount:     parsedAmount,
          method:     method     || null,
          note:       note       || null,
          receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
          recordedBy: managerId,
        },
      }),
     // في recordSalePayment، داخل الـ $transaction
prisma.inventorySale.update({
  where: { id },
  data: {
    amountReceived:  newReceived,
    amountRemaining: Math.max(0, total - newReceived),
    paymentStatus:   newStatus,
  },
}),
    ]);

    // Notification
    const io                     = req.app.get('io');
    const { createNotification } = require('./notifications.controller');
    const remaining              = Math.max(0, total - newReceived);
    const statusLabel            = newStatus === 'paid' ? '✅ fully collected' : `⚠️ ${remaining.toFixed(2)} EGP outstanding`;

    await notifyPayment(io, createNotification, {
      type:  'sale_payment_received',
      title: `Sale payment received`,
      body:  `${actorName} recorded ${parsedAmount.toFixed(2)} EGP from ${sale.customerName} — ${statusLabel}`,
      data:  { saleId: id, amountReceived: newReceived, paymentStatus: newStatus, remaining },
    });

    const updated = await prisma.inventorySale.findUnique({
      where:   { id },
      include: { payments: true, supplierRef: { select: { id: true, name: true } } },
    });

    res.status(201).json({ payment, sale: updated });
  } catch (err) {
    console.error('[payments] recordSalePayment error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
};

/**
 * PATCH /api/inventory/sales/:id/due-date
 * Body: { dueDate }
 */
const setSaleDueDate = async (req, res) => {
  try {
    const { id } = req.params;
    const { dueDate } = req.body;

    const updated = await prisma.inventorySale.update({
      where: { id },
      data:  { dueDate: dueDate ? new Date(dueDate) : null },
    });

    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Sale not found' });
    console.error('[payments] setSaleDueDate error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/inventory/accounts-receivable
 * Query: ?status=unpaid|partially_paid|paid|overdue&from=&to=
 */
const getAccountsReceivable = async (req, res) => {
  try {
    const { status, from, to } = req.query;
    const now = new Date();

    const where = {};

    if (status === 'overdue') {
      where.paymentStatus = { in: ['unpaid', 'partially_paid'] };
      where.dueDate       = { lt: now };
    } else if (status && status !== 'all') {
      where.paymentStatus = status;
    }

    if (from || to) {
      where.saleDate = {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) }),
      };
    }

    // ✅ بعد — خلي supplierRef optional
const sales = await prisma.inventorySale.findMany({
  where,
  include: {
    payments:    true,
    supplierRef: { select: { id: true, name: true } },
    manager:     { select: { id: true, name: true } },
    items:       { include: { item: true } },
  },
  orderBy: [
    { dueDate: 'asc' },
    { createdAt: 'desc' },
  ],
});

    const summary = sales.reduce(
      (acc, s) => {
        const total     = s.totalAmount     ?? 0;
        const received  = s.amountReceived  ?? 0;
        const remaining = Math.max(0, total - received);
        const isOverdue = s.dueDate && new Date(s.dueDate) < now && s.paymentStatus !== 'paid';

        acc.totalBilled    += total;
        acc.totalReceived  += received;
        acc.totalRemaining += remaining;
        if (s.paymentStatus === 'paid')          acc.paidCount++;
        if (s.paymentStatus === 'partially_paid') acc.partialCount++;
        if (s.paymentStatus === 'unpaid')         acc.unpaidCount++;
        if (isOverdue)                            acc.overdueCount++;
        return acc;
      },
      { totalBilled: 0, totalReceived: 0, totalRemaining: 0, paidCount: 0, partialCount: 0, unpaidCount: 0, overdueCount: 0 }
    );

   const enriched = sales.map(s => ({
  ...s,
  remaining:     Math.max(0, (s.totalAmount ?? 0) - (s.amountReceived ?? 0)),
  isOverdue:     !!(s.dueDate && new Date(s.dueDate) < now && s.paymentStatus !== 'paid'),
  invoiceNumber: `INV-${s.id.slice(-6).toUpperCase()}`,
}));

    res.json({ summary, sales: enriched });
  } catch (err) {
    console.error('[payments] getAccountsReceivable error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Payment history for a single record
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/inventory/receipts/:id/payments */
const getReceiptPayments = async (req, res) => {
  try {
    const payments = await prisma.receiptPayment.findMany({
      where:   { receiptId: req.params.id },
      orderBy: { paidAt: 'asc' },
    });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

/** GET /api/inventory/sales/:id/payments */
const getSalePayments = async (req, res) => {
  try {
    const payments = await prisma.salePayment.findMany({
      where:   { saleId: req.params.id },
      orderBy: { receivedAt: 'asc' },
    });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  // AP
  recordReceiptPayment,
  setReceiptDueDate,
  getAccountsPayable,
  getReceiptPayments,
  recordSalePayment,
  setSaleDueDate,
  getAccountsReceivable,
  getSalePayments,
};