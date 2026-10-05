const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const controller = require('../controllers/order.controller');
const auth       = require('../middlewares/auth.middleware');

// ── Ensure upload directory exists ─────────────────────────
const uploadDir = path.join(__dirname, '../../uploads/payments');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ── Multer config ──────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `payment-${unique}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const okExt  = allowed.test(path.extname(file.originalname).toLowerCase());
    const okMime = allowed.test(file.mimetype);
    if (okExt && okMime) return cb(null, true);
    cb(new Error('Only image files are allowed (jpeg, jpg, png, webp)'));
  }
});

// ── Routes ─────────────────────────────────────────────────
router.get('/history',                auth.any, controller.getHistory);
router.post('/', auth.any, upload.single('payment_screenshot'), controller.createOrder);
router.get('/',                       auth.any, controller.getOrders);
router.patch('/:id/status',           auth, controller.updateStatus);
router.patch('/:id/verify-payment',   auth, controller.verifyPayment);

module.exports = router;

