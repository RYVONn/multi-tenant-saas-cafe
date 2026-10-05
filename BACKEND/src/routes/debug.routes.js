const express = require('express');
const router  = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma  = new PrismaClient();
const authenticate = require('../middlewares/auth.middleware');
const requireRole  = require('../middlewares/role.middleware');

// AZT SECURITY FIX (audit issue #1): these debug routes were live in
// production with ZERO authentication, leaking full inventory + purchase
// receipt data to anyone who found the URL. Now owner-only.
router.use(authenticate, requireRole('owner'));

// GET /api/debug/stock — بيرجع كل الـ items بقيمهم الحقيقية من الـ DB
router.get('/stock', async (req, res) => {
  const items = await prisma.stockItem.findMany({
    select: {
      id: true, name: true,
      quantity: true,
      packageCount: true,
      unit: true,
    },
    orderBy: { name: 'asc' },
  });
  res.json(items);
});
 
// GET /api/debug/receipts — آخر 5 receipts
router.get('/receipts', async (req, res) => {
  const receipts = await prisma.purchaseReceipt.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: { items: true },
  });
  res.json(receipts);
});
 
module.exports = router;

