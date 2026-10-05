const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const managers = requireRole('owner', 'manager', 'inventory_manager');
const ctrl    = require('../controllers/suppliers.controller');

router.get('/',      auth, ctrl.getAll);   // ← السطر الناقص
router.get('/:id',   auth, ctrl.getById);
router.post('/',     auth, managers, ctrl.create);
router.patch('/:id', auth, managers, ctrl.update);
router.delete('/:id', auth, managers, ctrl.remove);

module.exports = router;

