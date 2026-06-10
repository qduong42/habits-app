/**
 * Pure XP / level math. Levels are flat: every 1000 XP is one level,
 * starting at level 1 with 0 XP.
 */

const XP_PER_LEVEL = 1000;
const CHECKIN_BASE_XP = 10;
const COMPLETES_DAY_BONUS_XP = 25;

/** Level for a total XP amount: floor(xp / 1000) + 1. */
export function levelFromXp(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

/** Progress within the current level: XP into the level and XP needed per level. */
export function levelProgress(xp: number): { into: number; needed: number } {
  return { into: xp % XP_PER_LEVEL, needed: XP_PER_LEVEL };
}

/** XP awarded for one check-in: base 10, +25 when it completes all scheduled habits for the day. */
export function checkinXp({ completesDay }: { completesDay: boolean }): number {
  return CHECKIN_BASE_XP + (completesDay ? COMPLETES_DAY_BONUS_XP : 0);
}

/**
 * XP per task completion: flat 5, no day-bonus interaction — tasks never
 * affect the +25 habit day bonus (spec: "Tasks & XP").
 */
export const TASK_COMPLETION_XP = 5;
