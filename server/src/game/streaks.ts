/**
 * Pure streak computations. Dates are YYYY-MM-DD strings, weeks are ISO
 * 'YYYY-Www'. Grace rule everywhere: the current (still in-progress) day or
 * week never breaks a streak — it only counts once it qualifies.
 */

import { addDays, prevIsoWeek } from './dates.js';

/** Consecutive days in `dates` ending at `end` (inclusive), walking backwards. */
function runEndingAt(dates: Set<string>, end: string): number {
  let streak = 0;
  let day = end;
  while (dates.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

/**
 * Consecutive checked days ending today — or ending yesterday when today is
 * still unchecked (today doesn't break the streak until it's over).
 */
export function dailyStreak(dates: Set<string>, today: string): number {
  const end = dates.has(today) ? today : addDays(today, -1);
  return runEndingAt(dates, end);
}

/**
 * Consecutive ISO weeks with `counts.get(week) >= target`, ending at
 * `currentWeek` (counts if already met) or the week before (the in-progress
 * week doesn't break the streak).
 */
export function weeklyStreak(
  counts: Map<string, number>,
  target: number,
  currentWeek: string,
): number {
  if (target <= 0) return 0; // met() would never be false → unbounded walk backwards
  const met = (week: string) => (counts.get(week) ?? 0) >= target;
  let week = met(currentWeek) ? currentWeek : prevIsoWeek(currentWeek);
  let streak = 0;
  while (met(week)) {
    streak++;
    week = prevIsoWeek(week);
  }
  return streak;
}

/**
 * Consecutive days with at least one check-in of any habit — same grace rule
 * as dailyStreak.
 */
export function dayStreak(dates: Set<string>, today: string): number {
  return dailyStreak(dates, today);
}

/**
 * Longest run of consecutive days ANYWHERE in history (not just the current
 * one). No grace rule — past runs are complete by definition. O(n): each
 * run is walked exactly once, starting from its first day.
 */
export function bestDailyStreak(dates: Set<string>): number {
  let best = 0;
  for (const start of dates) {
    if (dates.has(addDays(start, -1))) continue; // not a run start
    let len = 0;
    let day = start;
    while (dates.has(day)) {
      len++;
      day = addDays(day, 1);
    }
    if (len > best) best = len;
  }
  return best;
}

/**
 * Longest run of consecutive ISO weeks with `counts.get(week) >= target`
 * ANYWHERE in history. Weekly counterpart of bestDailyStreak; only weeks
 * present in `counts` can qualify, so walking backwards from each run end
 * terminates.
 */
export function bestWeeklyStreak(counts: Map<string, number>, target: number): number {
  if (target <= 0) return 0; // mirror weeklyStreak's guard against unbounded walks
  const met = (week: string) => (counts.get(week) ?? 0) >= target;
  let best = 0;
  for (const week of counts.keys()) {
    if (!met(week)) continue;
    // walk backwards from every qualifying week; run ends dominate the max
    let len = 0;
    let w = week;
    while (met(w)) {
      len++;
      w = prevIsoWeek(w);
    }
    if (len > best) best = len;
  }
  return best;
}
