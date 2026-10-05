// routes/push.routes.js
const router = require('express').Router();
const { subscribe, unsubscribe } = require('../controllers/push.controller');

router.post('/subscribe',   subscribe);
router.delete('/unsubscribe', unsubscribe);

module.exports = router;

