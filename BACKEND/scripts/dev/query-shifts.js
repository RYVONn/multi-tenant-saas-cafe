const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const shifts = await prisma.$queryRaw`
    SELECT id, status, type, "createdAt"
    FROM "Shift"
    WHERE status='open'
    ORDER BY "createdAt" DESC
    LIMIT 5;
  `;
  console.log(shifts);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
