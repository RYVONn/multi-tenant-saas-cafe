// src/routes/events.routes.js
const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const controller = require('../controllers/events.controller');

// ─── Ensure upload directory exists ──────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'events');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Multer config ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file, cb) => {
    const ext  = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }[file.mimetype] || '.jpg';
    const name = `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = /image\/(jpeg|jpg|png|gif|webp)/;
  allowed.test(file.mimetype)
    ? cb(null, true)
    : cb(new Error('Only image files are allowed'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ─── Auth middleware helpers ──────────────────────────────────────────────────
// Re-use your existing JWT/inventory auth middleware. Adjust the import paths
// to match your project structure.

// Public JWT auth (for owner/manager dashboard calls)
const authenticate = require('../middlewares/auth.middleware');      // adjust path


// Guard: allow owner, manager, or inventory_manager
const managerGuard = (req, res, next) => {
  const role = (req.user?.role ?? '').toLowerCase();
  const allowed = ['owner', 'manager', 'inventory_manager'];
  if (allowed.includes(role)) return next();
  return res.status(403).json({ error: 'Access denied' });
};

// ─── Public routes (no auth) ──────────────────────────────────────────────────
// Used by the customer-facing website
router.get('/', controller.getPublicEvents);

// ─── Protected routes (manager / owner) ──────────────────────────────────────
router.get('/all', authenticate, managerGuard, controller.getAllEvents);
router.get('/:id', authenticate, managerGuard, controller.getEventById);
router.post('/', authenticate, managerGuard, upload.single('image'), controller.createEvent);
router.put('/:id', authenticate, managerGuard, upload.single('image'), controller.updateEvent);
router.patch('/:id/toggle', authenticate, managerGuard, controller.toggleActive);
router.delete('/:id', authenticate, managerGuard, controller.deleteEvent);

module.exports = router;

