const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── GET /api/settings ──────────────────────────────────────────────────────────
exports.getSettings = async (req, res) => {
  try {
    let settings = await prisma.store_settings.findUnique({ where: { id: 1 } });
    if (!settings) {
      settings = await prisma.store_settings.create({
        data: { id: 1, points_multiplier: 1 }
      });
    }
    res.json(settings);
  } catch (error) {
    console.error('[Settings] getSettings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
};

// ─── PATCH /api/settings ────────────────────────────────────────────────────────
// AZT: saturday_points_enabled + saturday_points_multiplier back the "1 EGP = 1
// point every Saturday" toggle. When enabled, order-completion points logic
// (order.controller.js) uses saturday_points_multiplier instead of
// points_multiplier for any order completed on a Saturday. Toggle it off any
// time to go back to the normal rate — nothing else changes automatically.
exports.updateSettings = async (req, res) => {
  try {
    const { points_multiplier, saturday_points_enabled, saturday_points_multiplier } = req.body;

    const update = {};
    const create = { id: 1 };

    if (points_multiplier !== undefined) {
      update.points_multiplier = parseFloat(points_multiplier);
      create.points_multiplier = parseFloat(points_multiplier);
    }
    if (saturday_points_enabled !== undefined) {
      const enabled = saturday_points_enabled === true || saturday_points_enabled === 'true';
      update.saturday_points_enabled = enabled;
      create.saturday_points_enabled = enabled;
    }
    if (saturday_points_multiplier !== undefined) {
      update.saturday_points_multiplier = parseFloat(saturday_points_multiplier);
      create.saturday_points_multiplier = parseFloat(saturday_points_multiplier);
    }

    const settings = await prisma.store_settings.upsert({
      where: { id: 1 },
      update,
      create,
    });

    res.json(settings);
  } catch (error) {
    console.error('[Settings] updateSettings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};
