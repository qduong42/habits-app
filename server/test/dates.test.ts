import { test, expect } from 'vitest';
import { localDateFor, addDays, isoWeekOf, prevIsoWeek, startOfIsoWeek } from '../src/game/dates.js';

test('localDateFor converts instant to TZ-local date', () => {
  const at = new Date('2026-06-09T23:30:00Z');
  expect(localDateFor('Europe/Berlin', at)).toBe('2026-06-10'); // UTC+2 in June
  expect(localDateFor('UTC', at)).toBe('2026-06-09');
});

test('localDateFor across Europe/Berlin spring-forward (2026-03-29 02:00 CET -> 03:00 CEST)', () => {
  // 00:59Z = 01:59 CET, one minute before the clocks jump
  expect(localDateFor('Europe/Berlin', new Date('2026-03-29T00:59:00Z'))).toBe('2026-03-29');
  // 01:00Z = 03:00 CEST, just after the jump — still the same local date
  expect(localDateFor('Europe/Berlin', new Date('2026-03-29T01:00:00Z'))).toBe('2026-03-29');
  // late evening UTC the night before is already the 29th locally (CET, +1)
  expect(localDateFor('Europe/Berlin', new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29');
});

test('addDays handles month boundaries', () => {
  expect(addDays('2026-05-31', 1)).toBe('2026-06-01');
  expect(addDays('2026-06-01', -1)).toBe('2026-05-31');
});

test('addDays handles year boundaries and leap days', () => {
  expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
  expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // 2028 is a leap year
  expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
});

test('addDays is UTC-pure across the Berlin DST transition', () => {
  // calendar arithmetic must not care about the 23-hour local day
  expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
  expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  expect(addDays('2026-03-30', -2)).toBe('2026-03-28');
});

test('isoWeekOf returns ISO year-week', () => {
  expect(isoWeekOf('2026-01-01')).toBe('2026-W01'); // Jan 1 2026 is a Thursday
  expect(isoWeekOf('2026-06-09')).toBe('2026-W24');
});

test('isoWeekOf handles year-boundary weeks', () => {
  // 2025 has 52 ISO weeks; Mon 2025-12-29 already belongs to 2026-W01
  expect(isoWeekOf('2025-12-28')).toBe('2025-W52');
  expect(isoWeekOf('2025-12-29')).toBe('2026-W01');
  // 2026 has 53 ISO weeks (Jan 1 2026 is a Thursday)
  expect(isoWeekOf('2026-12-31')).toBe('2026-W53');
  expect(isoWeekOf('2027-01-03')).toBe('2026-W53'); // Sunday closing out W53
  expect(isoWeekOf('2027-01-04')).toBe('2027-W01');
});

test('startOfIsoWeek returns the Monday of the ISO week', () => {
  expect(startOfIsoWeek('2026-06-11')).toBe('2026-06-08'); // Thursday → its Monday
  expect(startOfIsoWeek('2026-06-08')).toBe('2026-06-08'); // Monday is its own start
  expect(startOfIsoWeek('2026-06-14')).toBe('2026-06-08'); // Sunday still belongs to that Monday
  // W01 reaches back across the year boundary (Jan 1 2026 is a Thursday)
  expect(startOfIsoWeek('2026-01-01')).toBe('2025-12-29');
});

test('prevIsoWeek steps back one ISO week', () => {
  expect(prevIsoWeek('2026-W24')).toBe('2026-W23');
  // 2025 has only 52 ISO weeks, so the week before 2026-W01 is 2025-W52
  expect(prevIsoWeek('2026-W01')).toBe('2025-W52');
  // 2026 has 53 ISO weeks
  expect(prevIsoWeek('2027-W01')).toBe('2026-W53');
  expect(prevIsoWeek('2026-W53')).toBe('2026-W52');
});
