/**
 * storefront.controller.js
 *
 * Backs the dashboard's "Store Front" section: the logo, hero image/text,
 * About Us copy, and a "Memories" image gallery — all of which feed the
 * customer-facing site. Every image field is a Cloudinary secure_url; the
 * dashboard uploads a file, this controller pushes it to Cloudinary and
 * stores the resulting URL (never a local path).
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const { destroyByPublicId, publicIdFromUrl } = require('../utils/cloudinary');

const prisma = new PrismaClient();

// ─── GET /api/storefront ────────────────────────────────────────────────────────
// Public — the customer-facing site reads this to render the storefront.
exports.getStorefront = async (req, res) => {
  try {
    let settings = await prisma.storefront_settings.findUnique({ where: { id: 1 } });
    if (!settings) {
      settings = await prisma.storefront_settings.create({ data: { id: 1 } });
    }

    const memories = await prisma.storefront_memories.findMany({
      orderBy: { sort_order: 'asc' },
    });

    res.json({ ...settings, memories });
  } catch (error) {
    console.error('[Storefront] getStorefront error:', error);
    res.status(500).json({ error: 'Failed to fetch storefront settings' });
  }
};

// ─── PATCH /api/storefront ──────────────────────────────────────────────────────
// Dashboard (owner/manager) — update any combination of text fields + images.
// Multipart form fields: logo, navbar_icon, hero_image, about_us_image (files, optional)
//                         hero_title, hero_title_ar, hero_subtitle, hero_subtitle_ar,
//                         about_us_title, about_us_title_ar, about_us_text, about_us_text_ar (text, optional)
exports.updateStorefront = async (req, res) => {
  try {
    const {
      hero_title, hero_title_ar,
      hero_subtitle, hero_subtitle_ar,
      about_us_title, about_us_title_ar,
      about_us_text, about_us_text_ar,
    } = req.body;
    const files = req.files || {};

    const existing = await prisma.storefront_settings.findUnique({ where: { id: 1 } });

    const data = {};
    if (hero_title         !== undefined) data.hero_title         = hero_title || null;
    if (hero_title_ar      !== undefined) data.hero_title_ar      = hero_title_ar || null;
    if (hero_subtitle      !== undefined) data.hero_subtitle      = hero_subtitle || null;
    if (hero_subtitle_ar   !== undefined) data.hero_subtitle_ar   = hero_subtitle_ar || null;
    if (about_us_title     !== undefined) data.about_us_title     = about_us_title || null;
    if (about_us_title_ar  !== undefined) data.about_us_title_ar  = about_us_title_ar || null;
    if (about_us_text      !== undefined) data.about_us_text      = about_us_text || null;
    if (about_us_text_ar   !== undefined) data.about_us_text_ar   = about_us_text_ar || null;

    // Track old URLs to clean up on Cloudinary after a successful DB write
    const toDelete = [];

    if (files.logo?.[0]) {
      if (existing?.logo_url) toDelete.push(existing.logo_url);
      data.logo_url = files.logo[0].path; // Cloudinary secure_url
    }
    if (files.navbar_icon?.[0]) {
      if (existing?.navbar_icon_url) toDelete.push(existing.navbar_icon_url);
      data.navbar_icon_url = files.navbar_icon[0].path;
    }
    if (files.hero_image?.[0]) {
      if (existing?.hero_image_url) toDelete.push(existing.hero_image_url);
      data.hero_image_url = files.hero_image[0].path;
    }
    if (files.about_us_image?.[0]) {
      if (existing?.about_us_image_url) toDelete.push(existing.about_us_image_url);
      data.about_us_image_url = files.about_us_image[0].path;
    }

    const settings = await prisma.storefront_settings.upsert({
      where:  { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });

    for (const url of toDelete) {
      await destroyByPublicId(publicIdFromUrl(url));
    }

    res.json(settings);
  } catch (error) {
    console.error('[Storefront] updateStorefront error:', error);
    res.status(500).json({ error: 'Failed to update storefront settings' });
  }
};

// ─── GET /api/storefront/memories ───────────────────────────────────────────────
exports.getMemories = async (req, res) => {
  try {
    const memories = await prisma.storefront_memories.findMany({
      orderBy: { sort_order: 'asc' },
    });
    res.json({ memories });
  } catch (error) {
    console.error('[Storefront] getMemories error:', error);
    res.status(500).json({ error: 'Failed to fetch memories' });
  }
};

// ─── POST /api/storefront/memories ──────────────────────────────────────────────
// Multipart: image (file, required), caption (text, optional)
exports.addMemory = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'image file is required' });

    const { caption } = req.body;

    const { _max } = await prisma.storefront_memories.aggregate({ _max: { sort_order: true } });
    const nextSortOrder = (_max.sort_order ?? -1) + 1;

    const memory = await prisma.storefront_memories.create({
      data: {
        image_url:  req.file.path, // Cloudinary secure_url
        caption:    caption || null,
        sort_order: nextSortOrder,
      },
    });

    res.status(201).json({ memory });
  } catch (error) {
    console.error('[Storefront] addMemory error:', error);
    res.status(500).json({ error: 'Failed to add memory' });
  }
};

// ─── PATCH /api/storefront/memories/reorder ─────────────────────────────────────
// Body: { order: string[] } — full list of memory ids in the desired order.
exports.reorderMemories = async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: 'order must be a non-empty array of memory ids' });
    }

    await prisma.$transaction(
      order.map((id, index) =>
        prisma.storefront_memories.update({ where: { id }, data: { sort_order: index } })
      )
    );

    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'One of the memory ids was not found' });
    console.error('[Storefront] reorderMemories error:', error);
    res.status(500).json({ error: 'Failed to reorder memories' });
  }
};

// ─── DELETE /api/storefront/memories/:id ────────────────────────────────────────
exports.deleteMemory = async (req, res) => {
  try {
    const { id } = req.params;

    const memory = await prisma.storefront_memories.findUnique({ where: { id } });
    if (!memory) return res.status(404).json({ error: 'Memory not found' });

    await destroyByPublicId(publicIdFromUrl(memory.image_url));
    await prisma.storefront_memories.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Memory not found' });
    console.error('[Storefront] deleteMemory error:', error);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
};
