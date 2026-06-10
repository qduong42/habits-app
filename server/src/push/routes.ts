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
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
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
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'validation',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  const { userId } = req as AuthedRequest;
  const updated = await db
    .update(users)
    .set({ pushSubscription: parsed.data })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (updated.length === 0) throw new HttpError(401, 'unauthenticated', 'Invalid session');
  res.json({ ok: true });
});

pushRouter.delete('/subscribe', async (req, res) => {
  const { userId } = req as AuthedRequest;
  await db.update(users).set({ pushSubscription: null }).where(eq(users.id, userId));
  res.json({ ok: true });
});
