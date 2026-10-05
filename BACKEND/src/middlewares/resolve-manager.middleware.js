// middlewares/resolve-manager.middleware.js
'use strict';

const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * يضيف req.inventoryManagerId على الـ request.
 * 
 * لو المستخدم inventory_manager → req.user.id هو نفسه الـ InventoryManager.id
 * لو owner/manager → بنحتاج InventoryManager record مرتبط بيه
 * الحل: نبحث بالـ email عن InventoryManager، لو مش موجود ننشئه.
 */
const resolveInventoryManager = async (req, res, next) => {
  try {
    // If inventoryAuth already resolved an FK-safe ID, keep it
    if (req.inventoryManagerId) {
      return next();
    }

    // Otherwise, always find or create an InventoryManager by email to ensure a valid Foreign Key
    const email = req.user?.email;
    if (!email) {
      return res.status(401).json({ error: 'Cannot resolve manager: no email in token' });
    }

    let manager = await prisma.inventoryManager.findUnique({
      where: { email },
    });

    // لو مش موجود → أنشئه تلقائياً (owner/manager المرة الأولى)
    if (!manager) {
      manager = await prisma.inventoryManager.create({
        data: {
          email,
          name:     req.user.name ?? req.user.shift_name ?? 'Manager',
          password: '!sso-managed:' + crypto.randomBytes(32).toString('hex'), // never a valid bcrypt hash -> cannot be used to log in
        },
      });
      console.log('[resolveManager] Created InventoryManager for:', email);
    }

    req.inventoryManagerId = manager.id;
    next();
  } catch (err) {
    console.error('[resolveManager] error:', err.message);
    res.status(500).json({ error: 'Failed to resolve inventory manager' });
  }
};

module.exports = resolveInventoryManager;