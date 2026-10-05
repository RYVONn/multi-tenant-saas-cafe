// Load .env first so the app's own dotenv call can't re-introduce real values later.
require('dotenv').config();
// Deterministic env for tests. DATABASE_URL is only overridden when TEST_DATABASE_URL is
// provided, so unit tests can never touch a real database by accident.
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://invalid:invalid@127.0.0.1:1/none';
// Empty (not deleted) so the app's dotenv call can't repopulate them from .env
process.env.N8N_INTERNAL_SECRET = '';
process.env.BACKEND_INTERNAL_SECRET = '';
// Rate limiting is covered by its own test; keep it out of the way elsewhere
process.env.DISABLE_RATE_LIMIT = '1';
