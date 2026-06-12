import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { categories, checkins, habits, users } from '../db/schema.js';
import type { Category, Habit } from '../db/schema.js';
import { isoWeekOf, localDateFor } from '../game/dates.js';
import { checkinXp } from '../game/xp.js';
import { dailyStreak, weekCounts, weeklyStreak } from '../game/streaks.js';
import { awardAchievements, awardXp, chargeUndo, lockUserRow } from '../game/rewards.js';
import type { Tx, UndoResult, UnlockedAchievement, XpAward } from '../game/rewards.js';
import { toCategoryContract } from '../categories/service.js';
import type { CategoryContract } from '../categories/service.js';
import { HttpError } from '../errors.js';

// Re-exported for existing importers; the definitions live with the shared
// reward helpers (game/rewards.ts) and the categories service respectively.
export type { UndoResult, UnlockedAchievement } from '../game/rewards.js';
export type { CategoryContract } from '../categories/service.js';

/**
 * Either the pool-backed `db` or a transaction handle. The habit-creation
 * path accepts this so other services (inbox convert) can run it inside
 * their own transaction.
 */
export type DbOrTx = typeof db | Tx;

/** Shared API contract shape (plan: "Shared API contracts"). */
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
  /** Note on today's check-in ("climbing 1 hr"); null when unchecked or unnoted. */
  todayNote: string | null;
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

/** Current streak per the habit's frequency — shared with stats/service.ts. */
export function habitStreakOf(
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
  todayNote: string | null,
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
    category: toCategoryContract(category),
    frequencyType: habit.frequencyType,
    weeklyTarget: habit.weeklyTarget,
    scheduledToday,
    doneToday,
    weekCount,
    streak,
    todayNote: doneToday ? todayNote : null,
  };
}

async function todayFor(userId: string, ex: DbOrTx = db): Promise<string> {
  const [user] = await ex
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
async function buildHabits(userId: string, habitId?: string, ex: DbOrTx = db) {
  const today = await todayFor(userId, ex);
  const filters = [eq(habits.userId, userId), isNull(habits.archivedAt)];
  if (habitId) filters.push(eq(habits.id, habitId));
  const rows = await ex
    .select({ habit: habits, category: categories })
    .from(habits)
    .innerJoin(categories, eq(habits.categoryId, categories.id))
    .where(and(...filters))
    .orderBy(habits.createdAt);

  const datesByHabit = new Map<string, Set<string>>();
  const todayNoteByHabit = new Map<string, string | null>();
  if (rows.length > 0) {
    const checkinRows = await ex
      .select({ habitId: checkins.habitId, localDate: checkins.localDate, note: checkins.note })
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
      if (c.localDate === today) todayNoteByHabit.set(c.habitId, c.note);
    }
  }

  return {
    today,
    habits: rows.map((r) =>
      toContract(
        r.habit,
        r.category,
        datesByHabit.get(r.habit.id) ?? new Set(),
        today,
        todayNoteByHabit.get(r.habit.id) ?? null,
      ),
    ),
  };
}

export async function listHabits(
  userId: string,
): Promise<{ today: string; habits: HabitContract[] }> {
  return buildHabits(userId);
}

async function habitContract(
  userId: string,
  habitId: string,
  ex: DbOrTx = db,
): Promise<HabitContract> {
  const { habits: list } = await buildHabits(userId, habitId, ex);
  const habit = list[0];
  if (!habit) throw notFound();
  return habit;
}

/** Category must exist and be builtin (userId null) or owned by the user. */
async function assertCategoryUsable(
  userId: string,
  categoryId: string,
  ex: DbOrTx = db,
): Promise<void> {
  const [category] = await ex
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
  ex: DbOrTx = db,
): Promise<HabitContract> {
  await assertCategoryUsable(userId, input.categoryId, ex);
  const [created] = await ex
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
  return habitContract(userId, created!.id, ex);
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

/** POST /habits/:id/checkin contract (plan: "Shared API contracts"). */
export interface CheckinResult extends XpAward {
  habitStreak: number;
  unlockedAchievements: UnlockedAchievement[];
}

async function ownedHabit(tx: Tx, userId: string, habitId: string): Promise<Habit> {
  const [habit] = await tx
    .select()
    .from(habits)
    .where(and(eq(habits.id, habitId), eq(habits.userId, userId)));
  if (!habit) throw notFound();
  return habit;
}

export interface RewardState {
  /** Active (non-archived) habits — the day-completion population. */
  activeHabits: Pick<Habit, 'id' | 'frequencyType' | 'weeklyTarget'>[];
  /** ALL of the user's checkins (incl. archived habits' — history counts). */
  checkinRows: { habitId: string; localDate: string }[];
  datesByHabit: Map<string, Set<string>>;
}

/** Exported for the nudge job (push/nudge.ts) — selects only, so `db` works too. */
export async function loadRewardState(tx: DbOrTx, userId: string): Promise<RewardState> {
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
 *
 * Exported as a COUNT so the daily nudge (push/nudge.ts) shares the exact
 * day-bonus semantics: a habit is "open" iff it is scheduled and not done.
 */
export function openScheduledCount(
  activeHabits: RewardState['activeHabits'],
  datesByHabit: Map<string, Set<string>>,
  today: string,
): number {
  const currentWeek = isoWeekOf(today);
  let open = 0;
  for (const h of activeHabits) {
    const dates = datesByHabit.get(h.id) ?? new Set<string>();
    if (dates.has(today)) continue; // done today → scheduled-and-done
    if (h.frequencyType === 'daily') {
      open += 1; // daily always scheduled
      continue;
    }
    let weekCount = 0;
    for (const d of dates) {
      if (isoWeekOf(d) === currentWeek) weekCount += 1;
    }
    // weekly, not done today: scheduled (and open) iff under target
    if (weekCount < (h.weeklyTarget ?? 0)) open += 1;
  }
  return open;
}

function allScheduledDone(
  activeHabits: RewardState['activeHabits'],
  datesByHabit: Map<string, Set<string>>,
  today: string,
): boolean {
  return openScheduledCount(activeHabits, datesByHabit, today) === 0;
}

export async function checkinHabit(userId: string, habitId: string): Promise<CheckinResult> {
  try {
    return await db.transaction(async (tx) => {
      // Row lock FIRST (rewards.ts lockUserRow comment explains why).
      const user = await lockUserRow(tx, userId);
      const habit = await ownedHabit(tx, userId, habitId);
      if (habit.archivedAt !== null) {
        throw new HttpError(400, 'archived', 'Cannot check in an archived habit');
      }
      const today = localDateFor(user.timezone);

      // A duplicate aborts the transaction here; the 409 mapping happens
      // OUTSIDE the transaction (Rule 11) because the throw rolls it back.
      await tx.insert(checkins).values({ habitId, userId, localDate: today });

      // Everything below sees the post-insert state.
      const { activeHabits, checkinRows, datesByHabit } = await loadRewardState(tx, userId);
      const completesDay = allScheduledDone(activeHabits, datesByHabit, today);
      const habitStreak = habitStreakOf(habit, datesByHabit.get(habitId) ?? new Set(), today);

      const award = await awardXp(tx, userId, checkinXp({ completesDay }));

      // Achievement ctx — all post-insert, level post-increment; the shared
      // helper reuses the already-loaded check-in rows.
      const unlockedAchievements: UnlockedAchievement[] = await awardAchievements(tx, userId, {
        today,
        level: award.level,
        habitStreak,
        checkinRows,
      });

      return { ...award, habitStreak, unlockedAchievements };
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
    // Row lock FIRST (rewards.ts lockUserRow comment explains why).
    const user = await lockUserRow(tx, userId);
    const habit = await ownedHabit(tx, userId, habitId);
    if (habit.archivedAt !== null) {
      // Mirrors checkinHabit: without this, checkin → archive → undo would
      // refund a check-in that the user can never re-earn (-then-re-earn) and
      // exploit the day-bonus math.
      throw new HttpError(400, 'archived', 'Cannot undo a check-in on an archived habit');
    }
    const today = localDateFor(user.timezone);

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

    return chargeUndo(tx, userId, checkinXp({ completesDay: wasComplete && !nowComplete }));
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

/**
 * Set/edit/clear the note on TODAY's check-in (the "+ note" chip). Ownership
 * rides on checkins.userId — a foreign or missing habit and a day without a
 * check-in are the same 404: there is nothing to note.
 */
export async function setCheckinNote(
  userId: string,
  habitId: string,
  note: string | null,
): Promise<{ note: string | null }> {
  const today = await todayFor(userId);
  const updated = await db
    .update(checkins)
    .set({ note })
    .where(
      and(
        eq(checkins.habitId, habitId),
        eq(checkins.userId, userId),
        eq(checkins.localDate, today),
      ),
    )
    .returning({ note: checkins.note });
  if (updated.length === 0) {
    throw new HttpError(404, 'nothing_to_note', 'No check-in today to note');
  }
  return { note: updated[0]!.note };
}
