const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const http = require('http');

async function verify() {
  try {
    console.log("=== 1. SHIFT START BUG ===");
    const shifts = await prisma.shift.findMany({
      where: { status: 'open' },
      select: { id: true, status: true, type: true, openedAt: true },
      orderBy: { openedAt: 'desc' }
    });
    console.table(shifts);

    console.log("\n=== 2. CHAT ROLE LABELS (API RESPONSE) ===");
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/chat/users',
      method: 'GET'
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const users = JSON.parse(data);
          console.log(users);
        } catch(e) { console.log(data); }
      });
    });
    req.on('error', e => console.error(e));
    req.end();

    console.log("\n=== 3. IMAGE CACHE HEADERS ===");
    const imgOptions = {
      hostname: 'localhost',
      port: 5000,
      path: '/uploads/products/1.jpg',
      method: 'HEAD'
    };
    const imgReq = http.request(imgOptions, res => {
      console.log('Cache-Control:', res.headers['cache-control']);
      console.log('ETag:', res.headers['etag']);
    });
    imgReq.on('error', e => console.error(e));
    imgReq.end();

  } catch (e) {
    console.error(e);
  } finally {
    setTimeout(() => prisma.$disconnect(), 1000);
  }
}

verify();
