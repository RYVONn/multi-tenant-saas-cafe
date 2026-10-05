'use strict';

const express       = require('express');
const router        = express.Router();
const inventoryAuth = require('../middlewares/inventory-auth.middleware');
const authenticate  = require('../middlewares/auth.middleware');
const controller    = require('../controllers/stock.controller');

// ── Auth helpers ──────────────────────────────────────────────────────────────

// Staff JWT أو Inventory JWT — read-only endpoints
const anyAuth = (req, res, next) => {
  authenticate(req, res, (staffErr) => {
    if (req.user) return next();
    inventoryAuth(req, res, next);
  });
};

// Owner-only guard (يشتغل بعد authenticate)
const ownerOnly = (req, res, next) => {
  const role = (req.user?.role ?? '').toLowerCase();
  if (role === 'owner') return next();
  return res.status(403).json({ error: 'Owner access required for this action' });
};

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/',    anyAuth,       controller.getAllStock);
router.post('/',   inventoryAuth, controller.createStockItem);

// Force delete — owner only — MUST be before /:id to avoid conflict
router.delete('/:id/force', authenticate, ownerOnly, controller.forceDeleteStockItem);

router.patch('/:id/archive', inventoryAuth, controller.archiveStockItem);
router.patch('/:id',         inventoryAuth, controller.updateStockItem);
router.delete('/:id',        inventoryAuth, controller.deleteStockItem);

module.exports = router;