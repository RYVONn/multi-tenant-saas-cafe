// ─── Internal Auth Middleware ─────────────────────────────────────────────────
// Protects /api/internal/* routes.
// Called ONLY by n8n — never by browser clients.
// Header: x-internal-secret
// Env:    N8N_INTERNAL_SECRET (BACKEND_INTERNAL_SECRET is accepted as a fallback)
const crypto = require('crypto');

module.exports = function internalAuth(req, res, next) {
  const expected = process.env.N8N_INTERNAL_SECRET || process.env.BACKEND_INTERNAL_SECRET;

  // Fail closed: refuse everything when no secret is configured.
  if (!expected) return res.status(503).json({ error: 'Internal endpoint not configured' });

  const provided = Buffer.from(String(req.headers['x-internal-secret'] ?? ''));
  const wanted   = Buffer.from(expected);

  if (provided.length !== wanted.length || !crypto.timingSafeEqual(provided, wanted)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
};
