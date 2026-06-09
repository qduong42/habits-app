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
