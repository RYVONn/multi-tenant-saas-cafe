/**
 * receipts.router.js
 *
 * Routes:
 *   GET    /                       → كل الـ receipts
 *   GET    /pending                → الـ receipts اللي في انتظار الموافقة
 *   GET    /supplier-analytics     → إحصائيات الـ suppliers
 *   POST   /                       → إنشاء receipt جديد (pending فقط — مش بيأثر على stock)
 *   POST   /:id/approve            → موافقة على receipt (هنا بيتأثر الـ stock)
 *   POST   /:id/reject             → رفض receipt (مش بيأثر على stock)
 *   DELETE /:id                    → حذف receipt (pending أو rejected فقط)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { makeImageUpload } = require('../utils/safeUpload');
const resolveManager = require('../middlewares/resolve-manager.middleware');
const inventoryAuth = require('../middlewares/inventory-auth.middleware');
const {
  getAllReceipts,
  createReceipt,
  approveReceipt,
  rejectReceipt,
  deleteReceipt,
  getPendingReceipts,
  getSupplierAnalytics,
} = require('../controllers/purchase-receipts.controller');

// ── Upload setup ──────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'receipts');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = makeImageUpload(UPLOAD_DIR);

// ── Routes ────────────────────────────────────────────────────────────────────

// القوائم (لازم يكونوا قبل /:id)
router.get('/pending',             inventoryAuth, getPendingReceipts);
router.get('/supplier-analytics',  inventoryAuth, getSupplierAnalytics);
router.get('/',                    inventoryAuth, getAllReceipts);

// إنشاء receipt جديد
router.post('/',            inventoryAuth, resolveManager, upload.single('receiptPhoto'), createReceipt);
router.post('/:id/approve', inventoryAuth, resolveManager, approveReceipt);
router.post('/:id/reject',  inventoryAuth, resolveManager, rejectReceipt);
router.delete('/:id',       inventoryAuth, resolveManager, deleteReceipt);

module.exports = router;

