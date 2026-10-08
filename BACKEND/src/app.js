require("dotenv").config();

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const app     = express();

const extrasRouter        = require('./routes/extras.routes');
const inventoryAuthRoutes = require('./routes/inventory-auth.routes');
const {
  globalLimiter, loginLimiter, registerLimiter, orderLimiter, pushLimiter,
} = require('./middlewares/rate-limit.middleware');

// ─── Create upload directories if missing ────────────────────────────────────
// ─── Create upload directories if missing ──────────────────────────────────
['uploads/products', 'uploads/categories', 'uploads/payments', 'uploads/offers',
 'uploads/receipts', 'uploads/invoices', 'uploads/waste',
 'uploads/inventory', 'uploads/events'].forEach(dir => {  // ← أضف events
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// AZT SECURITY FIX (audit issue #4): cors() with no options reflects
// Access-Control-Allow-Origin: * on every response, including authenticated
// ones. Restrict to the known frontend/dashboard origins so credentialed
// requests (cookies/Authorization headers) can't be read cross-site by an
// arbitrary page. Override/extend via CORS_ALLOWED_ORIGINS in .env
// (comma-separated) without another code change.
const defaultAllowedOrigins = [
  'https://bleuscoffee.com',
  'https://dashboard.bleuscoffee.com',
  'https://staging.bleuscoffee.com',
  'https://staging-dashboard.bleuscoffee.com',
  'http://localhost:5173', // Vite dev server
  'http://localhost:5174',
];
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : defaultAllowedOrigins;

// Behind nginx: trust one proxy hop so rate limits key on the real client IP.
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Images/uploads are loaded cross-origin by the customer site and dashboard.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.set('allowedOrigins', allowedOrigins);

app.use(cors({
  origin(origin, callback) {
    // Allow non-browser requests (curl, server-to-server, n8n webhooks) which
    // send no Origin header at all.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    console.warn(`[CORS] Blocked request from disallowed origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use('/api', globalLimiter);

// ─── Rate limits on abuse-prone endpoints ────────────────────────────────────
app.use('/api/auth/login',           loginLimiter);
app.use('/api/auth/staff/login',     loginLimiter);
app.use('/api/inventory/auth/login', loginLimiter);
app.use('/api/auth/register',        registerLimiter);
app.post('/api/orders',              orderLimiter);
app.use('/api/push/subscribe',       pushLimiter);

// ─── Existing Routes ─────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth.routes'));
app.use('/api/orders',     require('./routes/order.routes'));
app.use('/api/products',   require('./routes/product.routes'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/extras',     extrasRouter);
app.use('/api/images',     require('./routes/image.routes'));
app.use('/api/push',       require('./routes/push.routes'));
app.use('/api/loyalty',    require('./routes/loyalty.routes'));
app.use('/api/offers',     require('./routes/Offers.routes'));
app.use('/api/internal',   require('./routes/internal.routes'));
app.use('/api/chat',       require('./routes/chat.routes'));
app.use('/api/settings',   require('./routes/settings.routes'));
app.use('/api/storefront', require('./routes/storefront.routes'));

// ─── Inventory Routes (الترتيب مهم جداً) ────────────────────────────────────
app.use('/api/inventory/auth',           inventoryAuthRoutes);
app.use('/api/inventory/stock',          require('./routes/stock.routes'));
app.use('/api/inventory/receipts',       require('./routes/purchase-receipts.routes'));
app.use('/api/inventory/issuances',      require('./routes/shift-issuance.routes'));
app.use('/api/inventory/shifts',         require('./routes/shift.routes'));
app.use('/api/inventory/consumption',    require('./routes/consumption.routes'));
app.use('/api/inventory/requests',       require('./routes/stock-requests.routes'));
app.use('/api/inventory/notifications',  require('./routes/notifications.routes'));
app.use('/api/inventory/analytics',      require('./routes/analytics.routes'));
app.use('/api/inventory/suppliers',      require('./routes/suppliers.routes'));
app.use('/api/inventory/inv-categories', require('./routes/inv-categories.routes'));
app.use('/api/inventory/sales',          require('./routes/inventory-sales.routes'));
app.use('/api/inventory/waste',          require('./routes/inventory-waste.routes'));
app.use('/api/inventory/movements',      require('./routes/inventory-movements.routes'));
app.use('/api/inventory',                require('./routes/payments.routes')); // ← دايماً الأخير
app.use('/api/events',     require('./routes/events.routes'));
// ─── Static Assets ───────────────────────────────────────────────────────────
const staticOptions = { maxAge: '30d', etag: true };
// Uploaded files can never be rendered as HTML/scripts by the browser.
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'none'; sandbox");
  if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(req.path)) {
    res.setHeader('Content-Disposition', 'attachment');
  }
  next();
}, express.static(path.join(__dirname, '..', 'uploads'), staticOptions));
app.use('/drinks',  express.static(path.join(__dirname, '..', 'drinks'), staticOptions));
// Debug endpoints dump raw DB rows — never mount them in production.
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/debug', require('./routes/debug.routes'));
}

// ─── 404 — JSON, not Express's default HTML page ──────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global error handler (audit issue #6) ─────────────────────────────────────
// AZT SECURITY FIX: previously a malformed request body (bad JSON, etc.) fell
// through to Express's default error handler, which returns a full stack
// trace — including absolute server file paths — directly in the HTTP
// response body. This is the last app.use() so it catches every unhandled
// error from every route above. In production it returns a generic message;
// full details still go to the server console for debugging.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  // Client errors get the right status instead of a blanket 500.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (err.name === 'MulterError' || /Only image files are allowed/.test(err.message ?? '')) {
    return res.status(400).json({ error: err.message });
  }

  console.error('[Unhandled error]', err);

  const isProd = process.env.NODE_ENV === 'production';
  res.status(err.status || err.statusCode || 500).json({
    error: isProd ? 'Internal server error' : err.message,
  });
});

module.exports = app;