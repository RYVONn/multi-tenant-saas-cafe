const express = require('express');
const router = express.Router();

const inventoryAuth  = require('../middlewares/inventory-auth.middleware');
const authenticate = require('../middlewares/auth.middleware'); // staff JWT middleware

const {
  getAllRequests,
  getRequest,
  createRequest,
  respondToRequest,
  deleteRequest,
} = require('../controllers/stock-requests.controller');

// ── Read: both staff and inventory managers can read requests ─────────────────
router.get('/',    authenticate, getAllRequests);
router.get('/:id', authenticate, getRequest);

// ── Create: staff only (authenticate = staff JWT) ─────────────────────────────
router.post('/', authenticate, createRequest);

// ── Respond / Delete: inventory managers and owners only ─────────────────────
router.post('/:id/respond', inventoryAuth, respondToRequest);
router.delete('/:id',       inventoryAuth, deleteRequest);

module.exports = router;