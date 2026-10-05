const jwt    = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const inventoryAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
      return res.status(401).json({ error: 'No token provided' });

    const token   = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ── inventory_manager ─────────────────────────────────────────────────
    if (decoded.role === 'inventory_manager') {
      let manager = await prisma.inventoryManager.findUnique({
        where:  { id: decoded.id },
        select: { id: true, name: true, email: true },
      });

      if (!manager) {
        // Fallback for inventory managers in shifts table
        const staff = await prisma.shifts.findUnique({
          where:  { id: decoded.id },
          select: { id: true, shift_name: true, email: true, role: true },
        });

        if (staff && staff.role === 'inventory_manager') {
          manager = { id: staff.id, name: staff.shift_name, email: staff.email };
          
          const proxyManager = await prisma.inventoryManager.findFirst({
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          });
          req.inventoryManagerId = proxyManager?.id ?? null;
        }
      }

      if (!manager)
        return res.status(401).json({ error: 'Manager account not found' });

      req.user = {
        id:    manager.id,
        name:  manager.name,
        email: manager.email,
        role:  'inventory_manager',
      };
      
      // Only set FK if it wasn't already set by the fallback
      if (req.inventoryManagerId === undefined) {
        req.inventoryManagerId = manager.id; // ← FK-safe ID
      }
      return next();
    }

    // ── owner ─────────────────────────────────────────────────────────────
    if (decoded.role === 'owner') {
      const owner = await prisma.shifts.findUnique({
        where:  { id: decoded.id },
        select: { id: true, shift_name: true, email: true, role: true },
      });
      if (!owner)
        return res.status(401).json({ error: 'Owner account not found' });

      req.user = {
        id:         owner.id,           // shifts UUID — للاستخدام العام
        name:       owner.shift_name ?? 'Owner',
        shift_name: owner.shift_name ?? 'Owner',
        email:      owner.email,
        role:       'owner',
      };

      // Owner مش في InventoryManager table —
      // بنجيب أول inventory manager موجود كـ proxy للـ FK
      // أو بنخلي req.inventoryManagerId = null ونعالجه في الـ controller
      const proxyManager = await prisma.inventoryManager.findFirst({
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      req.inventoryManagerId = proxyManager?.id ?? null;

      return next();
    }

    return res.status(403).json({ error: 'Access denied: inventory managers and owners only' });

  } catch (err) {
    console.error('inventoryAuth error:', err.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = inventoryAuth;