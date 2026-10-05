const express = require('express');
const router  = express.Router();
const { makeImageUpload } = require('../utils/safeUpload');
const auth    = require('../middlewares/auth.middleware');
const ctrl    = require('../controllers/inventory-waste.controller');

const upload = makeImageUpload('uploads/waste');

router.get('/',  auth, ctrl.getAll);
router.post('/', auth, upload.single('image'), ctrl.create);

module.exports = router;

