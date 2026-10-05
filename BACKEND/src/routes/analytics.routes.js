const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/auth.middleware');
const { getInventoryAnalytics } = require('../controllers/analytics.controller');

router.get('/', authenticate, getInventoryAnalytics);

module.exports = router;

