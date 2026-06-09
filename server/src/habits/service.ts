import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { categories, checkins, habits, users } from '../db/schema.js';
import type { Category, Habit } from '../db/schema.js';
import { addDays, isoWeekOf, localDateFor } from '../game/dates.js';
import { HttpError } from '../errors.js';

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

/**
 * Simple consecutive-days streak ending today (or yesterday when today is
 * still unchecked — an open today doesn't break the run). The full streak
 * module (incl. weekly streaks) arrives in Task 11.
 */
function inlineDailyStreak(dates: ReadonlySet<string>, today: string): number {
  let day = dates.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (dates.has(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

function toContract(
  habit: Habit,
  category: Category,
  dates: ReadonlySet<string>,
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
  // Weekly streaks are wired in Task 11 — 0 for now.
  const streak = habit.frequencyType === 'daily' ? inlineDailyStreak(dates, today) : 0;
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

/** POST /habits/:id/checkin contract. XP fields are zeroed until Task 13. */
export interface CheckinResult {
  xpGained: number;
  xpTotal: number;
  level: number;
  leveledUp: boolean;
  habitStreak: number;
  unlockedAchievements: never[];
}

async function ownedHabit(userId: string, habitId: string): Promise<Habit> {
  const [habit] = await db
    .select()
    .from(habits)
    .where(and(eq(habits.id, habitId), eq(habits.userId, userId)));
  if (!habit) throw notFound();
  return habit;
}

export async function checkinHabit(userId: string, habitId: string): Promise<CheckinResult> {
  const habit = await ownedHabit(userId, habitId);
  if (habit.archivedAt !== null) {
    throw new HttpError(400, 'archived', 'Cannot check in an archived habit');
  }
  const today = await todayFor(userId);
  try {
    await db.insert(checkins).values({ habitId, userId, localDate: today });
  } catch (err) {
    if (isUniqueViolation(err, 'uniq_checkin_per_day')) {
      throw new HttpError(409, 'already_done', 'Habit already checked in today');
    }
    throw err;
  }
  const rows = await db
    .select({ localDate: checkins.localDate })
    .from(checkins)
    .where(eq(checkins.habitId, habitId));
  const habitStreak = inlineDailyStreak(new Set(rows.map((r) => r.localDate)), today);
  // XP/levels/achievements are wired in Task 13 — placeholders for now.
  return {
    xpGained: 0,
    xpTotal: 0,
    level: 1,
    leveledUp: false,
    habitStreak,
    unlockedAchievements: [],
  };
}

export async function undoCheckin(userId: string, habitId: string): Promise<void> {
  await ownedHabit(userId, habitId);
  const today = await todayFor(userId);
  const deleted = await db
    .delete(checkins)
    .where(and(eq(checkins.habitId, habitId), eq(checkins.localDate, today)))
    .returning({ id: checkins.id });
  if (deleted.length === 0) {
    throw new HttpError(404, 'not_found', 'No check-in today to undo');
  }
}

export async function deleteHabit(userId: string, habitId: string): Promise<void> {
  // checkins cascade via FK onDelete: 'cascade'
  const deleted = await db
    .delete(habits)
    .where(and(eq(habits.id, habitId), eq(habits.userId, userId)))
    .returning({ id: habits.id });
  if (deleted.length === 0) throw notFound();
}
