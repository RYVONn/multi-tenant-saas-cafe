'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path   = require('path');
const fs     = require('fs');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Delete the image file on disk.
 * imageUrl in DB is stored as a RELATIVE path: "uploads/events/filename.jpg"
 * The uploads directory sits one level above src/, so:
 *   __dirname = .../src/controllers
 *   file root = __dirname/../../uploads/events/filename.jpg
 */
const deleteOldImage = (relPath) => {
  if (!relPath) return;
  // Guard: don't try to delete if it somehow got stored as a full URL
  const rel = relPath.startsWith('http')
    ? relPath.replace(/^https?:\/\/[^/]+\//, '')   // strip origin → "uploads/events/..."
    : relPath;
  const fullPath = path.join(__dirname, '..', '..', rel);
  if (fs.existsSync(fullPath)) {
    try { fs.unlinkSync(fullPath); }
    catch (e) { console.warn('[Events] Could not delete image:', fullPath, e.message); }
  }
};

/**
 * Build a full public URL from a stored relative path.
 *
 * ALWAYS derive host + protocol from the live request so the URL stays
 * correct across restarts, redeploys, and environment changes.
 *
 * Storage contract: DB always holds a RELATIVE path like
 *   "uploads/events/event-1234-abc.jpg"
 * Never store http:// or https:// URLs in the database.
 */
const toPublicUrl = (req, relPath) => {
  if (!relPath) return null;
  // Safety: if a legacy absolute URL slipped in, return it as-is (https only)
  if (relPath.startsWith('http')) {
    return relPath.replace(/^http:\/\//i, 'https://');
  }
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0]   // x-forwarded-proto can be "https, http" from some proxies
    .trim();
  const host = req.get('host');
  // Normalise slashes: remove leading slash from relPath if present
  const clean = relPath.replace(/^\//, '');
  return `${proto}://${host}/${clean}`;
};

/**
 * Serialise a Prisma Event record for API responses.
 * imageUrl in the response is always a full public URL;
 * imageUrl in the database is always a relative path.
 */
const formatEvent = (event, req) => ({
  ...event,
  imageUrl: toPublicUrl(req, event.imageUrl),
});

// =============================================================================
// GET /api/events  — public, only active events
// =============================================================================
exports.getPublicEvents = async (req, res) => {
  try {
    const events = await prisma.event.findMany({
      where:   { isActive: true },
      orderBy: { eventDate: 'asc' },
    });
    res.json({ events: events.map(e => formatEvent(e, req)) });
  } catch (err) {
    console.error('[Events] getPublicEvents:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
};

// =============================================================================
// GET /api/events/all  — manager, all events
// =============================================================================
exports.getAllEvents = async (req, res) => {
  try {
    const events = await prisma.event.findMany({
      orderBy: [{ eventDate: 'asc' }, { createdAt: 'desc' }],
    });
    res.json({ events: events.map(e => formatEvent(e, req)) });
  } catch (err) {
    console.error('[Events] getAllEvents:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
};

// =============================================================================
// GET /api/events/:id
// =============================================================================
exports.getEventById = async (req, res) => {
  try {
    const event = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: formatEvent(event, req) });
  } catch (err) {
    console.error('[Events] getEventById:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
};

// =============================================================================
// POST /api/events
// =============================================================================
exports.createEvent = async (req, res) => {
  try {
    const { title, description, eventDate, startTime, endTime, location, isActive } = req.body;

    if (!title?.trim())     return res.status(400).json({ error: 'Event title is required' });
    if (!eventDate)          return res.status(400).json({ error: 'Event date is required' });
    if (!startTime?.trim()) return res.status(400).json({ error: 'Start time is required' });
    if (!endTime?.trim())   return res.status(400).json({ error: 'End time is required' });

    // ── Store RELATIVE path only ───────────────────────────────────────────
    const imageRelPath = req.file
      ? `uploads/events/${req.file.filename}`
      : null;

    const event = await prisma.event.create({
      data: {
        title:       title.trim(),
        description: description?.trim() || null,
        imageUrl:    imageRelPath,           // ← relative, never absolute
        eventDate:   new Date(eventDate),
        startTime:   startTime.trim(),
        endTime:     endTime.trim(),
        location:    location?.trim() || null,
        isActive:    isActive === 'false' || isActive === false ? false : true,
      },
    });

    res.status(201).json({
      event:   formatEvent(event, req),
      message: 'Event created successfully',
    });
  } catch (err) {
    console.error('[Events] createEvent:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
};

// =============================================================================
// PUT /api/events/:id
// =============================================================================
exports.updateEvent = async (req, res) => {
  try {
    const existing = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    const { title, description, eventDate, startTime, endTime, location, isActive } = req.body;

    // ── Handle image replacement ───────────────────────────────────────────
    let imageRelPath = existing.imageUrl; // keep existing relative path
    if (req.file) {
      deleteOldImage(existing.imageUrl);                         // remove old file
      imageRelPath = `uploads/events/${req.file.filename}`;     // new relative path
    }

    const data = {};
    if (title       !== undefined) data.title       = title.trim();
    if (description !== undefined) data.description = description?.trim() || null;
    if (eventDate   !== undefined) data.eventDate   = new Date(eventDate);
    if (startTime   !== undefined) data.startTime   = startTime.trim();
    if (endTime     !== undefined) data.endTime     = endTime.trim();
    if (location    !== undefined) data.location    = location?.trim() || null;
    if (isActive    !== undefined) data.isActive    = isActive === 'false' || isActive === false ? false : true;
    if (req.file)                  data.imageUrl    = imageRelPath; // ← relative only

    const event = await prisma.event.update({
      where: { id: req.params.id },
      data,
    });

    res.json({
      event:   formatEvent(event, req),
      message: 'Event updated successfully',
    });
  } catch (err) {
    console.error('[Events] updateEvent:', err);
    res.status(500).json({ error: 'Failed to update event' });
  }
};

// =============================================================================
// PATCH /api/events/:id/toggle
// =============================================================================
exports.toggleActive = async (req, res) => {
  try {
    const existing = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    const event = await prisma.event.update({
      where: { id: req.params.id },
      data:  { isActive: !existing.isActive },
    });

    res.json({
      event:   formatEvent(event, req),
      message: event.isActive ? 'Event activated' : 'Event deactivated',
    });
  } catch (err) {
    console.error('[Events] toggleActive:', err);
    res.status(500).json({ error: 'Failed to toggle event status' });
  }
};

// =============================================================================
// DELETE /api/events/:id
// =============================================================================
exports.deleteEvent = async (req, res) => {
  try {
    const existing = await prisma.event.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Event not found' });

    deleteOldImage(existing.imageUrl);
    await prisma.event.delete({ where: { id: req.params.id } });

    res.json({ message: 'Event deleted successfully' });
  } catch (err) {
    console.error('[Events] deleteEvent:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
};