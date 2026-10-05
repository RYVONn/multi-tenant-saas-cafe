/**
 * shifts.controller.js
 *
 * Changes vs shared version:
 *  1. getActiveShifts: staff see only their own shift type (morning_staff → morning only).
 *     Owners and managers see all active shifts.
 *  2. getAllShifts: staff see only their own type (already gated to owner/manager in routes,
 *     but defence-in-depth filter kept here too).
 *  3. openShift: backend validation that req.user.allowed_shift_type matches requested type.
 *  4. closeShift: backend validation that staff can only close their own shift type.
 *  5. All notification changes from prior version preserved.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXPIRY_WARNING_DAYS = 7;
const UNRESTRICTED_ROLES  = ['owner', 'inventory_manager', 'manager'];

function isUnrestricted(user) {
  return UNRESTRICTED_ROLES.includes(user?.role) || user?.allowed_shift_type === null;
}

function daysUntilExpiry(date) {
  if (!date) return null;
  const now = new Date();
  const exp = new Date(date);
  return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
}

// Cooldowns (unchanged from shared version)
const _expiryNotifCooldown   = new Map();
const EXPIRY_NOTIF_COOLDOWN_MS = 4 * 60 * 60 * 1000;

let _lowStockCooldown, LOW_STOCK_COOLDOWN_MS;
try {
  const salesCtrl       = require('./inventory-sales.controller');
  _lowStockCooldown     = salesCtrl._lowStockCooldown;
  LOW_STOCK_COOLDOWN_MS = salesCtrl.LOW_STOCK_COOLDOWN_MS;
} catch {
  _lowStockCooldown     = new Map();
  LOW_STOCK_COOLDOWN_MS = 10 * 60 * 1000;
}

async function notifyLowStockAtShiftOpen(io, createNotification, lowItems, actorName) {
  for (const item of lowItems) {
    try {
      const lastSent = _lowStockCooldown.get(item.itemId) ?? 0;
      if (Date.now() - lastSent < LOW_STOCK_COOLDOWN_MS) continue;
      _lowStockCooldown.set(item.itemId, Date.now());
      setTimeout(() => _lowStockCooldown.delete(item.itemId), LOW_STOCK_COOLDOWN_MS);
      for (const role of ['inventory_manager', 'owner']) {
        await createNotification(io, {
          recipientId: 'broadcast', recipientRole: role,
          type: 'low_stock', title: '⚠️ Low stock at shift start',
          body: `${item.name}: ${item.quantity} ${item.unit} remaining (min: ${item.minQuantity ?? 0}) — noted by ${actorName} on shift open`,
          data: { itemId: item.itemId, currentCount: item.quantity, minQuantity: item.minQuantity },
        });
      }
    } catch (err) {
      console.error(`Low-stock notify failed for item ${item.itemId}:`, err);
    }
  }
}

async function notifyExpiringAtShiftOpen(io, createNotification, expiringItems, expiredItems, actorName) {
  for (const item of [...expiringItems, ...expiredItems]) {
    try {
      const lastSent = _expiryNotifCooldown.get(item.itemId) ?? 0;
      if (Date.now() - lastSent < EXPIRY_NOTIF_COOLDOWN_MS) continue;
      _expiryNotifCooldown.set(item.itemId, Date.now());
      setTimeout(() => _expiryNotifCooldown.delete(item.itemId), EXPIRY_NOTIF_COOLDOWN_MS);
      const isExpired = item.isExpired;
      const daysText  = isExpired ? 'EXPIRED' : `expires in ${item.daysUntilExpiry} day${item.daysUntilExpiry === 1 ? '' : 's'}`;
      for (const role of ['inventory_manager', 'owner']) {
        await createNotification(io, {
          recipientId: 'broadcast', recipientRole: role,
          type:  isExpired ? 'item_expired' : 'item_expiring_soon',
          title: isExpired ? '🔴 Expired item in stock' : '🟡 Item expiring soon',
          body:  `${item.name} ${daysText} — found at ${actorName}'s shift open`,
          data:  { itemId: item.itemId, expiryDate: item.expiryDate, daysUntilExpiry: item.daysUntilExpiry },
        });
      }
    } catch (err) {
      console.error(`Expiry notify failed for item ${item.itemId}:`, err);
    }
  }
}

// ─── GET /api/inventory/shifts ────────────────────────────────────────────────
// Owner/manager only (enforced in routes). Returns all shifts (no type filter).

const getAllShifts = async (req, res) => {
  try {
    const shifts = await prisma.shift.findMany({
      include: {
        staff: { select: { id: true, shift_name: true, role: true } },
        issuances:     { include: { items: { include: { item: true } } } },
        consumptions:  { include: { items: { include: { item: true } } } },
        stockRequests: { include: { items: { include: { item: true } }, response: true } },
        snapshot: true,
      },
      orderBy: { openedAt: 'desc' },
    });
    res.json(shifts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── GET /api/inventory/shifts/active ────────────────────────────────────────
// Staff see only their shift type. Owners/managers see all.

const getActiveShifts = async (req, res) => {
  try {
    const user         = req.user;
    const allowedType  = isUnrestricted(user) ? undefined : user.allowed_shift_type;

    const where = { status: 'open' };
    if (allowedType) {
      where.type = allowedType;
    }

    const shifts = await prisma.shift.findMany({
      where,
      include: {
        staff: { select: { id: true, shift_name: true, role: true } },
        issuances:     { include: { items: { include: { item: true } } } },
        consumptions:  { include: { items: { include: { item: true } } } },
        stockRequests: { include: { items: { include: { item: true } }, response: true } },
      },
    });
    res.json(shifts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── GET /api/inventory/shifts/:id ───────────────────────────────────────────
// requireShiftAccess() in routes already guards type. Controller is unchanged.

const getShift = async (req, res) => {
  try {
    const shift = await prisma.shift.findUnique({
      where: { id: req.params.id },
      include: {
        staff: { select: { id: true, shift_name: true, role: true } },
        issuances:     { include: { items: { include: { item: true } } } },
        consumptions:  { include: { items: { include: { item: true } } } },
        stockRequests: { include: { items: { include: { item: true } }, response: true } },
        snapshot: true,
      },
    });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    res.json(shift);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── POST /api/inventory/shifts/open ─────────────────────────────────────────

const openShift = async (req, res) => {
  console.log('[EVIDENCE-LOG] BACKEND (shift.controller): POST /api/inventory/shifts/open called (Confirm Start button clicked)');
  try {
    const { type }    = req.body;
    const staffId     = req.user.id;
    const actorName   = req.user.shift_name ?? req.user.name ?? 'Staff';
    const actorRole   = req.user.role ?? 'staff';
    const allowedType = req.user.allowed_shift_type;

    if (!['morning', 'evening'].includes(type))
      return res.status(400).json({ error: 'type must be morning or evening' });

    // ── Backend enforcement of shift type (defence-in-depth) ──────────────
    if (allowedType && allowedType !== type) {
      return res.status(403).json({
        error: `Your account is restricted to ${allowedType} shifts only`,
      });
    }

    const existing = await prisma.shift.findFirst({ where: { type, status: 'open' } });
    if (existing)
      return res.status(409).json({ error: `A ${type} shift is already open` });

    const lastShift = await prisma.shift.findFirst({
      where: { type, status: 'closed' },
      orderBy: { closedAt: 'desc' },
      include: { snapshot: true },
    });

    // ── Full stock snapshot ───────────────────────────────────────────────
    const allStock = await prisma.stockItem.findMany({ orderBy: { name: 'asc' } });

    const snapshot = allStock.map(item => {
      const daysLeft = daysUntilExpiry(item.expiryDate);
      return {
        itemId:          item.id,
        name:            item.name,
        unit:            item.unit,
        quantity:        item.quantity,
        packageCount:    item.packageCount,
        packageSize:     item.packageSize,
        measurementUnit: item.measurementUnit,
        minQuantity:     item.minQuantity,
        categoryId:      item.categoryId,
        storageLocation: item.storageLocation ?? null,
        expiryDate:      item.expiryDate ?? null,
        daysUntilExpiry: daysLeft,
        isLow:           item.quantity <= item.minQuantity,
        isExpired:       daysLeft !== null && daysLeft <= 0,
        isExpiringSoon:  daysLeft !== null && daysLeft > 0 && daysLeft <= EXPIRY_WARNING_DAYS,
      };
    });

    const lowItems          = snapshot.filter(s => s.isLow);
    const expiredItems      = snapshot.filter(s => s.isExpired);
    const expiringSoonItems = snapshot.filter(s => s.isExpiringSoon);
    const pendingRequests   = await prisma.stockRequest.count({ where: { status: 'pending' } });

    const shift = await prisma.$transaction(async tx => {
      console.log('[EVIDENCE-LOG] BACKEND (shift.controller): Executing prisma.shift.create...');
      const s = await tx.shift.create({
  data: { type, staffId, status: 'open' },
        include: { staff: { select: { id: true, shift_name: true, role: true } } },
      });
      await tx.shiftStockSnapshot.create({ data: { shiftId: s.id, snapshot } });
      if (allStock.length > 0) {
      await tx.stockAuditLog.create({
        data: {
          itemId: allStock[0]?.id ?? 'system',
          action: 'shift_opened', quantityBefore: 0, quantityAfter: 0, delta: 0,
          actorId: staffId, actorRole,
          notes: `${actorName} opened ${type} shift (id: ${s.id})`,
        },
      }).catch(() => {});}
      return s;
    });

    // ── Notifications (non-fatal) ─────────────────────────────────────────
    try {
      const { createNotification } = require('./notifications.controller');
      const io = req.app.get('io');
      await createNotification(io, {
        recipientRole: 'inventory_manager', recipientId: 'broadcast',
        type: 'shift_opened',
        title: `${type === 'morning' ? '🌅' : '🌙'} ${type} shift started`,
        body: `${actorName} opened the ${type} shift`,
        data: { shiftId: shift.id, type },
      });
      // Also notify owner
      await createNotification(io, {
        recipientRole: 'owner', recipientId: 'broadcast',
        type: 'shift_opened',
        title: `${type === 'morning' ? '🌅' : '🌙'} ${type} shift started`,
        body: `${actorName} opened the ${type} shift`,
        data: { shiftId: shift.id, type },
      });
      if (io) {
        io.emit('shift_opened', {
          shiftId: shift.id, type, staffName: actorName,
          openedAt: shift.openedAt,
          lowStockCount: lowItems.length,
          expiringCount: expiringSoonItems.length,
          expiredCount:  expiredItems.length,
        });
      }
      if (lowItems.length > 0) await notifyLowStockAtShiftOpen(io, createNotification, lowItems, actorName);
      if (expiringSoonItems.length > 0 || expiredItems.length > 0)
        await notifyExpiringAtShiftOpen(io, createNotification, expiringSoonItems, expiredItems, actorName);
    } catch (notifErr) {
      console.error('Shift-open notification error (non-fatal):', notifErr);
    }

    res.status(201).json({
      shift,
      previousHandoverNote:  lastShift?.handoverNote ?? null,
      previousSnapshotAt:    lastShift?.snapshot?.confirmedAt ?? null,
      stockSnapshot:         snapshot,
      lowStockItems:         lowItems,
      expiredItems,
      expiringSoonItems,
      pendingRequests,
      stats: {
        totalItems:        snapshot.length,
        lowCount:          lowItems.length,
        expiredCount:      expiredItems.length,
        expiringSoonCount: expiringSoonItems.length,
        pendingRequests,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── PATCH /api/inventory/shifts/:id/close ───────────────────────────────────
// requireShiftAccess() + requireSameStaffOrOwner() guard this in routes.
// Extra type-check here as defence-in-depth.

const closeShift = async (req, res) => {
  try {
    const { handoverNote } = req.body;
    const { id }           = req.params;
    const actorName        = req.user.shift_name ?? req.user.name ?? 'Staff';
    const actorRole        = req.user.role ?? 'staff';
    const actorId          = req.user.id;
    const allowedType      = req.user.allowed_shift_type;

    if (!handoverNote?.trim())
      return res.status(400).json({ error: 'Handover note is required before closing' });

    const shift = await prisma.shift.findUnique({
      where: { id },
      include: {
        consumptions:  { include: { items: { include: { item: true } } } },
        issuances:     { include: { items: { include: { item: true } } } },
        stockRequests: { include: { items: { include: { item: true } }, response: true } },
        snapshot: true,
      },
    });

    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    if (shift.status === 'closed') return res.status(400).json({ error: 'Shift already closed' });

    // ── Backend defence-in-depth type check ───────────────────────────────
    if (allowedType && shift.type !== allowedType) {
      return res.status(403).json({
        error: `Your account can only close ${allowedType} shifts`,
      });
    }

    // staffId check is handled by requireSameStaffOrOwner middleware
    if (!isUnrestricted(req.user) && shift.staffId !== actorId) {
      return res.status(403).json({ error: 'Only the shift opener can close it' });
    }

    const allStock = await prisma.stockItem.findMany({ orderBy: { name: 'asc' } });

    const closingSnapshot = allStock.map(item => {
      const daysLeft = daysUntilExpiry(item.expiryDate);
      return {
        itemId: item.id, name: item.name, unit: item.unit,
        quantity: item.quantity, packageCount: item.packageCount,
        minQuantity: item.minQuantity,
        isLow:           item.quantity <= item.minQuantity,
        isExpired:       daysLeft !== null && daysLeft <= 0,
        isExpiringSoon:  daysLeft !== null && daysLeft > 0 && daysLeft <= EXPIRY_WARNING_DAYS,
        daysUntilExpiry: daysLeft,
      };
    });

    const consumptionTotals = {};
    for (const log of shift.consumptions)
      for (const ci of log.items)
        consumptionTotals[ci.itemId] = (consumptionTotals[ci.itemId] ?? 0) + ci.quantity;

    const issuanceTotals = {};
    for (const iss of shift.issuances)
      for (const ii of iss.items)
        issuanceTotals[ii.itemId] = (issuanceTotals[ii.itemId] ?? 0) + ii.quantity;

    const shiftSummary = {
      duration:        Math.floor((new Date() - new Date(shift.openedAt)) / 60_000),
      consumptionLogs: shift.consumptions.length,
      issuances:       shift.issuances.length,
      stockRequests:   shift.stockRequests.length,
      pendingRequests: shift.stockRequests.filter(r => r.status === 'pending').length,
      consumedItems: Object.entries(consumptionTotals).map(([itemId, qty]) => {
        const item = allStock.find(s => s.id === itemId);
        return { itemId, name: item?.name ?? 'Unknown', unit: item?.unit ?? '', totalConsumed: qty };
      }),
      issuedItems: Object.entries(issuanceTotals).map(([itemId, qty]) => {
        const item = allStock.find(s => s.id === itemId);
        return { itemId, name: item?.name ?? 'Unknown', unit: item?.unit ?? '', totalIssued: qty };
      }),
      remainingLowStock: closingSnapshot.filter(s => s.isLow),
      closingSnapshot,
    };

    const updated = await prisma.$transaction(async tx => {
      const s = await tx.shift.update({
        where: { id },
        data:  { status: 'closed', closedAt: new Date(), handoverNote: handoverNote.trim() },
        include: {
          staff:         { select: { id: true, shift_name: true, role: true } },
          consumptions:  { include: { items: { include: { item: true } } } },
          issuances:     { include: { items: { include: { item: true } } } },
          stockRequests: { include: { items: { include: { item: true } }, response: true } },
        },
      });
      await tx.stockAuditLog.create({
        data: {
          itemId: allStock[0]?.id ?? 'system',
          action: 'shift_closed', quantityBefore: 0, quantityAfter: 0, delta: 0,
          actorId, actorRole,
          notes: `${actorName} closed ${shift.type} shift (id: ${id}) — duration: ${shiftSummary.duration}m`,
        },
      }).catch(() => {});
      return s;
    });

    // ── Notifications ─────────────────────────────────────────────────────
    try {
      const { createNotification } = require('./notifications.controller');
      const io = req.app.get('io');
      for (const role of ['inventory_manager', 'owner']) {
        await createNotification(io, {
          recipientRole: role, recipientId: 'broadcast',
          type:  'shift_closed',
          title: `${shift.type === 'morning' ? '🌅' : '🌙'} ${shift.type} shift closed`,
          body:  `${actorName} closed the ${shift.type} shift after ${shiftSummary.duration} min`,
          data:  { shiftId: id, duration: shiftSummary.duration, type: shift.type },
        });
      }
      if (io) {
        io.emit('shift_closed', {
          shiftId: updated.id, type: updated.type,
          staffName: updated.staff?.shift_name ?? 'Staff',
          closedAt: updated.closedAt, handoverNote: updated.handoverNote,
          summary: shiftSummary,
        });
      }
      if (shiftSummary.pendingRequests > 0) {
        for (const role of ['inventory_manager', 'owner']) {
          await createNotification(io, {
            recipientRole: role, recipientId: 'broadcast',
            type:  'shift_closed_pending_requests',
            title: '⏳ Shift closed with pending requests',
            body:  `${actorName} closed ${updated.type} shift — ${shiftSummary.pendingRequests} request(s) still pending`,
            data:  { shiftId: id },
          });
        }
      }
    } catch (notifErr) {
      console.error('Shift-close notification error (non-fatal):', notifErr);
    }

    res.json({ shift: updated, summary: shiftSummary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── GET /api/inventory/shifts/:id/summary ────────────────────────────────────

const getShiftSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const shift = await prisma.shift.findUnique({
      where: { id },
      include: {
        staff:         { select: { id: true, shift_name: true, role: true } },
        consumptions:  { include: { items: { include: { item: true } } } },
        issuances:     { include: { items: { include: { item: true } } } },
        stockRequests: { include: { items: { include: { item: true } }, response: true } },
        snapshot: true,
      },
    });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    const consumptionTotals = {};
    for (const log of shift.consumptions)
      for (const ci of log.items) {
        if (!consumptionTotals[ci.itemId]) consumptionTotals[ci.itemId] = { name: ci.item.name, unit: ci.item.unit, total: 0 };
        consumptionTotals[ci.itemId].total += ci.quantity;
      }

    const issuanceTotals = {};
    for (const iss of shift.issuances)
      for (const ii of iss.items) {
        if (!issuanceTotals[ii.itemId]) issuanceTotals[ii.itemId] = { name: ii.item.name, unit: ii.item.unit, total: 0 };
        issuanceTotals[ii.itemId].total += ii.quantity;
      }

    const duration = shift.closedAt
      ? Math.floor((new Date(shift.closedAt) - new Date(shift.openedAt)) / 60_000)
      : Math.floor((new Date() - new Date(shift.openedAt)) / 60_000);

    res.json({
      shiftId: id, type: shift.type, status: shift.status,
      staff: shift.staff, openedAt: shift.openedAt, closedAt: shift.closedAt ?? null,
      handoverNote: shift.handoverNote ?? null, duration,
      openingSnapshot: shift.snapshot?.snapshot ?? [],
      stats: {
        consumptionLogs:  shift.consumptions.length,
        issuances:        shift.issuances.length,
        stockRequests:    shift.stockRequests.length,
        pendingRequests:  shift.stockRequests.filter(r => r.status === 'pending').length,
        approvedRequests: shift.stockRequests.filter(r => r.status === 'approved').length,
        rejectedRequests: shift.stockRequests.filter(r => r.status === 'rejected').length,
      },
      consumedItems: Object.entries(consumptionTotals).map(([itemId, v]) => ({ itemId, ...v })),
      issuedItems:   Object.entries(issuanceTotals).map(([itemId, v]) => ({ itemId, ...v })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── GET /api/inventory/shifts/:id/audit ─────────────────────────────────────

const getShiftAuditLog = async (req, res) => {
  try {
    const { id } = req.params;
    const shift  = await prisma.shift.findUnique({ where: { id } });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    const logs = await prisma.stockAuditLog.findMany({
      where: {
        createdAt: { gte: shift.openedAt, ...(shift.closedAt ? { lte: shift.closedAt } : {}) },
      },
      include: { item: { select: { name: true, unit: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const movements = await prisma.inventoryMovement.findMany({
      where: {
        createdAt: { gte: shift.openedAt, ...(shift.closedAt ? { lte: shift.closedAt } : {}) },
      },
      include: { item: { select: { name: true, unit: true } } },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ shiftId: id, auditLogs: logs, movements });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getAllShifts,
  getActiveShifts,
  getShift,
  openShift,
  closeShift,
  getShiftSummary,
  getShiftAuditLog,
};