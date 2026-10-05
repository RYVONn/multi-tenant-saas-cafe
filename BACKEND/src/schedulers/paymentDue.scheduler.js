/**
 * paymentDue.scheduler.js
 *
 * Fires due-date notifications for both purchase receipts (AP) and sales (AR).
 *
 * Notification thresholds: overdue, due today, due in 1d, 3d, 7d.
 * De-duplication: one notification per record per threshold per calendar day
 *                 (checked via a simple in-memory set that resets on restart,
 *                 which is fine since the cron runs once daily at 08:00).
 *
 * Usage — call initPaymentDueScheduler(io) once at server startup:
 *
 *   const { initPaymentDueScheduler } = require('./schedulers/paymentDue.scheduler');
 *   initPaymentDueScheduler(app.get('io'));
 */

'use strict';

const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { createNotification } = require('../controllers/notifications.controller');

const prisma = new PrismaClient();

// Days-out thresholds that trigger a notification
const THRESHOLDS = [0, 1, 3, 7]; // 0 = due today

// Fired-today set — key: `${type}:${id}:${threshold}`
const _firedToday = new Set();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the number of whole calendar days between now and a future date. */
function daysUntil(date) {
  const nowMidnight  = new Date(); nowMidnight.setHours(0, 0, 0, 0);
  const thenMidnight = new Date(date); thenMidnight.setHours(0, 0, 0, 0);
  return Math.round((thenMidnight - nowMidnight) / 86_400_000);
}

function thresholdLabel(days) {
  if (days < 0)  return 'Overdue';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

function thresholdEmoji(days) {
  if (days < 0)  return '🚨';
  if (days === 0) return '🔴';
  if (days === 1) return '🟠';
  if (days <= 3) return '🟡';
  return '🔵';
}

async function sendDueNotification(io, { recordId, type, days, label, amount, counterpartyName }) {
  const key = `${type}:${recordId}:${days}`;
  if (_firedToday.has(key)) return;
  _firedToday.add(key);

  const emoji   = thresholdEmoji(days);
  const dueLabel = thresholdLabel(days);
  const typeLabel = type === 'receipt' ? 'Receipt payable' : 'Sale receivable';
  const verb      = type === 'receipt' ? 'to'              : 'from';

  for (const role of ['inventory_manager', 'owner']) {
    await createNotification(io, {
      recipientId:   'broadcast',
      recipientRole: role,
      type:          `payment_due_${type}`,
      title:         `${emoji} ${dueLabel} — ${typeLabel}`,
      body:          `${typeLabel} ${verb} ${counterpartyName}: ${amount.toLocaleString('en-EG', { minimumFractionDigits: 2 })} EGP remaining. ${dueLabel}.`,
      data:          { recordId, recordType: type, daysUntilDue: days, remaining: amount },
    });
  }
}

// ── Main check ────────────────────────────────────────────────────────────────

async function runDueChecks(io) {
  console.log('[paymentDue] Running due-date checks…');
  const now = new Date();

  // ── Receipts (AP) ─────────────────────────────────────────────────────────
  const unpaidReceipts = await prisma.purchaseReceipt.findMany({
    where: {
      status:        'approved',
      paymentStatus: { in: ['unpaid', 'partially_paid'] },
      dueDate:       { not: null },
    },
    select: {
      id:            true,
      totalCost:     true,
      amountPaid:    true,
      dueDate:       true,
      supplierName:  true,
      supplierRef:   { select: { name: true } },
    },
  });

  for (const r of unpaidReceipts) {
    const days      = daysUntil(r.dueDate);
    const remaining = Math.max(0, (r.totalCost ?? 0) - (r.amountPaid ?? 0));
    const name      = r.supplierRef?.name ?? r.supplierName ?? 'Unknown supplier';

    // Overdue: days < 0
    if (days < 0) {
      await sendDueNotification(io, {
        recordId:        r.id,
        type:            'receipt',
        days,
        label:           `Overdue by ${Math.abs(days)} day(s)`,
        amount:          remaining,
        counterpartyName: name,
      });
      continue;
    }

    // Upcoming thresholds
    if (THRESHOLDS.includes(days)) {
      await sendDueNotification(io, {
        recordId:        r.id,
        type:            'receipt',
        days,
        label:           thresholdLabel(days),
        amount:          remaining,
        counterpartyName: name,
      });
    }
  }

  // ── Sales (AR) ────────────────────────────────────────────────────────────
  const unpaidSales = await prisma.inventorySale.findMany({
    where: {
      paymentStatus: { in: ['unpaid', 'partially_paid'] },
      dueDate:       { not: null },
    },
    select: {
      id:              true,
      totalAmount:     true,
      amountReceived:  true,
      dueDate:         true,
      customerName:    true,
    },
  });

  for (const s of unpaidSales) {
    const days      = daysUntil(s.dueDate);
    const remaining = Math.max(0, (s.totalAmount ?? 0) - (s.amountReceived ?? 0));

    if (days < 0) {
      await sendDueNotification(io, {
        recordId:        s.id,
        type:            'sale',
        days,
        label:           `Overdue by ${Math.abs(days)} day(s)`,
        amount:          remaining,
        counterpartyName: s.customerName,
      });
      continue;
    }

    if (THRESHOLDS.includes(days)) {
      await sendDueNotification(io, {
        recordId:        s.id,
        type:            'sale',
        days,
        label:           thresholdLabel(days),
        amount:          remaining,
        counterpartyName: s.customerName,
      });
    }
  }

  console.log(`[paymentDue] Done. Checked ${unpaidReceipts.length} receipts, ${unpaidSales.length} sales.`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call once at server startup.
 * Schedules the check daily at 08:00 server local time.
 * Also runs immediately on startup so you don't wait until 08:00.
 */
function initPaymentDueScheduler(io) {
  // Run immediately on startup
  runDueChecks(io).catch(err => console.error('[paymentDue] startup check error:', err));

  // Schedule daily at 08:00
  cron.schedule('0 8 * * *', () => {
    // Reset fired-today set at start of each run
    _firedToday.clear();
    runDueChecks(io).catch(err => console.error('[paymentDue] scheduled check error:', err));
  });

  console.log('[paymentDue] Scheduler initialised — runs daily at 08:00.');
}

module.exports = { initPaymentDueScheduler, runDueChecks };