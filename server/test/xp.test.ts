import { test, expect } from 'vitest';
import { levelFromXp, levelProgress, checkinXp } from '../src/game/xp.js';

test('level math', () => {
  expect(levelFromXp(0)).toBe(1);
  expect(levelFromXp(999)).toBe(1);
  expect(levelFromXp(1000)).toBe(2);
  expect(levelFromXp(6620)).toBe(7);
});

test('progress', () => expect(levelProgress(6620)).toEqual({ into: 620, needed: 1000 }));

test('checkinXp: base 10, +25 bonus when completing the day', () => {
  expect(checkinXp({ completesDay: false })).toBe(10);
  expect(checkinXp({ completesDay: true })).toBe(35);
});

test('levelProgress at exact level boundaries', () => {
  expect(levelProgress(0)).toEqual({ into: 0, needed: 1000 });
  expect(levelProgress(1000)).toEqual({ into: 0, needed: 1000 });
  expect(levelProgress(999)).toEqual({ into: 999, needed: 1000 });
});
