const jwt = require('jsonwebtoken');

const token = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const customerToken = (id = '00000000-0000-0000-0000-000000000001') => token({ id, role: 'customer' });

module.exports = { token, customerToken };
