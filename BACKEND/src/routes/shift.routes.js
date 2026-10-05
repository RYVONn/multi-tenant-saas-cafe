const express = require('express');
const router  = express.Router();

const {
  getAllShifts, getActiveShifts, getMyShiftHistory,
  getShift, openShift, closeShift,
  getShiftSummary, getShiftAuditLog,
  preflightOpenShift,
} = require('../controllers/shifts.controller');
const { getShiftHistory } = require('../controllers/shift-history.controller');
const { overrideShiftConsumption, getShiftConsumption } = require('../controllers/override-consumption.controller');
const authenticate  = require('../middlewares/auth.middleware');
const inventoryAuth = require('../middlewares/inventory-auth.middleware');
const {
  requireShiftAccess,
  requireOwnerOrManager,
  requireSameStaffOrOwner,
} = require('../middlewares/shift-access.middleware');

// ── Named routes FIRST (before /:id) ─────────────────────────────────────────
router.get('/',            inventoryAuth, requireOwnerOrManager, getAllShifts);
router.get('/active',      authenticate,  getActiveShifts);
router.get('/my-history',  authenticate,  getMyShiftHistory);
router.get('/shift-history', authenticate, getShiftHistory);
router.get('/preflight',   authenticate,  requireShiftAccess(), preflightOpenShift);
router.post('/open',       authenticate,  requireShiftAccess(), openShift);
router.post('/:id/override-consumption', authenticate, overrideShiftConsumption);
router.get( '/:id/consumption',          authenticate, getShiftConsumption);
// ── Wildcard /:id AFTER ───────────────────────────────────────────────────────
router.get('/:id',         authenticate,  getShift);
router.get('/:id/summary', authenticate,  getShiftSummary);
router.get('/:id/audit',   authenticate,  getShiftAuditLog);   // ← fixed
router.patch('/:id/close', authenticate,  requireShiftAccess(), requireSameStaffOrOwner, closeShift);

module.exports = router;