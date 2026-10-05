const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getAll = async (req, res) => {
  try {
    const cats = await prisma.inventoryCategory.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: true } } }
    });
    res.json(cats);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
};

const create = async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const cat = await prisma.inventoryCategory.create({ data: { name, color } });
    res.status(201).json(cat);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Category already exists' });
    res.status(500).json({ error: 'Server error' });
  }
};

const remove = async (req, res) => {
  try {
    await prisma.inventoryCategory.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getAll, create, remove };