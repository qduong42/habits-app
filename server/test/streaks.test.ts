import { test, expect } from 'vitest';
import { dailyStreak, weeklyStreak, dayStreak } from '../src/game/streaks.js';
import { addDays } from '../src/game/dates.js';

// dailyStreak(dates: Set<string>, today: string): consecutive days ending today,
// or ending yesterday if today unchecked (today doesn't break it until it's over).
test('dailyStreak', () => {
  const d = new Set(['2026-06-07', '2026-06-08', '2026-06-09']);
  expect(dailyStreak(d, '2026-06-09')).toBe(3);
  expect(dailyStreak(new Set(['2026-06-07', '2026-06-08']), '2026-06-09')).toBe(2); // not broken yet
  expect(dailyStreak(new Set(['2026-06-06']), '2026-06-09')).toBe(0);
  expect(dailyStreak(new Set(), '2026-06-09')).toBe(0);
});

// weeklyStreak(counts: Map<isoWeek, number>, target, currentWeek): consecutive weeks
// meeting target, ending current week (counts if met) or the week before (current pending).
test('weeklyStreak', () => {
  const m = new Map([
    ['2026-W22', 3],
    ['2026-W23', 4],
  ]);
  expect(weeklyStreak(m, 3, '2026-W24')).toBe(2); // current week pending, not broken
  expect(weeklyStreak(new Map([['2026-W24', 3]]), 3, '2026-W24')).toBe(1);
  expect(weeklyStreak(new Map([['2026-W22', 2]]), 3, '2026-W24')).toBe(0);
});

// dayStreak: consecutive days with >=1 check-in of any habit (same grace rule as dailyStreak)
test('dayStreak', () => {
  expect(dayStreak(new Set(['2026-06-08', '2026-06-09']), '2026-06-09')).toBe(2);
});

// --- Edge cases beyond the plan's binding tests ---

test('dailyStreak counts a long run (30 days ending today)', () => {
  const dates = new Set<string>();
  let day = '2026-06-09';
  for (let i = 0; i < 30; i++) {
    dates.add(day);
    day = addDays(day, -1);
  }
  expect(dailyStreak(dates, '2026-06-09')).toBe(30);
});

test('dailyStreak grace: streak ending exactly yesterday counts, day-before does not', () => {
  // gap is only today → grace applies
  expect(dailyStreak(new Set(['2026-06-06', '2026-06-07', '2026-06-08']), '2026-06-09')).toBe(3);
  // last check-in was the day before yesterday → streak is over
  expect(dailyStreak(new Set(['2026-06-06', '2026-06-07']), '2026-06-09')).toBe(0);
});

test('dailyStreak ignores a disconnected earlier run', () => {
  // 06-03..06-04 is separated from 06-08..06-09 by a gap
  const d = new Set(['2026-06-03', '2026-06-04', '2026-06-08', '2026-06-09']);
  expect(dailyStreak(d, '2026-06-09')).toBe(2);
});

test('weeklyStreak across a year boundary (2026-W01 follows 2025-W52)', () => {
  const m = new Map([
    ['2025-W51', 3],
    ['2025-W52', 3],
    ['2026-W01', 4],
  ]);
  expect(weeklyStreak(m, 3, '2026-W01')).toBe(3);
  // current week pending, streak carried from last year
  expect(weeklyStreak(new Map([['2025-W52', 3]]), 3, '2026-W01')).toBe(1);
});

test('weeklyStreak: target met exactly vs exceeded both count, under-target breaks', () => {
  const m = new Map([
    ['2026-W21', 3], // exactly
    ['2026-W22', 7], // exceeded
    ['2026-W23', 3], // exactly
  ]);
  expect(weeklyStreak(m, 3, '2026-W24')).toBe(3);
  // an under-target week in the middle breaks the run
  const broken = new Map([
    ['2026-W21', 3],
    ['2026-W22', 2],
    ['2026-W23', 3],
  ]);
  expect(weeklyStreak(broken, 3, '2026-W24')).toBe(1);
});

test('weeklyStreak: current week under target does not break, but does not count', () => {
  const m = new Map([
    ['2026-W22', 3],
    ['2026-W23', 3],
    ['2026-W24', 1], // in progress
  ]);
  expect(weeklyStreak(m, 3, '2026-W24')).toBe(2);
});

test('weeklyStreak with no qualifying weeks is 0', () => {
  expect(weeklyStreak(new Map(), 3, '2026-W24')).toBe(0);
});

test('dayStreak grace and break behave like dailyStreak', () => {
  expect(dayStreak(new Set(['2026-06-07', '2026-06-08']), '2026-06-09')).toBe(2); // grace
  expect(dayStreak(new Set(['2026-06-07']), '2026-06-09')).toBe(0); // broken
  expect(dayStreak(new Set(), '2026-06-09')).toBe(0);
});
