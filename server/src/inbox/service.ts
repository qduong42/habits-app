import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  achievements,
  checkins,
  habits,
  inboxItems,
  userAchievements,
  users,
} from '../db/schema.js';
import type { InboxItem } from '../db/schema.js';
import { localDateFor } from '../game/dates.js';
import { levelFromXp } from '../game/xp.js';
import { dayStreak } from '../game/streaks.js';
import { checkAchievements } from '../game/achievements.js';
import { HttpError } from '../errors.js';
import { conversionsCount, createHabit } from '../habits/service.js';
import type { CreateHabitInput, HabitContract, UnlockedAchievement } from '../habits/service.js';

/** A drizzle transaction handle (same query API as `db`). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Shared API contract shape (plan: "Shared API contracts"). */
export interface InboxItemContract {
  id: string;
  text: string;
  sourceUrl: string | null;
  status: 'open' | 'converted' | 'discarded';
  habitId: string | null;
  taskId: string | null;
  createdAt: string;
}

export interface CaptureInput {
  text: string;
  sourceUrl?: string;
}

/** Convert body — sourceUrl is never client-supplied, it carries over from the item. */
export type ConvertInput = Omit<CreateHabitInput, 'sourceUrl'>;

export interface ConvertResult {
  item: InboxItemContract;
  habit: HabitContract;
  unlockedAchievements: UnlockedAchievement[];
}

const notFound = () => new HttpError(404, 'not_found', 'Inbox item not found');
const alreadyTriaged = () =>
  new HttpError(409, 'already_triaged', 'Inbox item was already converted or discarded');

function toContract(item: InboxItem): InboxItemContract {
  return {
    id: item.id,
    text: item.text,
    sourceUrl: item.sourceUrl,
    status: item.status,
    habitId: item.habitId,
    taskId: null, // column added in Task 25
    createdAt: item.createdAt.toISOString(),
  };
}

export async function captureItem(
  userId: string,
  input: CaptureInput,
): Promise<InboxItemContract> {
  const [created] = await db
    .insert(inboxItems)
    .values({ userId, text: input.text, sourceUrl: input.sourceUrl ?? null })
    .returning();
  return toContract(created!);
}

/** Own items, newest first. Default = open only; `all` includes converted + discarded. */
export async function listItems(userId: string, all: boolean): Promise<InboxItemContract[]> {
  const filters = [eq(inboxItems.userId, userId)];
  if (!all) filters.push(eq(inboxItems.status, 'open'));
  const rows = await db
    .select()
    .from(inboxItems)
    .where(and(...filters))
    .orderBy(desc(inboxItems.createdAt));
  return rows.map(toContract);
}

/**
 * Acquire the user's row lock (SELECT ... FOR UPDATE) for the rest of the
 * transaction — copied from the lockUserRow pattern in habits/service.ts.
 * It serializes same-user reward transactions, so the conversions count and
 * the achievement threshold checks below can't race a parallel convert or
 * check-in (each threshold fires exactly once).
 */
async function lockUserRow(tx: Tx, userId: string): Promise<{ xpTotal: number; timezone: string }> {
  const [user] = await tx
    .select({ xpTotal: users.xpTotal, timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  if (!user) throw new HttpError(401, 'unauthenticated', 'Invalid session');
  return user;
}

/**
 * Conversion achievement check — same ctx semantics as the check-in
 * transaction in habits/service.ts (Task 25 may extract a shared
 * game/rewards.ts helper). Conversion grants no XP, so level comes straight
 * from the locked row's xpTotal.
 */
async function unlockAchievements(
  tx: Tx,
  userId: string,
  user: { xpTotal: number; timezone: string },
): Promise<UnlockedAchievement[]> {
  const today = localDateFor(user.timezone);
  const checkinRows = await tx
    .select({ localDate: checkins.localDate })
    .from(checkins)
    .where(eq(checkins.userId, userId));
  const todayCategoryRows = await tx
    .selectDistinct({ categoryId: habits.categoryId })
    .from(checkins)
    .innerJoin(habits, eq(checkins.habitId, habits.id))
    .where(and(eq(checkins.userId, userId), eq(checkins.localDate, today)));
  const unlockedRows = await tx
    .select({ achievementId: userAchievements.achievementId })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));

  const newIds = checkAchievements({
    totalCheckins: checkinRows.length,
    habitStreak: 0, // converting changes no per-habit streak
    dayStreak: dayStreak(new Set(checkinRows.map((r) => r.localDate)), today),
    level: levelFromXp(user.xpTotal),
    conversions: await conversionsCount(tx, userId), // includes the item just converted
    categoriesToday: todayCategoryRows.length,
    unlocked: new Set(unlockedRows.map((r) => r.achievementId)),
  });
  if (newIds.length === 0) return [];

  // Conflict-safe insert + hydration, copied from the check-in transaction:
  // build the response from the RETURNED rows only so a (theoretical) racing
  // unlock never reports a duplicate.
  const inserted = await tx
    .insert(userAchievements)
    .values(newIds.map((achievementId) => ({ userId, achievementId })))
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return [];
  const defs = await tx
    .select()
    .from(achievements)
    .where(
      inArray(
        achievements.id,
        inserted.map((r) => r.achievementId),
      ),
    );
  const defById = new Map(defs.map((d) => [d.id, d]));
  return inserted.map((r) => {
    const def = defById.get(r.achievementId)!; // FK guarantees the catalog row exists
    return {
      id: r.achievementId,
      name: def.name,
      description: def.description,
      emoji: def.emoji,
      unlockedAt: r.unlockedAt.toISOString(),
    };
  });
}

export async function convertItem(
  userId: string,
  itemId: string,
  input: ConvertInput,
): Promise<ConvertResult> {
  return db.transaction(async (tx) => {
    // Row lock FIRST — see lockUserRow for why this ordering matters.
    const user = await lockUserRow(tx, userId);

    const [item] = await tx
      .select()
      .from(inboxItems)
      .where(and(eq(inboxItems.id, itemId), eq(inboxItems.userId, userId)));
    if (!item) throw notFound();
    if (item.status !== 'open') throw alreadyTriaged();

    // Habit creation rides the EXISTING service path (category-usable check,
    // weekly-target rules) inside THIS transaction — a failure rolls the
    // whole conversion back.
    const habit = await createHabit(
      userId,
      {
        ...input,
        notes: input.notes ?? item.text, // the dump text stays attached as the "why"
        sourceUrl: item.sourceUrl ?? undefined,
      },
      tx,
    );

    // status='open' predicate keeps the transition atomic even against a
    // concurrent discard (which runs outside this lock): losing the race
    // matches 0 rows → 409, rolling back the habit insert above.
    const [updated] = await tx
      .update(inboxItems)
      .set({ status: 'converted', habitId: habit.id })
      .where(and(eq(inboxItems.id, item.id), eq(inboxItems.status, 'open')))
      .returning();
    if (!updated) throw alreadyTriaged();

    const unlockedAchievements = await unlockAchievements(tx, userId, user);
    return { item: toContract(updated), habit, unlockedAchievements };
  });
}

/** Discard is allowed only from 'open' — the conditional update makes it atomic. */
export async function discardItem(userId: string, itemId: string): Promise<InboxItemContract> {
  const [updated] = await db
    .update(inboxItems)
    .set({ status: 'discarded' })
    .where(
      and(
        eq(inboxItems.id, itemId),
        eq(inboxItems.userId, userId),
        eq(inboxItems.status, 'open'),
      ),
    )
    .returning();
  if (updated) return toContract(updated);

  // Nothing matched: distinguish "not yours / missing" (404) from "already triaged" (409).
  const [existing] = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(and(eq(inboxItems.id, itemId), eq(inboxItems.userId, userId)));
  if (existing) throw alreadyTriaged();
  throw notFound();
}
