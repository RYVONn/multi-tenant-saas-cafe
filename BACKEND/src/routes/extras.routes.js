const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/extras.controller');
const auth       = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const managers = requireRole('owner', 'manager', 'inventory_manager');

// ── Extra Categories ───────────────────────────────────────
router.get   ('/categories',     controller.getExtraCategories);
router.post  ('/categories',     auth, managers, controller.createExtraCategory);
router.patch ('/categories/:id', auth, managers, controller.updateExtraCategory);
router.delete('/categories/:id', auth, managers, controller.deleteExtraCategory);

// ── Extras ────────────────────────────────────────────────
router.get   ('/',    controller.getExtras);
router.post  ('/',    auth, managers, controller.createExtra);
router.patch ('/:id', auth, managers, controller.updateExtra);
router.delete('/:id', auth, managers, controller.deleteExtra);

module.exports = router;

