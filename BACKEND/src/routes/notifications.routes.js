const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/auth.middleware');
const { getNotifications, markRead, markAllRead, getUnreadCount } = require('../controllers/notifications.controller');

router.get('/unread-count',   authenticate, getUnreadCount);  // ← السطر الناقص
router.get('/',               authenticate, getNotifications);
router.patch('/read-all',     authenticate, markAllRead);
router.patch('/:id/read',     authenticate, markRead);

module.exports = router;

