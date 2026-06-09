import { test, expect } from 'vitest';
import { checkAchievements, ACHIEVEMENT_CATALOG } from '../src/game/achievements.js';

// Binding test from the plan (Task 12) — verbatim.
// checkAchievements(ctx) → string[] of newly unlocked ids
// ctx: { totalCheckins, habitStreak, dayStreak, level, conversions,
//        categoriesToday, unlocked: Set<string> }
test('awards thresholds crossed and skips already-unlocked', () => {
  const ids = checkAchievements({ totalCheckins: 1, habitStreak: 1, dayStreak: 1,
    level: 1, conversions: 0, categoriesToday: 1, unlocked: new Set() });
  expect(ids).toEqual(['first-checkin']);
  const ids2 = checkAchievements({ totalCheckins: 100, habitStreak: 7, dayStreak: 7,
    level: 5, conversions: 0, categoriesToday: 3, unlocked: new Set(['first-checkin']) });
  expect(ids2.sort()).toEqual(['balanced-day','checkins-100','day-streak-7','habit-streak-7','level-5']);
});

// --- Edge cases beyond the plan's binding test ---

test('returns nothing when everything is already unlocked', () => {
  const all = new Set(ACHIEVEMENT_CATALOG.map((a) => a.id));
  const ids = checkAchievements({
    totalCheckins: 5000,
    habitStreak: 365,
    dayStreak: 365,
    level: 99,
    conversions: 100,
    categoriesToday: 10,
    unlocked: all,
  });
  expect(ids).toEqual([]);
});

test('zero-activity context unlocks nothing', () => {
  const ids = checkAchievements({
    totalCheckins: 0,
    habitStreak: 0,
    dayStreak: 0,
    level: 1,
    conversions: 0,
    categoriesToday: 0,
    unlocked: new Set(),
  });
  // level 1 is the starting level, not an achievement; nothing else qualifies
  expect(ids).toEqual([]);
});

test('conversions trigger first-conversion, conversions-5, conversions-25', () => {
  const base = {
    totalCheckins: 0,
    habitStreak: 0,
    dayStreak: 0,
    level: 1,
    categoriesToday: 0,
  };
  expect(
    checkAchievements({ ...base, conversions: 1, unlocked: new Set() }),
  ).toEqual(['first-conversion']);
  expect(
    checkAchievements({
      ...base,
      conversions: 5,
      unlocked: new Set(['first-conversion']),
    }),
  ).toEqual(['conversions-5']);
  expect(
    checkAchievements({
      ...base,
      conversions: 25,
      unlocked: new Set(['first-conversion', 'conversions-5']),
    }),
  ).toEqual(['conversions-25']);
  // jumping past several thresholds at once unlocks all of them
  expect(
    checkAchievements({ ...base, conversions: 30, unlocked: new Set() }).sort(),
  ).toEqual(['conversions-25', 'conversions-5', 'first-conversion']);
});

test('ordering is stable: catalog order, deterministic across calls', () => {
  const ctx = {
    totalCheckins: 1000,
    habitStreak: 100,
    dayStreak: 30,
    level: 10,
    conversions: 25,
    categoriesToday: 3,
    unlocked: new Set<string>(),
  };
  const a = checkAchievements(ctx);
  const b = checkAchievements(ctx);
  expect(a).toEqual(b);
  // full board: every catalog entry unlocks, in catalog order
  expect(a).toEqual(ACHIEVEMENT_CATALOG.map((x) => x.id));
});

test('catalog has the 14 binding slugs', () => {
  expect(ACHIEVEMENT_CATALOG.map((a) => a.id).sort()).toEqual(
    [
      'balanced-day',
      'checkins-100',
      'checkins-1000',
      'conversions-25',
      'conversions-5',
      'day-streak-30',
      'day-streak-7',
      'first-checkin',
      'first-conversion',
      'habit-streak-100',
      'habit-streak-30',
      'habit-streak-7',
      'level-10',
      'level-5',
    ].sort(),
  );
  for (const a of ACHIEVEMENT_CATALOG) {
    expect(a.name).toBeTruthy();
    expect(a.description).toBeTruthy();
    expect(a.emoji).toBeTruthy();
  }
});
