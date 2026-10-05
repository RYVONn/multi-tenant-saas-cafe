// BACKEND/src/controllers/notifications.controller.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { sendGenericPush } = require('./push.controller');

/**
 * createNotification — write to DB + emit socket events.
 *
 * Rules:
 *  - If recipientId is 'broadcast' (or absent), we only store a role-scoped row (no literal "broadcast" id).
 *  - Socket emits to BOTH the specific user room AND the role room so nothing is missed.
 *  - Returns the created notification record.
 */
const ROUTING_RULES = {
  // Orders
  'new_order': ['owner', 'morning_staff', 'evening_staff'],
  'order_updated': ['owner', 'morning_staff', 'evening_staff'],

  // Inventory
  'low_stock': ['inventory_manager', 'owner', 'development'],
  'item_expired': ['inventory_manager', 'owner', 'development'],
  'item_expiring_soon': ['inventory_manager', 'owner', 'development'],
  'stock_request': ['inventory_manager', 'owner', 'development'],
  'receipt_pending_approval': ['inventory_manager', 'owner', 'development'],
  'receipt_approved': ['inventory_manager', 'owner', 'development'],
  'receipt_rejected': ['inventory_manager', 'owner', 'development'],
  'receipt_payment_recorded': ['inventory_manager', 'owner', 'development'],
  'sale_payment_received': ['inventory_manager', 'owner', 'development'],
  'sale_completed': ['inventory_manager', 'owner', 'development'],
  'waste_logged': ['inventory_manager', 'owner', 'development'],
  'consumption_logged': ['inventory_manager', 'owner', 'development'],

  // Shifts
  'shift_opened': ['owner', 'development'],
  'shift_closed': ['owner', 'development'],
  'shift_closed_pending_requests': ['owner', 'development'],
  'stock_issued': ['owner', 'development'],
  'ISSUANCE': ['owner', 'development'],
  'ISSUANCE_REVERSAL': ['owner', 'development'],
};

const createNotification = async (io, {
  recipientId,
  recipientRole,
  type,
  title,
  body,
  data = null,
}) => {
  const isBroadcast = !recipientId || recipientId === 'broadcast';

  if (isBroadcast && ROUTING_RULES[type]) {
    const targetRoles = ROUTING_RULES[type];
    const createdNotifs = [];

    for (const role of targetRoles) {
      const notif = await prisma.notification.create({
        data: {
          recipientId: role,
          recipientRole: role,
          type,
          title,
          body,
          data,
          isRead: false,
        },
      });

      if (io) {
        io.to(`role:${role}`).emit('notification', notif);
      }
      sendGenericPush(notif).catch(err => console.error('Background push failed:', err));
      createdNotifs.push(notif);
    }
    
    return createdNotifs[0];
  }

  // Fallback for types not in ROUTING_RULES or non-broadcast
  const notif = await prisma.notification.create({
    data: {
      recipientId:   isBroadcast ? recipientRole : recipientId,
      recipientRole: recipientRole ?? 'all',
      type,
      title,
      body,
      data,
      isRead: false,
    },
  });

  if (io) {
    if (recipientRole) {
      io.to(`role:${recipientRole}`).emit('notification', notif);
    }
    if (!isBroadcast) {
      io.to(`user:${recipientId}`).emit('notification', notif);
    }
  }

  sendGenericPush(notif).catch(err => console.error('Background push failed:', err));

  return notif;
};

// GET /api/inventory/notifications
const getNotifications = async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 30);

    const where = {
      OR: [
        { recipientId: userId },
        { recipientId: role },   // broadcast rows use role as recipientId
        { recipientRole: role },
      ],
    };

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:  (page - 1) * limit,
        take:  limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...where, isRead: false } }),
    ]);

    res.json({ items, total, unreadCount, page });
  } catch (err) {
    console.error('getNotifications error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/inventory/notifications/unread-count
const getUnreadCount = async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const count = await prisma.notification.count({
      where: {
        OR: [
          { recipientId: userId },
          { recipientId: role },
          { recipientRole: role },
        ],
        isRead: false,
      },
    });
    res.json({ count });
  } catch (err) {
    console.error('getUnreadCount error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/inventory/notifications/:id/read
const markRead = async (req, res) => {
  try {
    await prisma.notification.update({
      where: { id: req.params.id },
      data:  { isRead: true },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('markRead error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/inventory/notifications/read-all
const markAllRead = async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    await prisma.notification.updateMany({
      where: {
        OR: [
          { recipientId: userId },
          { recipientId: role },
          { recipientRole: role },
        ],
        isRead: false,
      },
      data: { isRead: true },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('markAllRead error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { createNotification, getNotifications, getUnreadCount, markRead, markAllRead };