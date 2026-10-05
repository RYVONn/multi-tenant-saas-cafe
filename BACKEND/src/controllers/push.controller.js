const webpush = require('web-push');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const jwt = require('jsonwebtoken');

// ─── Guard: لو VAPID keys مش موجودة متكسرش السيرفر ──────────────────────────
const VAPID_READY =
  process.env.VAPID_EMAIL &&
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY;

if (VAPID_READY) {
  webpush.setVapidDetails(
    'mailto:' + process.env.VAPID_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log('✅ Web Push (VAPID) initialized');
} else {
  console.warn('⚠️  VAPID keys missing — push notifications disabled');
}

// ── POST /api/push/subscribe ──────────────────────────────────────────────────
exports.subscribe = async (req, res) => {
  if (!VAPID_READY) return res.status(503).json({ error: 'Push notifications not configured' });

  try {
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }

    let userId = null;
    let userRole = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.id;
        userRole = decoded.role;
      } catch (e) {
        // Ignore token errors, fall back to anonymous
      }
    }

    await prisma.push_subscriptions.upsert({
      where:  { endpoint },
      update: { p256dh: keys.p256dh, auth: keys.auth, user_id: userId, user_role: userRole },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, user_id: userId, user_role: userRole },
    });

    console.log(`✅ Subscribed: ${endpoint.slice(0, 50)}...`);
    res.status(201).json({ message: 'Subscribed successfully' });
  } catch (error) {
    console.error('PUSH SUBSCRIBE ERROR:', error);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
};

// ── DELETE /api/push/unsubscribe ──────────────────────────────────────────────
exports.unsubscribe = async (req, res) => {
  try {
    const { endpoint } = req.body;
    await prisma.push_subscriptions.delete({ where: { endpoint } });
    res.json({ message: 'Unsubscribed successfully' });
  } catch (error) {
    console.error('PUSH UNSUBSCRIBE ERROR:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
};

// ── Helper — بتتنادى من order.controller ─────────────────────────────────────
exports.sendNewOrderPush = async (order) => {
  console.log('[DEBUG] sendNewOrderPush called');
  if (!VAPID_READY) return; // silent skip لو VAPID مش configured

  try {
    const subscriptions = await prisma.push_subscriptions.findMany({
      where: {
        user_role: { in: ['owner', 'morning_staff', 'evening_staff'] }
      }
    });
    if (!subscriptions.length) return;

    console.log(`📤 Sending push to ${subscriptions.length} subscriptions`);

    const payload = JSON.stringify({
      title:   '🆕 New Order!',
      body:    `${order.customer_name} — ${Number(order.total_amount).toFixed(2)} EGP`,
      orderId: order.id,
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) => {
        console.log(`[PUSH INITIATE] Sending to: ${sub.endpoint}`);
        console.log(`[PUSH PAYLOAD] ${payload}`);
        return webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).then(res => {
          console.log(`✅ [PUSH SUCCESS] Endpoint: ${sub.endpoint}`);
          console.log(`   statusCode: ${res?.statusCode}`);
          console.log(`   response headers:`, res?.headers);
          return res;
        }).catch(err => {
          console.log(`❌ [PUSH ERROR] Failed to send to: ${sub.endpoint}`);
          console.log(`   statusCode: ${err.statusCode}`);
          console.log(`   headers:`, err.headers);
          console.log(`   body:`, err.body);
          throw err;
        });
      })
    );

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        console.log(`✅ Push sent to sub ${i}`);
      } else {
        console.log(`❌ Push failed for sub ${i} — ${r.reason?.statusCode} ${r.reason?.message}`);
      }
    });

    // احذف الـ expired subscriptions (410 Gone)
    const expiredEndpoints = subscriptions
      .filter((_, i) => results[i].status === 'rejected' && results[i].reason?.statusCode === 410)
      .map((s) => s.endpoint);

    if (expiredEndpoints.length > 0) {
      await prisma.push_subscriptions.deleteMany({
        where: { endpoint: { in: expiredEndpoints } },
      });
      console.log(`🗑️ Removed ${expiredEndpoints.length} expired subscriptions`);
    }
  } catch (error) {
    console.error('SEND PUSH ERROR:', error);
  }
};

// ── Generic Helper for Critical Notifications ─────────────────────────────────
exports.sendGenericPush = async (notif) => {
  console.log('[DEBUG] sendGenericPush called');
  if (!VAPID_READY) return; // silent skip if VAPID not configured

  try {
    // Only target subscriptions matching the notification's specific recipient role
    const subscriptions = await prisma.push_subscriptions.findMany({
      where: {
        user_role: notif.recipientRole
      }
    });
    if (!subscriptions.length) return;

    console.log(`📤 Sending generic push to ${subscriptions.length} subscriptions`);

    const payload = JSON.stringify({
      title: notif.title || 'Notification',
      body:  notif.body || 'You have a new notification',
      id:    notif.id,
      type:  notif.type,
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) => {
        console.log(`[PUSH INITIATE] Sending to: ${sub.endpoint}`);
        console.log(`[PUSH PAYLOAD] ${payload}`);
        return webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).then(res => {
          console.log(`✅ [PUSH SUCCESS] Endpoint: ${sub.endpoint}`);
          console.log(`   statusCode: ${res?.statusCode}`);
          console.log(`   response headers:`, res?.headers);
          return res;
        }).catch(err => {
          console.log(`❌ [PUSH ERROR] Failed to send to: ${sub.endpoint}`);
          console.log(`   statusCode: ${err.statusCode}`);
          console.log(`   headers:`, err.headers);
          console.log(`   body:`, err.body);
          throw err;
        });
      })
    );

    const expiredEndpoints = subscriptions
      .filter((_, i) => results[i].status === 'rejected' && results[i].reason?.statusCode === 410)
      .map((s) => s.endpoint);

    if (expiredEndpoints.length > 0) {
      await prisma.push_subscriptions.deleteMany({
        where: { endpoint: { in: expiredEndpoints } },
      });
    }
  } catch (error) {
    console.error('SEND GENERIC PUSH ERROR:', error);
  }
};