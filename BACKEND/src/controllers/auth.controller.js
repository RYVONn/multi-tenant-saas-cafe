const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Used to keep login timing uniform when the account does not exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// ─── AZT-61: Phone Normalizer ─────────────────────────────────────────────────
// Converts Arabic-Indic (٠-٩) and Persian (۰-۹) digits to ASCII.
function toAsciiDigits(str) {
  return String(str)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

function normalizeEgyptianPhone(raw) {
  let digits = toAsciiDigits(raw).replace(/\D/g, '');

  if (digits.startsWith('0020')) digits = digits.slice(2);       // 0020… -> 20…
  if (/^1[0-9]{9}$/.test(digits)) digits = '0' + digits;         // missing leading 0

  if (/^01[0-9]{9}$/.test(digits))  return '+2' + digits;
  if (/^201[0-9]{9}$/.test(digits)) return '+' + digits;

  throw new Error('Invalid Egyptian phone number');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (e) => String(e).trim().toLowerCase();

// Case-insensitive, whitespace-tolerant customer lookup so accounts created
// before email normalisation (mixed case / padded) can still log in.
async function findCustomerByEmail(email) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM customers WHERE lower(trim(email)) = ${normalizeEmail(email)} LIMIT 1`;
  if (!rows.length) return null;
  return prisma.customers.findUnique({ where: { id: rows[0].id } });
}

// Strict YYYY-MM-DD real calendar date in the past.
function parseBirthday(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (date.getTime() > Date.now() || y < 1900) return null;
  return date;
}

// ─── AZT-62: n8n Webhook — Create PassKit Card ───────────────────────────────
async function triggerCreateCard(customer) {
  const existing = await prisma.customers.findUnique({
    where:  { id: customer.id },
    select: { pass_kit_card_id: true }
  });
  if (existing?.pass_kit_card_id) {
    console.log('[n8n] customer already has a card — skipping');
    return;
  }

  const webhookUrl = process.env.N8N_CREATE_CARD_WEBHOOK;
  if (!webhookUrl) {
    console.warn('[n8n] N8N_CREATE_CARD_WEBHOOK not set — skipping card creation');
    return;
  }

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event:   'card.create',
        user_id: customer.id,
        name:    customer.full_name,
        phone:   customer.phone
      })
    });

    if (!res.ok) {
      console.error('[n8n] card.create webhook failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[n8n] card.create error:', err.message);
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { full_name, email: rawEmail, password, phone, birthday } = req.body;

    if (!full_name || !rawEmail || !password || !phone || !birthday) {
      const labels = { full_name: 'Name', email: 'Email', password: 'Password', phone: 'Phone number', birthday: 'Birthday' };
      const missing = Object.keys(labels).find(k => !req.body[k]);
      return res.status(400).json({ error: `${labels[missing]} is required`, field: missing === 'full_name' ? 'name' : missing });
    }
    if ([full_name, rawEmail, password, phone, birthday].some(v => typeof v !== 'string')) {
      return res.status(400).json({ error: 'Invalid field types' });
    }

    const name  = full_name.trim();
    const email = normalizeEmail(rawEmail);

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Name must be between 2 and 100 characters', field: 'name' });
    }
    if (email.length > 255 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email address (example: name@gmail.com)', field: 'email' });
    }
    if (password.trim().length < 8 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ error: Buffer.byteLength(password) > 72 ? 'Password is too long (max 72 characters)' : 'Password must be at least 8 characters', field: 'password' });
    }

    let normalizedPhone;
    try {
      normalizedPhone = normalizeEgyptianPhone(phone);
    } catch {
      return res.status(400).json({ error: 'Invalid phone number. Use format: 01XXXXXXXXX', field: 'phone' });
    }

    const parsedBirthday = parseBirthday(birthday);
    if (!parsedBirthday) {
      return res.status(400).json({ error: 'Invalid birthday. Use a real date in the past', field: 'birthday' });
    }

    const existing = await findCustomerByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'This email is already registered. Try signing in instead', field: 'email' });
    }

    // One account per phone number (stops sign-up farming and PassKit card confusion).
    const phoneTaken = await prisma.customers.findFirst({ where: { phone: normalizedPhone }, select: { id: true } });
    if (phoneTaken) {
      return res.status(409).json({ error: 'This phone number is already registered. Try signing in instead', field: 'phone' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // The welcome bonus is NOT granted here anymore: it is awarded when the
    // customer's first order is completed by staff (see order.controller updateStatus).
    const customer = await prisma.customers.create({
      data: {
        full_name: name,
        email,
        password: hashedPassword,
        phone: normalizedPhone,
        birthday: parsedBirthday,
        points: 0
      }
    });

    // AZT-62 — fire & forget
    triggerCreateCard(customer);

    const token = jwt.sign(
      { id: customer.id, role: 'customer' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.status(201).json({
      token,
      user: {
        id:              customer.id,
        name:            customer.full_name,
        email:           customer.email,
        phone:           customer.phone,
        birthday:        customer.birthday,
        role:            'customer',
        points:          customer.points,
        cardId:          null,
        distributionUrl: null
      }
    });

  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'This email is already registered. Try signing in instead', field: 'email' });
    }
    console.error(error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

// ─── Login ────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await findCustomerByEmail(email);

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // ── AZT-62: لو الكارت مش اتعمل وقت التسجيل (webhook فشل) — retry هنا
    if (!user.pass_kit_card_id) {
      triggerCreateCard(user);
    }

    const token = jwt.sign(
      { id: user.id, role: 'customer' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.json({
      token,
      user: {
        id:              user.id,
        name:            user.full_name,
        email:           user.email,
        phone:           user.phone || '',
        role:            'customer',
        points:          user.points           || 0,
        cardId:          user.pass_kit_card_id || null,
        distributionUrl: user.distribution_url || null
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Login failed' });
  }
};

// ─── Me ───────────────────────────────────────────────────────────────────────
exports.me = async (req, res) => {
  try {
    if (req.user.role !== 'customer') {
      const staffUser = await prisma.profiles.findUnique({
        where: { id: req.user.id },
        select: { id: true, full_name: true, role: true, created_at: true }
      });
      if (!staffUser) return res.status(404).json({ error: 'User not found' });
      return res.json(staffUser);
    }

    const customer = await prisma.customers.findUnique({
      where: { id: req.user.id },
      select: {
        id:               true,
        full_name:        true,
        email:            true,
        phone:            true,
        birthday:         true,
        points:           true,
        pass_kit_card_id: true,
        distribution_url: true,
        created_at:       true
      }
    });

    if (!customer) return res.status(404).json({ error: 'User not found' });

    res.json({
      id:              customer.id,
      name:            customer.full_name,
      email:           customer.email,
      phone:           customer.phone || '',
      birthday:        customer.birthday,
      role:            'customer',
      points:          customer.points,
      cardId:          customer.pass_kit_card_id || null,
      distributionUrl: customer.distribution_url || null,
      created_at:      customer.created_at
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

// ─── Login Staff ──────────────────────────────────────────────────────────────
exports.loginStaff = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.shifts.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } });

    // Same generic error whether the account is missing or the password is wrong.
    const INVALID = { error: 'Invalid credentials' };
    if (!user || !user.password) {
      await bcrypt.compare(password, DUMMY_HASH); // equalise timing
      return res.status(401).json(INVALID);
    }

    let valid = false;
    if (user.password.startsWith('$2')) {
      valid = await bcrypt.compare(password, user.password);
    } else {
      // Legacy plaintext row (run scripts/hash-staff-passwords.js to remove these).
      // Constant-time compare, then upgrade to bcrypt immediately.
      const a = Buffer.from(password), b = Buffer.from(user.password);
      valid = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (valid) {
        await prisma.shifts.update({
          where: { id: user.id },
          data:  { password: await bcrypt.hash(password, 10) },
        });
      }
    }
    if (!valid) return res.status(401).json(INVALID);

    const token = jwt.sign(
      { id: user.id, role: (user.role ?? 'staff').toLowerCase() },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    const { password: _pw, ...safeUser } = user;
    res.json({ token, user: safeUser });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
