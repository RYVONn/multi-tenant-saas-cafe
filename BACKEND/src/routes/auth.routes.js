const express        = require('express');
const router         = express.Router();
const authController = require('../controllers/auth.controller');
const authenticate   = require('../middlewares/auth.middleware');

router.post('/login',       authController.login);
router.post('/register',    authController.register);
router.post('/staff/login', authController.loginStaff);
router.get ('/me',          authenticate.any, authController.me);

module.exports = router;

