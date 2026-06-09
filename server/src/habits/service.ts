import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { achievements, categories, checkins, habits, userAchievements, users } from '../db/schema.js';
import type { Category, Habit } from '../db/schema.js';
import { isoWeekOf, localDateFor } from '../game/dates.js';
import { checkinXp, levelFromXp } from '../game/xp.js';
import { dailyStreak, dayStreak, weeklyStreak } from '../game/streaks.js';
import { checkAchievements } from '../game/achievements.js';
import { HttpError } from '../errors.js';

/** A drizzle transaction handle (same query API as `db`). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Shared API contract shapes (plan: "Shared API contracts"). */
export interface CategoryContract {
  id: string;
  name: string;
  emoji: string;
  color: string;
  builtin: boolean;
}

export interface HabitContract {
  id: string;
  name: string;
  notes: string | null;
  sourceUrl: string | null;
  category: CategoryContract;
  frequencyType: 'daily' | 'weekly';
  weeklyTarget: number | null;
  scheduledToday: boolean;
  doneToday: boolean;
  weekCount: number;
  streak: number;
}

export interface CreateHabitInput {
  name: string;
  categoryId: string;
  frequencyType: 'daily' | 'weekly';
  weeklyTarget?: number;
  notes?: string;
  sourceUrl?: string;
}

export interface UpdateHabitInput {
  name?: string;
  categoryId?: string;
  frequencyType?: 'daily' | 'weekly';
  weeklyTarget?: number;
  notes?: string | null;
  sourceUrl?: string | null;
}

const notFound = () => new HttpError(404, 'not_found', 'Habit not found');

/** Rule 11: Drizzle 0.45 wraps pg errors — pg fields live on `err.cause`. */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } } | null)?.cause;
  return cause?.code === '23505' && cause?.constraint === constraint;
}

/** Checkins-per-ISO-week counts for one habit's dates (weeklyStreak input). */
function weekCounts(dates: ReadonlySet<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const week = isoWeekOf(d);
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }
  return counts;
}

function habitStreakOf(
  habit: Pick<Habit, 'frequencyType' | 'weeklyTarget'>,
  dates: Set<string>,
  today: string,
): number {
  return habit.frequencyType === 'daily'
    ? dailyStreak(dates, today)
    : weeklyStreak(weekCounts(dates), habit.weeklyTarget ?? 0, isoWeekOf(today));
}

function toContract(
  habit: Habit,
  category: Category,
  dates: Set<string>,
  today: string,
): HabitContract {
  const doneToday = dates.has(today);
  const currentWeek = isoWeekOf(today);
  let weekCount = 0;
  for (const d of dates) {
    if (isoWeekOf(d) === currentWeek) weekCount += 1;
  }
  const scheduledToday =
    habit.frequencyType === 'daily'
      ? true
      : weekCount < (habit.weeklyTarget ?? 0) || doneToday;
  const streak = habitStreakOf(habit, dates, today);
  return {
    id: habit.id,
    name: habit.name,
    notes: habit.notes,
    sourceUrl: habit.sourceUrl,
    category: {
      id: category.id,
      name: category.name,
      emoji: category.emoji,
      color: category.color,
      builtin: category.userId === null,
    },
    frequencyType: habit.frequencyType,
    weeklyTarget: habit.weeklyTarget,
    scheduledToday,
    doneToday,
    weekCount,
    streak,
  };
}

async function todayFor(userId: string): Promise<string> {
  const [user] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new HttpError(401, 'unauthenticated', 'Invalid session');
  return localDateFor(user.timezone);
}

/**
 * Contract builder. One query for habits+categories, one for all checkins of
 * those habits (no N+1) — the daily streak needs full history anyway, and
 * doneToday/weekCount fall out of the same rows.
 */
async function buildHabits(userId: string, habitId?: string) {
  const today = await todayFor(userId);
  const filters = [eq(habits.userId, userId), isNull(habits.archivedAt)];
  if (habitId) filters.push(eq(habits.id, habitId));
  const rows = await db
    .select({ habit: habits, category: categories })
    .from(habits)
    .innerJoin(categories, eq(habits.categoryId, categories.id))
    .where(and(...filters))
    .orderBy(habits.createdAt);

  const datesByHabit = new Map<string, Set<string>>();
  if (rows.length > 0) {
    const checkinRows = await db
      .select({ habitId: checkins.habitId, localDate: checkins.localDate })
      .from(checkins)
      .where(
        inArray(
          checkins.habitId,
          rows.map((r) => r.habit.id),
        ),
      );
    for (const c of checkinRows) {
      let set = datesByHabit.get(c.habitId);
      if (!set) datesByHabit.set(c.habitId, (set = new Set()));
      set.add(c.localDate);
    }
  }

  return {
    today,
    habits: rows.map((r) =>
      toContract(r.habit, r.category, datesByHabit.get(r.habit.id) ?? new Set(), today),
    ),
  };
}

export async function listHabits(
  userId: string,
): Promise<{ today: string; habits: HabitContract[] }> {
  return buildHabits(userId);
}

async function habitContract(userId: string, habitId: string): Promise<HabitContract> {
  const { habits: list } = await buildHabits(userId, habitId);
  const habit = list[0];
  if (!habit) throw notFound();
  return habit;
}

/** Category must exist and be builtin (userId null) or owned by the user. */
async function assertCategoryUsable(userId: string, categoryId: string): Promise<void> {
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        or(isNull(categories.userId), eq(categories.userId, userId)),
      ),
    );
  if (!category) throw new HttpError(404, 'not_found', 'Category not found');
}

export async function createHabit(
  userId: string,
  input: CreateHabitInput,
): Promise<HabitContract> {
  await assertCategoryUsable(userId, input.categoryId);
  const [created] = await db
    .insert(habits)
    .values({
      userId,
      categoryId: input.categoryId,
      name: input.name,
      frequencyType: input.frequencyType,
      weeklyTarget: input.frequencyType === 'weekly' ? input.weeklyTarget : null,
      notes: input.notes ?? null,
      sourceUrl: input.sourceUrl ?? null,
    })
    .returning();
  return habitContract(userId, created!.id);
}

export async function updateHabit(
  userId: string,
  habitId: string,
  patch: UpdateHabitInput,
): Promise<HabitContract> {
  // Archived habits are hidden from the list, so they are "not found" for edits.
  const [habit] = await db
    .select()
    .from(habits)
    .where(and(eq(habits.id, habitId), eq(habits.userId, userId), isNull(habits.archivedAt)));
  if (!habit) throw notFound();

  if (patch.categoryId !== undefined) await assertCategoryUsable(userId, patch.categoryId);

  // Cross-field rules against the effective (merged) state — same semantics
  // as create: weekly needs a target, daily must not carry one (strict 400,
  // not silently stripped). Switching weekly→daily clears the target.
  const frequencyType = patch.frequencyType ?? habit.frequencyType;
  const targetProvided = patch.weeklyTarget !== undefined;
  if (frequencyType === 'daily' && targetProvided) {
    throw new HttpError(400, 'validation', 'weeklyTarget: not allowed for daily habits');
  }
  const weeklyTarget =
    frequencyType === 'daily' ? null : targetProvided ? patch.weeklyTarget! : habit.weeklyTarget;
  if (frequencyType === 'weekly' && weeklyTarget === null) {
    throw new HttpError(400, 'validation', 'weeklyTarget: required for weekly habits');
  }

  await db
    .update(habits)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.sourceUrl !== undefined ? { sourceUrl: patch.sourceUrl } : {}),
      frequencyType,
      weeklyTarget,
    })
    .where(eq(habits.id, habitId));
  return habitContract(userId, habitId);
}

export async function archiveHabit(userId: string, habitId: string): Promise<void> {
  // Already-archived habits are hidden everywhere else, so re-archive is 404 too.
  const updated = await db
    .update(habits)
    .set({ archivedAt: new Date() })
    .where(and(eq(habits.id, habitId), eq(habits.userId, userId), isNull(habits.archivedAt)))
    .returning({ id: habits.id });
  if (updated.length === 0) throw notFound();
}

/** Achievement contract: unlockedAt is non-null for fresh unlocks. */
export interface UnlockedAchievement {
  id: string;
  name: string;
  description: string;
  emoji: string;
  unlockedAt: string;
}

/** POST /habits/:id/checkin contract (plan: "Shared API contracts"). */
export interface CheckinResult {
  xpGained: number;
  xpTotal: number;
  level: number;
  leveledUp: boolean;
  habitStreak: number;
  unlockedAchievements: UnlockedAchievement[];
}

/**
 * DELETE /habits/:id/checkin response. Additive extension over the original
 * `{ok: true}` so the frontend (Task 14) can roll the XP bar back without a
 * refetch.
 */
export interface UndoResult {
  ok: true;
  /**
   * What the undo charged for. NOTE: when the GREATEST(…, 0) floor in
   * adjustXp clamps, `xpLost` may exceed the amount actually deducted —
   * clients must trust `xpTotal` as the new balance, never compute
   * `previous - xpLost`.
   */
  xpLost: number;
  xpTotal: number;
  level: number;
}

async function ownedHabit(tx: Tx, userId: string, habitId: string): Promise<Habit> {
  const [habit] = await tx
    .select()
    .from(habits)
    .where(and(eq(habits.id, habitId), eq(habits.userId, userId)));
  if (!habit) throw notFound();
  return habit;
}

async function userTodayFor(tx: Tx, userId: string): Promise<string> {
  const [user] = await tx
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new HttpError(401, 'unauthenticated', 'Invalid session');
  return localDateFor(user.timezone);
}

/**
 * Acquire the user's row lock (SELECT ... FOR UPDATE) for the rest of the
 * transaction. MUST run before loadRewardState in every reward transaction.
 *
 * This lock is load-bearing: it serializes same-user reward transactions so
 * loadRewardState always sees the prior transaction's inserts/deletes. It
 * guarantees:
 * - day-bonus correctness (two parallel check-ins can't both observe an
 *   "incomplete day minus me" snapshot and both award — or both skip — the
 *   25-point bonus);
 * - totalCheckins achievement thresholds are evaluated against a serialized
 *   count, so threshold crossings fire exactly once;
 * - undo can't double-charge the 25-point day bonus when two undos race;
 * - the userAchievements PK can't be hit by two transactions inserting the
 *   same badge (the conflict-safe insert below is belt-and-braces only).
 */
async function lockUserRow(tx: Tx, userId: string): Promise<void> {
  await tx
    .select({ xpTotal: users.xpTotal })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
}

interface RewardState {
  /** Active (non-archived) habits — the day-completion population. */
  activeHabits: Pick<Habit, 'id' | 'frequencyType' | 'weeklyTarget'>[];
  /** ALL of the user's checkins (incl. archived habits' — history counts). */
  checkinRows: { habitId: string; localDate: string }[];
  datesByHabit: Map<string, Set<string>>;
}

async function loadRewardState(tx: Tx, userId: string): Promise<RewardState> {
  const activeHabits = await tx
    .select({
      id: habits.id,
      frequencyType: habits.frequencyType,
      weeklyTarget: habits.weeklyTarget,
    })
    .from(habits)
    .where(and(eq(habits.userId, userId), isNull(habits.archivedAt)));
  const checkinRows = await tx
    .select({ habitId: checkins.habitId, localDate: checkins.localDate })
    .from(checkins)
    .where(eq(checkins.userId, userId));
  const datesByHabit = new Map<string, Set<string>>();
  for (const c of checkinRows) {
    let set = datesByHabit.get(c.habitId);
    if (!set) datesByHabit.set(c.habitId, (set = new Set()));
    set.add(c.localDate);
  }
  return { activeHabits, checkinRows, datesByHabit };
}

/**
 * Day-completion rule (same scheduledToday semantics as GET /habits):
 * daily habits are always scheduled; a weekly habit done today counts as
 * scheduled-and-done even when the check-in just reached the target; a weekly
 * habit NOT done today whose target is already met is unscheduled and
 * therefore excluded from the bonus requirement.
 */
function allScheduledDone(
  activeHabits: RewardState['activeHabits'],
  datesByHabit: Map<string, Set<string>>,
  today: string,
): boolean {
  const currentWeek = isoWeekOf(today);
  return activeHabits.every((h) => {
    const dates = datesByHabit.get(h.id) ?? new Set<string>();
    if (dates.has(today)) return true; // done today → scheduled-and-done
    if (h.frequencyType === 'daily') return false; // daily always scheduled
    let weekCount = 0;
    for (const d of dates) {
      if (isoWeekOf(d) === currentWeek) weekCount += 1;
    }
    // weekly, not done today: scheduled (and open) iff under target
    return weekCount >= (h.weeklyTarget ?? 0);
  });
}

/** Atomic xp_total adjustment; `delta` may be negative (floored at 0). */
async function adjustXp(tx: Tx, userId: string, delta: number): Promise<number> {
  const [updated] = await tx
    .update(users)
    .set({ xpTotal: sql`GREATEST(${users.xpTotal} + ${delta}, 0)` })
    .where(eq(users.id, userId))
    .returning({ xpTotal: users.xpTotal });
  return updated!.xpTotal;
}

export async function checkinHabit(userId: string, habitId: string): Promise<CheckinResult> {
  try {
    return await db.transaction(async (tx) => {
      // Row lock FIRST — see lockUserRow for why this ordering matters.
      await lockUserRow(tx, userId);
      const habit = await ownedHabit(tx, userId, habitId);
      if (habit.archivedAt !== null) {
        throw new HttpError(400, 'archived', 'Cannot check in an archived habit');
      }
      const today = await userTodayFor(tx, userId);

      // A duplicate aborts the transaction here; the 409 mapping happens
      // OUTSIDE the transaction (Rule 11) because the throw rolls it back.
      await tx.insert(checkins).values({ habitId, userId, localDate: today });

      // Everything below sees the post-insert state.
      const { activeHabits, checkinRows, datesByHabit } = await loadRewardState(tx, userId);
      const completesDay = allScheduledDone(activeHabits, datesByHabit, today);
      const habitStreak = habitStreakOf(habit, datesByHabit.get(habitId) ?? new Set(), today);

      const xpGained = checkinXp({ completesDay });
      const xpTotal = await adjustXp(tx, userId, xpGained);
      const level = levelFromXp(xpTotal);
      const leveledUp = level > levelFromXp(xpTotal - xpGained);

      // Achievement context — all post-insert, level post-increment.
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
        habitStreak,
        dayStreak: dayStreak(new Set(checkinRows.map((r) => r.localDate)), today),
        level,
        conversions: 0, // wired in Task 15 (inbox table doesn't exist yet)
        categoriesToday: todayCategoryRows.length,
        unlocked: new Set(unlockedRows.map((r) => r.achievementId)),
      });

      let unlockedAchievements: UnlockedAchievement[] = [];
      if (newIds.length > 0) {
        // Belt-and-braces: the row lock above already serializes same-user
        // transactions, but should an unlock ever race anyway, the loser hits
        // the conflict, inserts nothing, and (building the response from the
        // RETURNED rows only) reports no duplicate unlock.
        const inserted = await tx
          .insert(userAchievements)
          .values(newIds.map((achievementId) => ({ userId, achievementId })))
          .onConflictDoNothing()
          .returning();
        if (inserted.length > 0) {
          const insertedIds = inserted.map((r) => r.achievementId);
          const defs = await tx
            .select()
            .from(achievements)
            .where(inArray(achievements.id, insertedIds));
          const defById = new Map(defs.map((d) => [d.id, d]));
          unlockedAchievements = inserted.map((r) => {
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
      }

      return { xpGained, xpTotal, level, leveledUp, habitStreak, unlockedAchievements };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uniq_checkin_per_day')) {
      throw new HttpError(409, 'already_done', 'Habit already checked in today');
    }
    throw err;
  }
}

/**
 * Undo reverses exactly what today's check-in gained. The 25-point day bonus
 * is lost whenever the undo breaks a completed day — even when the check-in
 * being undone was not the one that completed it (spec: "undo reverses what
 * that check-in gained... and the +25 bonus if the undo breaks a completed
 * day"). Achievements are one-way and never revoked.
 */
export async function undoCheckin(userId: string, habitId: string): Promise<UndoResult> {
  return db.transaction(async (tx) => {
    // Row lock FIRST — see lockUserRow for why this ordering matters.
    await lockUserRow(tx, userId);
    const habit = await ownedHabit(tx, userId, habitId);
    if (habit.archivedAt !== null) {
      // Mirrors checkinHabit: without this, checkin → archive → undo would
      // refund a check-in that the user can never re-earn (-then-re-earn) and
      // exploit the day-bonus math.
      throw new HttpError(400, 'archived', 'Cannot undo a check-in on an archived habit');
    }
    const today = await userTodayFor(tx, userId);

    // userId predicate is defense-in-depth: ownedHabit already proved
    // ownership, but the delete must never touch another user's rows.
    const deleted = await tx
      .delete(checkins)
      .where(
        and(
          eq(checkins.habitId, habitId),
          eq(checkins.userId, userId),
          eq(checkins.localDate, today),
        ),
      )
      .returning({ id: checkins.id });
    if (deleted.length === 0) {
      throw new HttpError(404, 'not_found', 'No check-in today to undo');
    }

    // Post-delete state; reconstruct the pre-delete state in memory by adding
    // the removed check-in back (also restores its weekCount contribution).
    const { activeHabits, datesByHabit } = await loadRewardState(tx, userId);
    const nowComplete = allScheduledDone(activeHabits, datesByHabit, today);
    const beforeDelete = new Map(datesByHabit);
    beforeDelete.set(habitId, new Set([...(datesByHabit.get(habitId) ?? [])]).add(today));
    const wasComplete = allScheduledDone(activeHabits, beforeDelete, today);

    const xpLost = checkinXp({ completesDay: wasComplete && !nowComplete });
    const xpTotal = await adjustXp(tx, userId, -xpLost);
    return { ok: true, xpLost, xpTotal, level: levelFromXp(xpTotal) };
  });
}

export async function deleteHabit(userId: string, habitId: string): Promise<void> {
  // checkins cascade via FK onDelete: 'cascade'
  const deleted = await db
    .delete(habits)
    .where(and(eq(habits.id, habitId), eq(habits.userId, userId)))
    .returning({ id: habits.id });
  if (deleted.length === 0) throw notFound();
}
