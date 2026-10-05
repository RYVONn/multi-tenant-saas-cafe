const express = require('express');
const router = express.Router();
const authenticate = require('../middlewares/auth.middleware');
const {
  getConsumptionLogs,
  createConsumptionLog,
  deleteConsumptionLog
} = require('../controllers/consumption.controller');

router.get('/',       authenticate, getConsumptionLogs);
router.post('/',      authenticate, createConsumptionLog);
router.delete('/:id', authenticate, deleteConsumptionLog);

module.exports = router;

