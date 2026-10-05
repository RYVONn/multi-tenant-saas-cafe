require('dotenv').config();

const http = require('http');
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const app = require('./src/app');
const { attachSocket } = require('./src/socket');

app.use('/drinks', express.static(path.join(__dirname, 'drinks')));

const server = http.createServer(app);
const prisma = new PrismaClient();

const io = attachSocket(server, app);

// ─── Cron: Retry card creation for customers without a card ───────────────────
// Runs every day at 3:00 AM
// Covers the case where the n8n webhook failed at registration
// and the customer never logged in again
cron.schedule('0 3 * * *', async () => {
  console.log('[Cron] Checking for customers without a loyalty card...');

  const webhookUrl = process.env.N8N_CREATE_CARD_WEBHOOK;
  if (!webhookUrl) {
    console.warn('[Cron] N8N_CREATE_CARD_WEBHOOK not set — skipping');
    return;
  }

  try {
    const withoutCard = await prisma.customers.findMany({
      where:  { pass_kit_card_id: null },
      select: { id: true, full_name: true, phone: true }
    });

    if (withoutCard.length === 0) {
      console.log('[Cron] All customers have cards ✅');
      return;
    }

    console.log(`[Cron] Found ${withoutCard.length} customer(s) without a card — retrying...`);

    for (const customer of withoutCard) {
      try {
        const res = await fetch(webhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event:   'card.create',
            user_id: customer.id,
            name:    customer.full_name,
            phone:   customer.phone
          })
        });

        if (res.ok) {
          console.log(`[Cron] ✅ Triggered card for customer ${customer.id}`);
        } else {
          console.error(`[Cron] ❌ Failed for customer ${customer.id}:`, res.status);
        }
      } catch (err) {
        console.error(`[Cron] ❌ Error for customer ${customer.id}:`, err.message);
      }
    }

  } catch (err) {
    console.error('[Cron] DB error:', err.message);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
