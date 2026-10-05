const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const buildAuth = (allowCustomer) => async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
      return res.status(401).json({ error: 'No token provided' });

    const token   = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);


    if (decoded.role === 'customer') {
      // Customer tokens are rejected on staff routes unless explicitly allowed.
      if (!allowCustomer) return res.status(403).json({ error: 'Forbidden: staff only' });
      req.user = decoded;
      return next();
    }

    const staffRecord = await prisma.shifts.findUnique({
      where: { id: decoded.id },
      select: {
        id:                 true,
        shift_name:         true,
        role:               true,
        email:              true,
        allowed_shift_type: true,
      },
    });


    if (staffRecord) {
      req.user = {
        id:                 staffRecord.id,
        name:               staffRecord.shift_name ?? 'Staff',
        shift_name:         staffRecord.shift_name ?? 'Staff',
        email:              staffRecord.email,
        role:               (staffRecord.role ?? 'staff').toLowerCase(),
        allowed_shift_type: staffRecord.allowed_shift_type ?? null,
      };
      return next();
    }

    const invManager = await prisma.inventoryManager.findUnique({
      where:  { id: decoded.id },
      select: { id: true, name: true, email: true },
    });

    if (invManager) {
      req.user = {
        id:                 invManager.id,
        name:               invManager.name,
        shift_name:         invManager.name,
        email:              invManager.email,
        role:               'inventory_manager',
        allowed_shift_type: null,
      };
      return next();
    }

    return res.status(401).json({ error: 'Account not found' });

  } catch (err) {
    console.error('[authenticate] error:', err.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Default export: STAFF ONLY (customer tokens get 403).
// authenticate.any      -> customers and staff (use with ownership checks)
const authenticate = buildAuth(false);
authenticate.any = buildAuth(true);
// authenticate.optional -> sets req.user for a valid STAFF token, otherwise
// continues anonymously (never rejects). Used by public endpoints that expose
// extra data to staff only.
const staffAuth = buildAuth(false);
authenticate.optional = (req, res, next) => {
  if (!req.headers.authorization) return next();
  const silentRes = { status: () => ({ json: () => next() }) };
  return staffAuth(req, silentRes, next);
};

module.exports = authenticate;