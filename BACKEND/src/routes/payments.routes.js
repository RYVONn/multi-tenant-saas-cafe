'use strict';

const express    = require('express');
const router     = express.Router();
const authenticate = require('../middlewares/auth.middleware');

const requireManagerOrOwner = (req, res, next) => {
  const role = (req.user?.role ?? '').toLowerCase();
  if (!['owner', 'manager', 'inventory_manager'].includes(role)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
};

const {
  recordReceiptPayment, setReceiptDueDate, getAccountsPayable,  getReceiptPayments,
  recordSalePayment,    setSaleDueDate,    getAccountsReceivable, getSalePayments,
} = require('../controllers/payments.controller');

// ── Accounts summaries ──
router.get('/accounts-payable',    authenticate, requireManagerOrOwner, getAccountsPayable);
router.get('/accounts-receivable', authenticate, requireManagerOrOwner, getAccountsReceivable);

// ── Receipt payments — مسارات منفصلة ──
router.post('/receipt-payments/:id',    authenticate, requireManagerOrOwner, recordReceiptPayment);
router.get('/receipt-payments/:id',     authenticate, requireManagerOrOwner, getReceiptPayments);
router.patch('/receipt-due-date/:id',   authenticate, requireManagerOrOwner, setReceiptDueDate);

// ── Sale payments — مسارات منفصلة ──
router.post('/sale-payments/:id',       authenticate, requireManagerOrOwner, recordSalePayment);
router.get('/sale-payments/:id',        authenticate, requireManagerOrOwner, getSalePayments);
router.patch('/sale-due-date/:id',      authenticate, requireManagerOrOwner, setSaleDueDate);

module.exports = router;