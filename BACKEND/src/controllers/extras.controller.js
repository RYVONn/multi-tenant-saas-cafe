const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ════════════════════════════════════════════════════════════
//  EXTRA CATEGORIES
// ════════════════════════════════════════════════════════════

// GET /api/extras/categories
exports.getExtraCategories = async (req, res) => {
  try {
    const categories = await prisma.extra_categories.findMany({
      include: {
        extras: {
          where:   { available: true },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { sort_order: 'asc' },
    });
    res.json(categories);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch extra categories' });
  }
};

// POST /api/extras/categories
// Body: { name, sort_order? }
exports.createExtraCategory = async (req, res) => {
  try {
    const { name, sort_order } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const category = await prisma.extra_categories.create({
      data: {
        name:       name.trim(),
        sort_order: sort_order ?? 0,
      },
    });
    res.status(201).json(category);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create extra category' });
  }
};

// PATCH /api/extras/categories/:id
// Body: { name?, sort_order? }
exports.updateExtraCategory = async (req, res) => {
  try {
    const { id }                  = req.params;
    const { name, sort_order }    = req.body;
    const data = {};
    if (name       !== undefined) data.name       = name.trim();
    if (sort_order !== undefined) data.sort_order = sort_order;

    const category = await prisma.extra_categories.update({ where: { id }, data });
    res.json(category);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
    res.status(500).json({ error: 'Failed to update category' });
  }
};

// DELETE /api/extras/categories/:id
exports.deleteExtraCategory = async (req, res) => {
  try {
    const { id } = req.params;
    // extras in this category will have their category set to null (SetNull in schema)
    await prisma.extra_categories.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
    res.status(500).json({ error: 'Failed to delete category' });
  }
};

// ════════════════════════════════════════════════════════════
//  EXTRAS
// ════════════════════════════════════════════════════════════

// GET /api/extras
// Optional query: ?category_id=xxx  &available=true
exports.getExtras = async (req, res) => {
  try {
    const { category_id, available } = req.query;
    const where = {};
    if (category_id) where.extra_category_id = category_id;
    if (available   !== undefined) where.available = available === 'true';

    const extras = await prisma.extras.findMany({
      where,
      include: { extra_category: true },
      orderBy: [{ extra_category: { sort_order: 'asc' } }, { name: 'asc' }],
    });
    res.json(extras);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch extras' });
  }
};

// POST /api/extras
// Body: { name, price, extra_category_id?, available? }
exports.createExtra = async (req, res) => {
  try {
    const { name, price, extra_category_id, available } = req.body;

    if (!name?.trim())             return res.status(400).json({ error: 'name is required' });
    if (price === undefined || isNaN(Number(price)) || Number(price) < 0) {
      return res.status(400).json({ error: 'valid price is required (0 or more)' });
    }

    const extra = await prisma.extras.create({
      data: {
        name:              name.trim(),
        price:             Number(price),
        extra_category_id: extra_category_id || null,
        available:         available !== undefined ? Boolean(available) : true,
      },
      include: { extra_category: true },
    });
    res.status(201).json(extra);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create extra' });
  }
};

// PATCH /api/extras/:id
// Body: { name?, price?, extra_category_id?, available? }
exports.updateExtra = async (req, res) => {
  try {
    const { id }                                          = req.params;
    const { name, price, extra_category_id, available }  = req.body;
    const data = {};

    if (name              !== undefined) data.name              = name.trim();
    if (price             !== undefined) {
      if (isNaN(Number(price)) || Number(price) < 0) {
        return res.status(400).json({ error: 'Invalid price' });
      }
      data.price = Number(price);
    }
    if (extra_category_id !== undefined) data.extra_category_id = extra_category_id || null;
    if (available         !== undefined) data.available         = Boolean(available);

    const extra = await prisma.extras.update({
      where: { id },
      data,
      include: { extra_category: true },
    });
    res.json(extra);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Extra not found' });
    console.error(error);
    res.status(500).json({ error: 'Failed to update extra' });
  }
};

// DELETE /api/extras/:id
exports.deleteExtra = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.extras.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Extra not found' });
    res.status(500).json({ error: 'Failed to delete extra' });
  }
};