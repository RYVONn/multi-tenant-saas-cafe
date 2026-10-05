const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/auth.middleware');
const {
  getAllIssuances,
  createIssuance,
  deleteIssuance
} = require('../controllers/shift-issuance.controller');

router.get('/',       authenticate, getAllIssuances);
router.post('/',      authenticate, createIssuance);
router.delete('/:id', authenticate, deleteIssuance);

module.exports = router;

