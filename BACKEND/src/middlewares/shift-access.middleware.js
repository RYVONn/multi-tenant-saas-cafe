/**
 * shift-access.middleware.js
 *
 * Enforces strict separation between morning and evening shift accounts.
 *
 * Usage (in routes):
 *   const { requireShiftAccess, requireOwnerOrManager } = require('../middlewares/shift-access.middleware');
 *
 *   // Blocks wrong-type staff from opening/viewing a specific shift:
 *   router.post('/open', authenticate, requireShiftAccess(), openShift);
 *
 *   // Blocks non-owner/non-manager from inventory endpoints:
 *   router.get('/stock', inventoryAuth, requireOwnerOrManager, listStock);
 *
 * How it works:
 *   - Owner (role === 'owner') always passes all checks.
 *   - inventory_manager always passes all checks.
 *   - morning_staff: can only touch type=morning shifts.
 *   - evening_staff: can only touch type=evening shifts.
 *   - allowed_shift_type=null means unrestricted (owner/legacy accounts).
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UNRESTRICTED_ROLES = ['owner', 'inventory_manager'];

// ─── Helper ───────────────────────────────────────────────────────────────────
function isUnrestricted(user) {
  const role = (user?.role ?? '').toLowerCase();
  return UNRESTRICTED_ROLES.includes(role) 
    || user?.allowed_shift_type === null 
    || user?.allowed_shift_type === undefined;
}

// ─── requireShiftAccess() ─────────────────────────────────────────────────────
// Call this on every shift route that touches a specific shift type.
// It reads `type` from req.body (for open) or looks up the shift in DB (for :id routes).
//
// For POST /open:   checks req.body.type vs user.allowed_shift_type
// For GET/PATCH /:id routes: fetches the shift, checks its type vs user.allowed_shift_type
//
function requireShiftAccess() {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthenticated' });


      if (isUnrestricted(user)) return next();

      const allowedType = user.allowed_shift_type;

      // POST /open — type comes from body
      if (req.body?.type && !req.params?.id) {
        const requestedType = req.body.type;
        if (allowedType && requestedType !== allowedType) {
          return res.status(403).json({
            error: `Access denied: your account can only open ${allowedType} shifts`,
          });
        }
        return next();
      }

      // Routes with :id
      if (req.params?.id) {
        const shift = await prisma.shift.findUnique({
          where:  { id: req.params.id },
          select: { type: true, staffId: true },
        });


        if (!shift) return next(); // controller handles 404

        if (allowedType && shift.type !== allowedType) {
          return res.status(403).json({
            error: `Access denied: this is a ${shift.type} shift and your account only has ${allowedType} access`,
          });
        }
        return next();
      }

      next();
    } catch (err) {
      console.error('requireShiftAccess error:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  };
}

// ─── requireOwnerOrManager ────────────────────────────────────────────────────
// Blocks anyone who is not owner or inventory_manager from reaching inventory routes.
function requireOwnerOrManager(req, res, next) {
  const role = req.user?.role;
  if (['owner', 'inventory_manager', 'manager'].includes(role)) return next();
  return res.status(403).json({ error: 'Access denied: managers only' });
}

// ─── requireSameStaffOrOwner ──────────────────────────────────────────────────
// Used by closeShift — only the shift opener or an owner/manager can close a shift.
async function requireSameStaffOrOwner(req, res, next) {
  try {
    const user = req.user;
    if (isUnrestricted(user)) return next();

    const shift = await prisma.shift.findUnique({
      where:  { id: req.params.id },
      select: { staffId: true },
    });

    if (!shift) return next(); // controller handles 404

    if (shift.staffId !== user.id) {
      return res.status(403).json({ error: 'Only the shift opener (or a manager) can close this shift' });
    }
    next();
  } catch (err) {
    console.error('requireSameStaffOrOwner error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { requireShiftAccess, requireOwnerOrManager, requireSameStaffOrOwner };