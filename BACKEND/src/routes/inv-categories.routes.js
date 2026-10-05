const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const managers = requireRole('owner', 'manager', 'inventory_manager');
const ctrl    = require('../controllers/inv-categories.controller');

router.get('/',    auth, ctrl.getAll);
router.post('/',   auth, managers, ctrl.create);
router.delete('/:id', auth, managers, ctrl.remove);

module.exports = router;

