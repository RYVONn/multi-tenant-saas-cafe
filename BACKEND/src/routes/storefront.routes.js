const express = require('express');
const router  = express.Router();
const controller = require('../controllers/storefront.controller');
const authenticate = require('../middlewares/auth.middleware');
const { requireOwnerOrManager } = require('../middlewares/shift-access.middleware');
const { makeCloudinaryUpload } = require('../utils/cloudinaryStorage');

const settingsUpload = makeCloudinaryUpload('bleu/storefront');
const memoryUpload   = makeCloudinaryUpload('bleu/storefront/memories');

// ── Public — customer-facing site reads storefront content ─────────────────────
router.get('/', controller.getStorefront);
router.get('/memories', controller.getMemories);

// ── Dashboard (owner/manager only) ──────────────────────────────────────────────
router.patch(
  '/',
  authenticate,
  requireOwnerOrManager,
  settingsUpload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'navbar_icon', maxCount: 1 },
    { name: 'hero_image', maxCount: 1 },
    { name: 'about_us_image', maxCount: 1 },
  ]),
  controller.updateStorefront
);

router.post(
  '/memories',
  authenticate,
  requireOwnerOrManager,
  memoryUpload.single('image'),
  controller.addMemory
);

router.patch('/memories/reorder', authenticate, requireOwnerOrManager, controller.reorderMemories);
router.delete('/memories/:id',    authenticate, requireOwnerOrManager, controller.deleteMemory);

module.exports = router;
