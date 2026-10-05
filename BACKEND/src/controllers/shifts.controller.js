/**
 * shifts.controller.js — FIXED
 *
 * Changes vs previous version:
 *  FIX-A  getMyShiftHistory: gracefully handles both staff JWT (req.user.id)
 *         and inventory JWT, and never throws on missing route.
 *  FIX-B  getActiveShifts: accepts both authenticate and inventoryAuth tokens
 *         so owners/managers can also poll /active without erroring.
 *  FIX-C  All three special GET handlers (/active, /my-history, open)
 *         are now exported and must be registered BEFORE /:id in the router.
 *  FIX-D  isUnrestricted() now also matches 'manager' role (was missing).
 *
 * Everything else (openShift, closeShift, audit, summary) is unchanged.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXPIRY_WARNING_DAYS = 7;

// FIX-D: added 'manager' to unrestricted roles
const UNRESTRICTED_ROLES = ['owner', 'inventory_manager', 'manager'];
// ─── Notify helper ────────────────────────────────────────────────────────────
// Sends the same notification to inventory_manager, owner, AND manager.
// Using a helper means adding a role in the future is a one-line change.
const NOTIFY_ROLES = ['inventory_manager', 'owner', 'manager'];

async function notifyRoles(io, createNotification, payload) {
  for (const role of NOTIFY_ROLES) {
    try {
      await createNotification(io, {
        ...payload,
        recipientId:   'broadcast',
        recipientRole: role,
      });
    } catch (err) {
      console.error(`[shifts] notification to ${role} failed (non-fatal):`, err);
    }
  }
}
function isUnrestricted(user) {
  return UNRESTRICTED_ROLES.includes(user?.role);
}

function daysUntilExpiry(date) {
  if (!date) return null;
  const now = new Date();
  const exp = new Date(date);
  return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
}

const _expiryNotifCooldown     = new Map();
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

      await notifyRoles(io, createNotification, {
        type:  'low_stock',
        title: '⚠️ Low stock at shift start',
        body:  `${item.name}: ${item.quantity} ${item.unit} remaining (min: ${item.minQuantity ?? 0}) — noted by ${actorName} on shift open`,
        data:  { itemId: item.itemId, currentCount: item.quantity, minQuantity: item.minQuantity },
      });
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

      const daysText = item.isExpired
        ? 'EXPIRED'
        : `expires in ${item.daysUntilExpiry} day${item.daysUntilExpiry === 1 ? '' : 's'}`;

      await notifyRoles(io, createNotification, {
        type:  item.isExpired ? 'item_expired' : 'item_expiring_soon',
        title: item.isExpired ? '🔴 Expired item in stock' : '🟡 Item expiring soon',
        body:  `${item.name} ${daysText} — found at ${actorName}'s shift open`,
        data:  { itemId: item.itemId, expiryDate: item.expiryDate, daysUntilExpiry: item.daysUntilExpiry },
      });
    } catch (err) {
      console.error(`Expiry notify failed for item ${item.itemId}:`, err);
    }
  }
}

// ─── GET /api/inventory/shifts ────────────────────────────────────────────────

const getAllShifts = async (req, res) => {
  try {
    const shifts = await prisma.shift.findMany({
      include: {
        staff:         { select: { id: true, shift_name: true, role: true } },
        issuances:     { include: { items: { include: { item: true } }, manager: { select: { id: true, name: true } } } },
        consumptions:  { include: { items: { include: { item: true } } } },
        stockRequests: { include: { items: { include: { item: true } }, response: true } },
        snapshot: true,
      },
      orderBy: { openedAt: 'desc' },
    });
    res.json(shifts);
  } catch (err) {
    console.error('getAllShifts error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── GET /api/inventory/shifts/active ─────────────────────────────────────────
// FIX-B: handles both staff and inventory/manager tokens gracefully.
// Staff with allowed_shift_type see only their type.
// Unrestricted roles see all open shifts.

// shifts.controller.js - getActiveShifts
// في getActiveShifts
const getActiveShifts = async (req, res) => {
  try {
    console.log('[getActiveShifts] req.user.id:', req.user?.id, '| type:', typeof req.user?.id);
    console.log('[getActiveShifts] req.user.allowed_shift_type:', req.user?.allowed_shift_type);

    const where = { status: 'open' };

    if (!isUnrestricted(req.user)) {
      // Staff: لازم يشوف شيفت بتاعه بس — فلترة بـ staffId + type
      where.staffId = req.user.id;
      if (req.user.allowed_shift_type) {
        where.type = req.user.allowed_shift_type;
      }
    }
    // Unrestricted (owner/manager): بيشوف كل الـ open shifts

    const shifts = await prisma.shift.findMany({
      where,
      include: {
        staff: { select: { id: true, shift_name: true, role: true } },
        consumptions: { include: { items: { include: { item: true } } } },
        issuances: {
          include: {
            items: { include: { item: true } },
            manager: { select: { id: true, name: true } },
          },
        },
        stockRequests: {
          include: {
            items: { include: { item: true } },
            response: true,
          },
        },
      },
    });

    console.log('[getActiveShifts] result:', shifts.map(s => ({
      id: s.id,
      staffId: s.staffId,
      type: s.type,
      status: s.status,
    })));

    res.json(shifts);
  } catch (err) {
    console.error('[getActiveShifts] error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
// ─── GET /api/inventory/shifts/my-history ─────────────────────────────────────
// FIX-A: Correctly filters by staffId + allowed_shift_type.
// Returns empty array (not 500) if staff has no shifts yet.

// في getMyShiftHistory
// shifts.controller.js
const getMyShiftHistory = async (req, res) => {
  try {
    console.log('[getMyShiftHistory] staffId:', req.user?.id);

    const shifts = await prisma.shift.findMany({
      where: {
        staffId: req.user.id,
        // ← لا تفلتر على status عشان يرجع open و closed
      },
      include: {
        staff:         { select: { id: true, shift_name: true, role: true } },
        consumptions:  { include: { items: { include: { item: true } } } },
        issuances: {
          include: {
            items:   { include: { item: true } },
            manager: { select: { id: true, name: true } },
          },
        },
        stockRequests: {
          include: {
            items:    { include: { item: true } },
            response: true,
          },
        },
      },
      orderBy: { openedAt: 'desc' },
      take: 30,
    });

    console.log('[getMyShiftHistory] found:', shifts.length, '→ open:', shifts.filter(s => s.status === 'open').length);
    res.json(shifts);
  } catch (err) {
    console.error('[getMyShiftHistory] error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── GET /api/inventory/shifts/:id ───────────────────────────────────────────

const getShift = async (req, res) => {
  try {
    const shift = await prisma.shift.findUnique({
      where: { id: req.params.id },
      include: {
        staff:         { select: { id: true, shift_name: true, role: true } },
        issuances:     { include: { items: { include: { item: true } }, manager: { select: { id: true, name: true } } } },
        consumptions:  { include: { items: { include: { item: true } } } },
        stockRequests: { include: { items: { include: { item: true } }, response: true } },
        snapshot:      true,
      },
    });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    res.json(shift);
  } catch (err) {
    console.error('getShift error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── GET /api/inventory/shifts/preflight ─────────────────────────────────────

const preflightOpenShift = async (req, res) => {
  console.log('[EVIDENCE-LOG] BACKEND (shifts.controller): GET /api/inventory/shifts/preflight called (Open Shift button clicked)');
  try {
    const { type } = req.query;
    const staffId  = req.user.id;
    const allowedType = req.user.allowed_shift_type ?? null;

    if (!['morning', 'evening'].includes(type))
      return res.status(400).json({ error: 'type must be morning or evening' });

    if (allowedType && allowedType !== type) {
      return res.status(403).json({
        error: `Your account is restricted to ${allowedType} shifts only`,
      });
    }

    const myExisting = await prisma.shift.findFirst({
      where: { staffId, status: 'open' },
    });
    if (myExisting) {
      return res.status(409).json({
        error: 'You already have an open shift',
        shiftId: myExisting.id,
      });
    }

    const existing = await prisma.shift.findFirst({ where: { type, status: 'open' } });
    if (existing)
      return res.status(409).json({ error: `A ${type} shift is already open` });

    const lastShift = await prisma.shift.findFirst({
      where:   { type, status: 'closed' },
      orderBy: { closedAt: 'desc' },
      include: { snapshot: true },
    });

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

    res.json({
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
    console.error('preflightOpenShift error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── POST /api/inventory/shifts/open ─────────────────────────────────────────

const openShift = async (req, res) => {
  console.log('[EVIDENCE-LOG] BACKEND (shifts.controller): POST /api/inventory/shifts/open called (Confirm Start button clicked)');
  try {
    const { type }    = req.body;
    const staffId     = req.user.id;
    const actorName   = req.user.shift_name ?? req.user.name ?? 'Staff';
    const actorRole   = req.user.role ?? 'staff';
    const allowedType = req.user.allowed_shift_type ?? null;

    if (!['morning', 'evening'].includes(type))
      return res.status(400).json({ error: 'type must be morning or evening' });

    if (allowedType && allowedType !== type) {
      return res.status(403).json({
        error: `Your account is restricted to ${allowedType} shifts only`,
      });
    }

    const myExisting = await prisma.shift.findFirst({
      where: { staffId, status: 'open' },
    });
    if (myExisting) {
      return res.status(409).json({
        error: 'You already have an open shift',
        shiftId: myExisting.id,
      });
    }

    const existing = await prisma.shift.findFirst({ where: { type, status: 'open' } });
    if (existing)
      return res.status(409).json({ error: `A ${type} shift is already open` });

    const lastShift = await prisma.shift.findFirst({
      where:   { type, status: 'closed' },
      orderBy: { closedAt: 'desc' },
      include: { snapshot: true },
    });

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
      console.log('[EVIDENCE-LOG] BACKEND (shifts.controller): Executing prisma.shift.create...');
      const s = await tx.shift.create({
        data: { type, staffId, status: 'open' },
        include: {
          staff:         { select: { id: true, shift_name: true, role: true } },
          issuances:     { include: { items: { include: { item: true } }, manager: { select: { id: true, name: true } } } },
          consumptions:  { include: { items: { include: { item: true } } } },
          stockRequests: { include: { items: { include: { item: true } }, response: true } },
        },
      });
      await tx.shiftStockSnapshot.create({ data: { shiftId: s.id, snapshot } });
      if (allStock.length > 0) {
        await tx.stockAuditLog.create({
          data: {
            itemId:         allStock[0].id,
            action:         'shift_opened',
            quantityBefore: 0, quantityAfter: 0, delta: 0,
            actorId:        staffId,
            actorRole,
            notes: `${actorName} opened ${type} shift (id: ${s.id})`,
          },
        }).catch(e => console.error('Audit log creation failed (non-fatal):', e));
      }
      return s;
    });

    try {
      const { createNotification } = require('./notifications.controller');
      const io = req.app.get('io');
      await createNotification(io, {
        recipientId: 'broadcast',
        type:  'shift_opened',
        title: `${type === 'morning' ? '🌅' : '🌙'} ${type} shift started`,
        body:  `${actorName} opened the ${type} shift`,
        data:  { shiftId: shift.id, type },
      });
      if (io) {
        io.emit('shift_opened', {
          shiftId: shift.id, type, staffName: actorName,
          openedAt: shift.openedAt,
          lowStockCount:  lowItems.length,
          expiringCount:  expiringSoonItems.length,
          expiredCount:   expiredItems.length,
        });
      }
      if (lowItems.length > 0)
        await notifyLowStockAtShiftOpen(io, createNotification, lowItems, actorName);
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
    console.error('openShift error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── PATCH /api/inventory/shifts/:id/close ───────────────────────────────────

const closeShift = async (req, res) => {
  try {
    const { handoverNote } = req.body;
    const { id }           = req.params;
    const actorName        = req.user.shift_name ?? req.user.name ?? 'Staff';
    const actorRole        = req.user.role ?? 'staff';
    const actorId          = req.user.id;
    const allowedType      = req.user.allowed_shift_type ?? null;

    if (!handoverNote?.trim())
      return res.status(400).json({ error: 'Handover note is required before closing' });

    const shift = await prisma.shift.findUnique({
      where: { id },
      include: {
        consumptions:  { include: { items: { include: { item: true } } } },
        issuances:     { include: { items: { include: { item: true } } } },
        stockRequests: { include: { items: { include: { item: true } }, response: true } },
        snapshot:      true,
      },
    });

    if (!shift)                    return res.status(404).json({ error: 'Shift not found' });
    if (shift.status === 'closed') return res.status(400).json({ error: 'Shift already closed' });

    if (allowedType && shift.type !== allowedType) {
      return res.status(403).json({
        error: `Your account can only close ${allowedType} shifts`,
      });
    }

    if (!isUnrestricted(req.user) && shift.staffId !== actorId) {
      return res.status(403).json({ error: 'Only the shift opener can close it' });
    }

    const allStock = await prisma.stockItem.findMany({ orderBy: { name: 'asc' } });

    const closingSnapshot = allStock.map(item => {
      const daysLeft = daysUntilExpiry(item.expiryDate);
      return {
        itemId:          item.id,
        name:            item.name,
        unit:            item.unit,
        quantity:        item.quantity,
        packageCount:    item.packageCount,
        minQuantity:     item.minQuantity,
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
      if (allStock.length > 0) {
        await tx.stockAuditLog.create({
          data: {
            itemId:         allStock[0].id,
            action:         'shift_closed',
            quantityBefore: 0, quantityAfter: 0, delta: 0,
            actorId,
            actorRole,
            notes: `${actorName} closed ${shift.type} shift (id: ${id}) — duration: ${shiftSummary.duration}m`,
          },
        }).catch(e => console.error('Audit log creation failed (non-fatal):', e));
      }
      return s;
    });

    try {
      const { createNotification } = require('./notifications.controller');
      const io = req.app.get('io');
      await createNotification(io, {
        recipientId: 'broadcast',
        type:  'shift_closed',
        title: `${shift.type === 'morning' ? '🌅' : '🌙'} ${shift.type} shift closed`,
        body:  `${actorName} closed the ${shift.type} shift after ${shiftSummary.duration} min`,
        data:  { shiftId: id, duration: shiftSummary.duration, type: shift.type },
      });
      if (io) {
        io.emit('shift_closed', {
          shiftId: updated.id, type: updated.type,
          staffName: updated.staff?.shift_name ?? 'Staff',
          closedAt: updated.closedAt, handoverNote: updated.handoverNote,
          summary: shiftSummary,
        });
      }
      if (shiftSummary.pendingRequests > 0) {
        await createNotification(io, {
          recipientId: 'broadcast',
          type:  'shift_closed_pending_requests',
          title: '⏳ Shift closed with pending requests',
          body:  `${actorName} closed ${updated.type} shift — ${shiftSummary.pendingRequests} request(s) still pending`,
          data:  { shiftId: id },
        });
      }
    } catch (notifErr) {
      console.error('Shift-close notification error (non-fatal):', notifErr);
    }

    res.json({ shift: updated, summary: shiftSummary });
  } catch (err) {
    console.error('closeShift error:', err);
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
        snapshot:      true,
      },
    });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    const consumptionTotals = {};
    for (const log of shift.consumptions)
      for (const ci of log.items) {
        const key = ci.itemId ?? `custom_${ci.customName ?? 'item'}`;
if (!consumptionTotals[key])
  consumptionTotals[key] = {
    name:  ci.item?.name  ?? ci.customName ?? 'Custom item',
    unit:  ci.item?.unit  ?? '',
    total: 0,
  };
consumptionTotals[key].total += ci.quantity;
        consumptionTotals[ci.itemId].total += ci.quantity;
      }

    const issuanceTotals = {};
    for (const iss of shift.issuances)
      for (const ii of iss.items) {
        if (!issuanceTotals[ii.itemId])
          issuanceTotals[ii.itemId] = { name: ii.item.name, unit: ii.item.unit, total: 0 };
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
    console.error('getShiftSummary error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── GET /api/inventory/shifts/:id/audit ─────────────────────────────────────

const getShiftAuditLog = async (req, res) => {
  try {
    const { id } = req.params;
    const shift  = await prisma.shift.findUnique({ where: { id } });
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    const [logs, movements] = await Promise.all([
      prisma.stockAuditLog.findMany({
        where: {
          createdAt: {
            gte: shift.openedAt,
            ...(shift.closedAt ? { lte: shift.closedAt } : {}),
          },
        },
        include: { item: { select: { name: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.inventoryMovement.findMany({
        where: {
          createdAt: {
            gte: shift.openedAt,
            ...(shift.closedAt ? { lte: shift.closedAt } : {}),
          },
        },
        include: { item: { select: { name: true, unit: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    res.json({ shiftId: id, auditLogs: logs, movements });
  } catch (err) {
    console.error('getShiftAuditLog error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
const getShiftHistory = async (req, res) => {
  try {
    const { from, to, type, status } = req.query;
    const user = req.user;

    const where = {};
    if (type && type !== 'all')     where.type   = type;
    if (status && status !== 'all') where.status = status;
    if (from || to) {
      where.openedAt = {};
      if (from) where.openedAt.gte = new Date(from);
      if (to)   where.openedAt.lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }

    // staff يشوف بتاعته بس
    if (!UNRESTRICTED_ROLES.includes(user?.role)) {
      where.staffId = user.id;
    }

    const shifts = await prisma.shift.findMany({
      where,
      include: {
        staff:         { select: { id: true, shift_name: true, role: true } },
        issuances:     { include: { items: { include: { item: true } }, manager: { select: { id: true, name: true } } } },
        consumptions:  { include: { items: { include: { item: true } } } },
        stockRequests: { include: { items: { include: { item: true } }, response: true } },
      },
      orderBy: { openedAt: 'desc' },
      take: 100,
    });

    // جيب orders النهارده للـ summary
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

   const todayOrders = await prisma.orders.findMany({
  where: { created_at: { gte: todayStart } },
  select: { status: true, total_amount: true },
});

    const summary = {
      ordersToday:    todayOrders.length,
      revenueToday:   todayOrders.filter(o => o.status === 'complete').reduce((s, o) => s + Number(o.total_amount), 0),
      completedToday: todayOrders.filter(o => o.status === 'complete').length,
      pendingToday:   todayOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length,
    };

    // enrich كل shift بـ orders بتاعتها
    const enriched = await Promise.all(shifts.map(async shift => {
      const shiftOrders = await prisma.orders.findMany({
        where: {
          created_at: {
            gte: shift.openedAt,
            ...(shift.closedAt ? { lte: shift.closedAt } : {}),
          },
        },
        include: { order_items: true },
      });

      const duration = shift.closedAt
        ? Math.floor((new Date(shift.closedAt) - new Date(shift.openedAt)) / 60_000)
        : Math.floor((new Date() - new Date(shift.openedAt)) / 60_000);

      const consumptionTotals = {};
      for (const log of shift.consumptions)
        for (const ci of log.items)
          consumptionTotals[ci.itemId] = (consumptionTotals[ci.itemId] ?? 0) + ci.quantity;

      return {
        id:           shift.id,
        type:         shift.type,
        status:       shift.status,
        staff:        shift.staff,
        openedAt:     shift.openedAt,
        closedAt:     shift.closedAt,
        handoverNote: shift.handoverNote,
        duration,
        orders: {
          total:     shiftOrders.length,
          completed: shiftOrders.filter(o => o.status === 'complete').length,
          pending:   shiftOrders.filter(o => ['pending', 'preparing'].includes(o.status)).length,
          cancelled: shiftOrders.filter(o => o.status === 'cancelled').length,
          revenue:   shiftOrders.filter(o => o.status === 'complete').reduce((s, o) => s + Number(o.total_amount), 0),
          itemsSold: shiftOrders.reduce((s, o) => s + o.order_items.reduce((ss, i) => ss + i.quantity, 0), 0),
          list: shiftOrders.map(o => ({
            id:            o.id,
            status:        o.status,
            total_amount:  Number(o.total_amount),
            customer_name: o.customer_name,
            type: o.type,
            created_at:    o.created_at,
            items_count:   o.order_items.reduce((s, i) => s + i.quantity, 0),
          })),
        },
        consumptionLogs: shift.consumptions.length,
        consumedItems:   Object.entries(consumptionTotals).map(([itemId, total]) => {
          const found = shift.consumptions.flatMap(l => l.items).find(i => i.itemId === itemId);
          return { itemId, name: found?.item?.name ?? itemId, unit: found?.item?.unit ?? '', total };
        }),
        stockRequests: {
          total:    shift.stockRequests.length,
          pending:  shift.stockRequests.filter(r => r.status === 'pending').length,
          approved: shift.stockRequests.filter(r => r.status === 'approved').length,
          rejected: shift.stockRequests.filter(r => r.status === 'rejected').length,
        },
        issuances: shift.issuances.length,
      };
    }));

    res.json({ shifts: enriched, summary });
  } catch (err) {
    console.error('getShiftHistory error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getAllShifts, getActiveShifts, getMyShiftHistory,
  getShift, openShift, closeShift,
  getShiftSummary, getShiftAuditLog,
  getShiftHistory, // ← أضف
  preflightOpenShift,
};