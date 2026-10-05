const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/auth.middleware');
const { getMovements } = require('../controllers/inventory-movements.controller');

router.get('/', auth, getMovements);

module.exports = router;

