// scripts/fix-event-image-urls.js
// Run once: node scripts/fix-event-image-urls.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const events = await prisma.event.findMany({
    where: { imageUrl: { not: null } },
    select: { id: true, imageUrl: true },
  });

  console.log(`Found ${events.length} events with images.`);

  let fixed = 0;
  for (const e of events) {
    if (!e.imageUrl || !e.imageUrl.startsWith('http')) continue;
    try {
      const url = new URL(e.imageUrl);
      // pathname = "/uploads/events/filename.jpg" → strip leading slash
      const rel = url.pathname.replace(/^\//, '');
      await prisma.event.update({
        where: { id: e.id },
        data:  { imageUrl: rel },
      });
      console.log(`✅ Fixed: ${e.imageUrl} → ${rel}`);
      fixed++;
    } catch (err) {
      console.warn(`⚠️  Skipped ${e.id}:`, err.message);
    }
  }

  console.log(`\nDone. Fixed ${fixed} of ${events.length} records.`);
}

main()
  .catch(err => { console.error('Fatal error:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());