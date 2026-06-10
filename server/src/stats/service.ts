// GET /stats aggregates (Task 17). Pure computation lives in game/; this
// module only loads rows and assembles the contract.

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { categories, checkins, habits, users } from '../db/schema.js';
import { addDays, isoWeekOf, localDateFor, prevIsoWeek } from '../game/dates.js';
import { levelFromXp } from '../game/xp.js';
import {
  bestDailyStreak,
  bestWeeklyStreak,
  dayStreak,
  weekCounts,
} from '../game/streaks.js';
import { habitStreakOf } from '../habits/service.js';
import { HttpError } from '../errors.js';

/** GET /stats contract (plan: "Shared API contracts"). */
export interface StatsHabit {
  id: string;
  name: string;
  /** Category emoji — the contract carries no other category fields. */
  emoji: string;
  streak: number;
  bestStreak: number;
  /** Completion % 0-100 over the last 28 days (see last28 helpers). */
  last28: number;
}

export interface Stats {
  dayStreak: number;
  totalCheckins: number;
  xpTotal: number;
  level: number;
  habits: StatsHabit[];
}

/**
 * Daily last28: share of the 28-day window ending today (inclusive — today
 * and the 27 days before it) that has a check-in, as a rounded 0-100 int.
 * ISO date strings compare lexicographically, so plain string bounds work.
 */
function last28Daily(dates: ReadonlySet<string>, today: string): number {
  const windowStart = addDays(today, -27);
  let done = 0;
  for (const d of dates) {
    if (d >= windowStart && d <= today) done++;
  }
  return Math.round((done / 28) * 100);
}

/**
 * Weekly last28: of the 4-ISO-week window made of the current (in-progress)
 * week and the 3 weeks before it, the share of weeks whose check-in count
 * meets the target, as a rounded 0-100 int (so always a multiple of 25).
 * The current week counts only once the target is met — an in-progress week
 * that hasn't reached it yet simply scores 0 for that quarter of the bar.
 */
function last28Weekly(counts: Map<string, number>, target: number, today: string): number {
  if (target <= 0) return 0;
  let met = 0;
  let week = isoWeekOf(today);
  for (let i = 0; i < 4; i++) {
    if ((counts.get(week) ?? 0) >= target) met++;
    week = prevIsoWeek(week);
  }
  return Math.round((met / 4) * 100);
}

export async function getStats(userId: string): Promise<Stats> {
  const [user] = await db
    .select({ timezone: users.timezone, xpTotal: users.xpTotal })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new HttpError(401, 'unauthenticated', 'Invalid session');
  const today = localDateFor(user.timezone);

  // ALL of the user's habit check-ins, including archived habits' — history
  // keeps counting toward dayStreak/totalCheckins (matches the reward path).
  // NOTE: task completions are deliberately NOT included: they earn their own
  // XP, but the stats headline measures habit practice only.
  const checkinRows = await db
    .select({ habitId: checkins.habitId, localDate: checkins.localDate })
    .from(checkins)
    .where(eq(checkins.userId, userId));

  const allDates = new Set<string>();
  const datesByHabit = new Map<string, Set<string>>();
  for (const c of checkinRows) {
    allDates.add(c.localDate);
    let set = datesByHabit.get(c.habitId);
    if (!set) datesByHabit.set(c.habitId, (set = new Set()));
    set.add(c.localDate);
  }

  // Active habits only — archived ones are paused, not part of current stats.
  const rows = await db
    .select({ habit: habits, category: categories })
    .from(habits)
    .innerJoin(categories, eq(habits.categoryId, categories.id))
    .where(and(eq(habits.userId, userId), isNull(habits.archivedAt)))
    .orderBy(habits.createdAt);

  const habitStats: StatsHabit[] = rows.map(({ habit, category }) => {
    const dates = datesByHabit.get(habit.id) ?? new Set<string>();
    const base = {
      id: habit.id,
      name: habit.name,
      emoji: category.emoji,
      // Same current-streak rule the Today list shows (habits/service.ts).
      streak: habitStreakOf(habit, dates, today),
    };
    if (habit.frequencyType === 'daily') {
      return { ...base, bestStreak: bestDailyStreak(dates), last28: last28Daily(dates, today) };
    }
    const counts = weekCounts(dates);
    const target = habit.weeklyTarget ?? 0;
    return {
      ...base,
      bestStreak: bestWeeklyStreak(counts, target),
      last28: last28Weekly(counts, target, today),
    };
  });

  return {
    dayStreak: dayStreak(allDates, today),
    totalCheckins: checkinRows.length,
    xpTotal: user.xpTotal,
    level: levelFromXp(user.xpTotal),
    habits: habitStats,
  };
}
