const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const authenticate = require('../middlewares/auth.middleware');
const { requireOwnerOrManager } = require('../middlewares/shift-access.middleware');

router.get('/', settingsController.getSettings);
router.patch('/', authenticate, requireOwnerOrManager, settingsController.updateSettings);

module.exports = router;
