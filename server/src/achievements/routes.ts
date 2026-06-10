// GET /api/achievements — full catalog LEFT JOINed with the requesting
// user's unlocks. Contract shape: {id, name, description, emoji, unlockedAt}
// (unlockedAt null when locked), returned in catalog order.

import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { achievements, userAchievements } from '../db/schema.js';
import { requireAuth } from '../auth/middleware.js';
import { userIdOf } from '../validation.js';
import { ACHIEVEMENT_CATALOG } from '../game/achievements.js';

// The DB table has no order column — catalog order comes from the in-code
// catalog (the single source of truth for slugs).
const catalogOrder = new Map(ACHIEVEMENT_CATALOG.map((a, i) => [a.id, i]));

export const achievementsRouter = Router();

achievementsRouter.use(requireAuth);

achievementsRouter.get('/', async (req, res) => {
  const userId = userIdOf(req);
  const rows = await db
    .select({
      id: achievements.id,
      name: achievements.name,
      description: achievements.description,
      emoji: achievements.emoji,
      unlockedAt: userAchievements.unlockedAt,
    })
    .from(achievements)
    .leftJoin(
      userAchievements,
      and(
        eq(userAchievements.achievementId, achievements.id),
        eq(userAchievements.userId, userId),
      ),
    );
  rows.sort(
    (a, b) => (catalogOrder.get(a.id) ?? Infinity) - (catalogOrder.get(b.id) ?? Infinity),
  );
  res.json(
    rows.map((r) => ({ ...r, unlockedAt: r.unlockedAt?.toISOString() ?? null })),
  );
});
