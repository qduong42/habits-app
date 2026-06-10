/**
 * Push subscription routes:
 * - GET  /api/push/vapid-public-key → { key } (503 push_disabled without VAPID env)
 * - POST /api/push/subscribe       → store the browser's PushSubscription
 * - DELETE /api/push/subscribe     → forget it
 */

import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { HttpError } from '../errors.js';
import { requireAuth } from '../auth/middleware.js';
import { parseBody, userIdOf } from '../validation.js';
import { vapidPublicKey } from './vapid.js';

// Shape of PushSubscription.toJSON() (extra fields like expirationTime are
// stripped) — matches the users.pushSubscription jsonb type.
const subscriptionSchema = z.object({
  endpoint: z.url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const pushRouter = Router();

pushRouter.use(requireAuth);

pushRouter.get('/vapid-public-key', (_req, res) => {
  const key = vapidPublicKey();
  if (key === null) {
    throw new HttpError(503, 'push_disabled', 'Push notifications are not configured');
  }
  res.json({ key });
});

pushRouter.post('/subscribe', async (req, res) => {
  const subscription = parseBody(subscriptionSchema, req.body);
  const updated = await db
    .update(users)
    .set({ pushSubscription: subscription })
    .where(eq(users.id, userIdOf(req)))
    .returning({ id: users.id });
  if (updated.length === 0) throw new HttpError(401, 'unauthenticated', 'Invalid session');
  res.json({ ok: true });
});

pushRouter.delete('/subscribe', async (req, res) => {
  await db.update(users).set({ pushSubscription: null }).where(eq(users.id, userIdOf(req)));
  res.json({ ok: true });
});
