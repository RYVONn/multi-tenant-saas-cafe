/**
 * inventory-auth.routes.js
 * Place at: BACKEND/src/routes/inventory-auth.routes.js
 *
 * ROOT CAUSE OF CRASH (TypeError: argument handler must be a function):
 *   The crash occurred at line 10 (router.post('/login', loginInventoryManager))
 *   because inventory-auth.controller.js had been overwritten with a middleware
 *   function — so loginInventoryManager was undefined when destructured.
 *
 * FIX: Restored controller. Routes here are unchanged in structure,
 * but now use inventory-auth.middleware for the /me route (not the generic
 * auth.middleware which doesn't validate InventoryManager table existence).
 */

const express = require('express');
const router  = express.Router();

const inventoryAuthMiddleware = require('../middlewares/inventory-auth.middleware');
const authenticate = require('../middlewares/auth.middleware');
const requireRole  = require('../middlewares/role.middleware');
const {
  loginInventoryManager,
  createInventoryManager,
  getInventoryManagerMe
} = require('../controllers/inventory-auth.controller');

// Public route
router.post('/login', loginInventoryManager);

// AZT SECURITY FIX (audit issue #3): anyone could hit this and create a new
// inventory-manager account with zero auth. Now only an existing owner
// (logged into the main dashboard) can provision a new inventory manager.
router.post('/setup', authenticate, requireRole('owner'), createInventoryManager);

// Protected route — must use inventory-auth middleware, not generic auth
router.get('/me', inventoryAuthMiddleware, getInventoryManagerMe);

module.exports = router;

