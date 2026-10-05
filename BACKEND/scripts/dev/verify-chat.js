const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log("=== 1. DATABASE RESULT ===");
  const dbResult = await prisma.$queryRaw`
    SELECT shift_name, role 
    FROM shifts 
    WHERE shift_name IN ('Development','Yousef');
  `;
  console.table(dbResult);

  console.log("\n=== 2. JSON RETURNED BY GET /api/chat/users ===");
  // Simulating the exact logic in chat.controller.js getUsers
  const userId = '00000000-0000-0000-0000-000000000000'; // mock
  const shifts = await prisma.shifts.findMany({
    select: { id: true, shift_name: true, role: true }
  });
  const managers = await prisma.inventoryManager.findMany({
    select: { id: true, name: true }
  });

  const shiftNames = new Set(shifts.map(s => (s.shift_name || '').toLowerCase()));

  const users = [
    ...shifts.map(s => ({ id: s.id, name: s.shift_name, role: s.role })),
    ...managers
        .filter(m => !shiftNames.has(m.name.toLowerCase()))
        .map(m => ({ id: m.id, name: m.name, role: 'staff' }))
  ].filter(u => u.id !== userId);

  console.log(JSON.stringify({ users }, null, 2));

  console.log("\n=== 3. CONFIRMATION ===");
  const dev = users.find(u => u.name === 'Development');
  const yousef = users.find(u => u.name === 'Yousef');
  console.log(`Development -> ${dev ? dev.role : 'NOT FOUND'}`);
  console.log(`Yousef -> ${yousef ? yousef.role : 'NOT FOUND'}`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
