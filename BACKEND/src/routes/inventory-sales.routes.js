const express = require('express');
const router  = express.Router();
const { makeImageUpload } = require('../utils/safeUpload');
const inventoryAuth      = require('../middlewares/inventory-auth.middleware');
const resolveManager     = require('../middlewares/resolve-manager.middleware');
const ctrl               = require('../controllers/inventory-sales.controller');


const upload = makeImageUpload('uploads/invoices');

router.get('/',    inventoryAuth, ctrl.getAll);
router.post('/',   inventoryAuth, resolveManager, upload.single('invoiceImage'), ctrl.create);
router.patch('/:id/payment', inventoryAuth, ctrl.updatePayment);

module.exports = router;

