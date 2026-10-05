// BACKEND/src/controllers/analytics.controller.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getInventoryAnalytics = async (req, res) => {
  const { from, to } = req.query;
  const dateFilter = {
    gte: from ? new Date(from) : new Date(Date.now() - 30 * 86400_000),
    lte: to ? new Date(to) : new Date()
  };

  const [consumptions, purchases, stockItems] = await Promise.all([
    prisma.consumptionLogItem.findMany({
      where: { log: { createdAt: dateFilter } },
      include: { item: true, log: { select: { createdAt: true, shiftId: true } } }
    }),
    prisma.purchaseReceiptItem.findMany({
      where: { receipt: { purchaseDate: dateFilter } },
      include: { item: true, receipt: { select: { supplierName: true, purchaseDate: true } } }
    }),
    prisma.stockItem.findMany()
  ]);

  // aggregate consumption per item
  const consumptionMap = {};
  for (const c of consumptions) {
    if (!consumptionMap[c.itemId]) {
      consumptionMap[c.itemId] = { name: c.item.name, unit: c.item.unit, total: 0 };
    }
    consumptionMap[c.itemId].total += c.quantity;
  }

  // aggregate cost per item
  const costMap = {};
  let totalSpend = 0;
  for (const p of purchases) {
    const cost = (p.unitCost ?? 0) * p.quantity;
    totalSpend += cost;
    if (!costMap[p.itemId]) costMap[p.itemId] = { name: p.item.name, total: 0, qty: 0 };
    costMap[p.itemId].total += cost;
    costMap[p.itemId].qty += p.quantity;
  }

  // supplier breakdown
  const supplierMap = {};
  for (const p of purchases) {
    const s = p.receipt.supplierName ?? 'Unknown';
    if (!supplierMap[s]) supplierMap[s] = { spend: 0, purchases: 0 };
    supplierMap[s].spend += (p.unitCost ?? 0) * p.quantity;
    supplierMap[s].purchases++;
  }

  res.json({
    period: { from: dateFilter.gte, to: dateFilter.lte },
    totalSpend,
    topConsumed: Object.values(consumptionMap).sort((a, b) => b.total - a.total).slice(0, 10),
    supplierBreakdown: supplierMap,
    stockStatus: stockItems.map(s => ({
      id: s.id,
      name: s.name,
      unit: s.unit,
      quantity: s.quantity,
      minQuantity: s.minQuantity,
      isLow: s.quantity <= s.minQuantity,
      buyPrice: s.purchasePrice,
      sellPrice: s.sellingPrice
    }))
  });
};

module.exports = { getInventoryAnalytics };