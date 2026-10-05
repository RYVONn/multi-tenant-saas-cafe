const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log("1. Deleting all open shifts...");
  await prisma.shift.deleteMany({ where: { status: 'open' } });

  console.log("2. Simulating the exact code path of preflightOpenShift...");
  // What does preflightOpenShift do?
  // It only queries! Let's check if there's ANY trigger or hidden creation.
  const type = 'morning';
  const staffId = '00000000-0000-0000-0000-000000000000'; // mock
  
  const allStock = await prisma.stockItem.findMany({ orderBy: { name: 'asc' } });
  
  // Wait! Let's just execute the actual controller!
  const { preflightOpenShift } = require('../../src/controllers/shifts.controller');
  
  // Find a user to mock req.user
  const user = await prisma.shifts.findFirst() || { id: '00000000-0000-0000-0000-000000000000' };
  
  const req = {
    query: { type: 'morning' },
    user: { id: user.id }
  };
  
  const res = {
    status: (code) => { console.log("RES.STATUS", code); return res; },
    json: (data) => { console.log("RES.JSON called with data length", JSON.stringify(data).length); return res; }
  };
  
  console.log("3. Executing preflightOpenShift (simulating 'Click Open Shift')...");
  await preflightOpenShift(req, res);
  
  console.log("4. Simulating closing the modal (doing nothing)...");
  
  console.log("5. Querying the database for open shifts...");
  const shifts = await prisma.$queryRaw`
    SELECT id, status, type, "createdAt"
    FROM "Shift"
    WHERE status = 'open'
    ORDER BY "createdAt" DESC
    LIMIT 5;
  `;
  
  console.log("=== QUERY RESULT ===");
  console.log(shifts);
  console.log("====================");
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
