import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { HttpError } from '../errors.js';
import { JWT_SECRET, requireAuth, type AuthedRequest } from './middleware.js';
import { normalizeNudgeTime } from '../settings/routes.js';

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

// Compared against when the user doesn't exist, so login takes the same time
// for unknown names as for wrong passwords (prevents timing-based enumeration).
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10);

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
} as const;

const loginSchema = z.object({
  name: z.string().min(1),
  password: z.string().min(1),
  rememberMe: z.boolean().optional(),
});

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'validation',
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  const { name, password, rememberMe } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.name, name));
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new HttpError(401, 'invalid_credentials', 'Invalid name or password');
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'invalid_credentials', 'Invalid name or password');
  }

  const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, {
    ...cookieOptions,
    ...(rememberMe ? { maxAge: THIRTY_DAYS_MS } : {}),
  });
  res.json({ id: user.id, name: user.name });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('token', cookieOptions);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { userId } = req as AuthedRequest;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    throw new HttpError(401, 'unauthenticated', 'Invalid session');
  }
  res.json({
    id: user.id,
    name: user.name,
    timezone: user.timezone,
    // pg `time` columns come back 'HH:MM:SS' — API speaks 'HH:MM'.
    nudgeTime: normalizeNudgeTime(user.nudgeTime),
  });
});
