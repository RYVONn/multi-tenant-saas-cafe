/**
 * inventory-auth.controller.js
 *
 * ROOT CAUSE OF CRASH:
 *   This file was overwritten with a middleware function.
 *   inventory-auth.routes.js imports { loginInventoryManager, createInventoryManager,
 *   getInventoryManagerMe } — all were undefined → TypeError on server start.
 *
 * FIX: Restored all three controller functions.
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

const prisma = new PrismaClient();

// ─── POST /api/inventory/auth/login ──────────────────────────────────────────
const loginInventoryManager = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'email and password are required' });

    const manager = await prisma.inventoryManager.findUnique({ where: { email } });

    if (!manager)
      return res.status(401).json({ error: 'Invalid credentials' });

    // SSO-managed placeholder rows can never log in directly.
    if (manager.password === 'sso-managed' || manager.password.startsWith('!sso-managed'))
      return res.status(401).json({ error: 'Invalid credentials' });

    // bcrypt only. Legacy plaintext rows must first be migrated with
    // `node scripts/hash-staff-passwords.js`; anything that isn't a bcrypt
    // hash is rejected.
    if (typeof password !== 'string' || !manager.password.startsWith('$2'))
      return res.status(401).json({ error: 'Invalid credentials' });

    const passwordValid = await bcrypt.compare(password, manager.password);

    if (!passwordValid)
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: manager.id, email: manager.email, role: 'inventory_manager' },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id:    manager.id,
        name:  manager.name,
        email: manager.email,
        role:  'inventory_manager'
      }
    });
  } catch (err) {
    console.error('loginInventoryManager error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── POST /api/inventory/auth/setup ──────────────────────────────────────────
// One-time setup endpoint — disable or remove after first manager is created.
const createInventoryManager = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name)
      return res.status(400).json({ error: 'email, password, and name are required' });

    const existing = await prisma.inventoryManager.findUnique({ where: { email } });
    if (existing)
      return res.status(409).json({ error: 'An account with this email already exists' });

    const hashed  = await bcrypt.hash(password, 10);
    const manager = await prisma.inventoryManager.create({
      data: { email, password: hashed, name }
    });

    res.status(201).json({
      id:    manager.id,
      name:  manager.name,
      email: manager.email
    });
  } catch (err) {
    console.error('createInventoryManager error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── GET /api/inventory/auth/me ───────────────────────────────────────────────
const getInventoryManagerMe = async (req, res) => {
  try {
    // req.user is set by the auth middleware on this route
    const manager = await prisma.inventoryManager.findUnique({
      where:  { id: req.user.id },
      select: { id: true, name: true, email: true, createdAt: true }
    });

    if (!manager)
      return res.status(404).json({ error: 'Manager not found' });

    res.json(manager);
  } catch (err) {
    console.error('getInventoryManagerMe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  loginInventoryManager,
  createInventoryManager,
  getInventoryManagerMe
};