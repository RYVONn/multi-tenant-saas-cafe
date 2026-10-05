const { rateLimit } = require('express-rate-limit');

const make = (windowMs, limit, message, extra = {}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
    skip: () => process.env.DISABLE_RATE_LIMIT === '1',
    ...extra,
  });

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

module.exports = {
  // Whole API: generous ceiling against floods
  globalLimiter: make(MIN, 600, 'Too many requests, slow down'),

  // Login (customer / staff / inventory): failed attempts only count
  loginLimiter: make(15 * MIN, 20, 'Too many login attempts, try again later', { skipSuccessfulRequests: true }),

  // Sign-up mints a welcome bonus, so keep it tight
  registerLimiter: make(HOUR, 5, 'Too many sign-ups from this network, try again later'),

  orderLimiter: make(10 * MIN, 20, 'Too many orders, try again later'),

  pushLimiter: make(HOUR, 30, 'Too many subscription requests'),
};
