const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const res = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'push_subscriptions'`;
  console.log(res);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
