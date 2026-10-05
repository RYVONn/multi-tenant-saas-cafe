// One-off migration: bcrypt-hash every plaintext password in `shifts` and
// `InventoryManager`. Safe to re-run (already-hashed rows are skipped).
//
//   cd BACKEND && node scripts/hash-staff-passwords.js
//
// Afterwards, ROTATE all staff passwords: any DB dump/backup taken before this
// ran contains them in plaintext.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const isHash = (p) => typeof p === 'string' && p.startsWith('$2');

(async () => {
  let n = 0;
  for (const row of await prisma.shifts.findMany({ select: { id: true, password: true } })) {
    if (!row.password || isHash(row.password)) continue;
    await prisma.shifts.update({ where: { id: row.id }, data: { password: await bcrypt.hash(row.password, 10) } });
    n++;
  }
  let m = 0;
  for (const row of await prisma.inventoryManager.findMany({ select: { id: true, password: true } })) {
    if (!row.password || isHash(row.password) || row.password.startsWith('!sso-managed')) continue;
    if (row.password === 'sso-managed') {
      // placeholder rows: replace with an unusable random value
      await prisma.inventoryManager.update({ where: { id: row.id }, data: { password: '!sso-managed:' + require('crypto').randomBytes(32).toString('hex') } });
    } else {
      await prisma.inventoryManager.update({ where: { id: row.id }, data: { password: await bcrypt.hash(row.password, 10) } });
    }
    m++;
  }
  console.log(`Hashed ${n} staff and ${m} inventory-manager passwords.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
