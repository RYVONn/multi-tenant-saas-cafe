const jwt = require('jsonwebtoken');
const https = require('https');

const token = jwt.sign(
  { id: '0df00688-6627-4a00-ab35-23eb4057f920', role: 'manager' },
  process.env.JWT_SECRET,
  { expiresIn: '8h' }
);

const options = {
  hostname: 'api.bleuscoffee.com',
  port: 443,
  path: '/api/chat/users',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log("=== ACTUAL JSON RESPONSE FROM API ===");
    console.log(data);
  });
});

req.on('error', (e) => {
  console.error(e);
});
req.end();
