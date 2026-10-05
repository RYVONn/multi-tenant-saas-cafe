const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getMovements = async (req, res) => {
  try {
    const { itemId, type, from, to, page = 1, limit = 50 } = req.query;

    const where = {
      ...(itemId && { itemId }),
      ...(type   && { type }),
      ...((from || to) && {
        createdAt: {
          ...(from && { gte: new Date(from) }),
          ...(to   && { lte: new Date(to) })
        }
      })
    };

    const [movements, total] = await Promise.all([
      prisma.inventoryMovement.findMany({
        where,
        include: { item: { select: { id: true, name: true, unit: true } } },
        orderBy: { createdAt: 'desc' },
        skip:  (parseInt(page) - 1) * parseInt(limit),
        take:  parseInt(limit)
      }),
      prisma.inventoryMovement.count({ where })
    ]);

    res.json({ movements, total, page: parseInt(page) });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
};

module.exports = { getMovements };