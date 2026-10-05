require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const shifts = await prisma.$queryRaw`
    SELECT shift_name, role
    FROM shifts
    WHERE shift_name IN ('Development','Yousef');
  `;
  console.log(shifts);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
