import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { HttpError } from '../errors.js';
import { requireAuth } from '../auth/middleware.js';
import { parseBody, userIdOf } from '../validation.js';
import { rescheduleNudge } from '../push/scheduler.js';

// IANA zone names the runtime actually supports — the only valid timezones.
const SUPPORTED_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

const settingsSchema = z
  .object({
    // 'HH:MM' 24h clock; null clears the nudge entirely.
    nudgeTime: z
      .union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM (24h)'), z.null()])
      .optional(),
    timezone: z
      .string()
      .refine((tz) => SUPPORTED_TIMEZONES.has(tz), 'unknown IANA timezone')
      .optional(),
  })
  .refine((v) => v.nudgeTime !== undefined || v.timezone !== undefined, {
    message: 'at least one of nudgeTime, timezone required',
  });

/**
 * users.nudge_time is a pg `time` column — Postgres returns 'HH:MM:SS'.
 * The API speaks 'HH:MM' everywhere (settings response and GET /auth/me).
 */
export function normalizeNudgeTime(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5);
}

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

// PUT /api/me/settings — partial update of {nudgeTime, timezone}.
settingsRouter.put('/settings', async (req, res) => {
  const { nudgeTime, timezone } = parseBody(settingsSchema, req.body);
  const userId = userIdOf(req);

  const [updated] = await db
    .update(users)
    .set({
      ...(nudgeTime !== undefined ? { nudgeTime } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
    })
    .where(eq(users.id, userId))
    .returning({ nudgeTime: users.nudgeTime, timezone: users.timezone });
  if (!updated) {
    throw new HttpError(401, 'unauthenticated', 'Invalid session');
  }

  // Either field changing (the schema requires at least one) moves the daily
  // nudge job: new time, new wall-clock zone, or cancellation (null).
  await rescheduleNudge(userId);

  res.json({
    ok: true,
    nudgeTime: normalizeNudgeTime(updated.nudgeTime),
    timezone: updated.timezone,
  });
});
