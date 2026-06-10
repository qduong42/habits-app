import { test, expect } from 'vitest';
import { taskGroup, dueLabel } from '../src/game/dueness.js';

// Task 25: pure dueness grouping + label formatting. The first three tests are
// the BINDING snippet from the plan (signatures pinned); the rest are boundary
// cases per the plan's definitions block.

test('one-off grouping', () => {
  const base = { kind: 'oneoff', completedAt: null, dueDate: null } as const;
  expect(
    taskGroup({ ...base, dueDate: '2026-06-09' }, new Date('2026-06-10T08:00:00Z'), '2026-06-10'),
  ).toBe('overdue');
  expect(
    taskGroup({ ...base, dueDate: '2026-06-10' }, new Date('2026-06-10T08:00:00Z'), '2026-06-10'),
  ).toBe('today');
  expect(taskGroup(base, new Date('2026-06-10T08:00:00Z'), '2026-06-10')).toBe('undated');
});

test('recurring grouping incl. sub-daily reappearance', () => {
  const rec = { kind: 'recurring', intervalHours: 12 } as const;
  expect(
    taskGroup(
      { ...rec, nextDue: '2026-06-10T06:00:00Z' },
      new Date('2026-06-10T08:00:00Z'),
      '2026-06-10',
    ),
  ).toBe('today');
  expect(
    taskGroup(
      { ...rec, nextDue: '2026-06-09T06:00:00Z' },
      new Date('2026-06-10T08:00:00Z'),
      '2026-06-10',
    ),
  ).toBe('overdue'); // >24h late
  expect(
    taskGroup(
      { ...rec, nextDue: '2026-06-10T20:00:00Z' },
      new Date('2026-06-10T08:00:00Z'),
      '2026-06-10',
    ),
  ).toBe('hidden');
});

test('dueLabel', () => {
  expect(
    dueLabel('overdue', { nextDue: '2026-06-10T05:00:00Z' }, new Date('2026-06-10T08:00:00Z'), 'UTC'),
  ).toBe('overdue 3h');
  expect(
    dueLabel('today', { nextDue: '2026-06-10T20:00:00Z' }, new Date('2026-06-10T08:00:00Z'), 'UTC'),
  ).toBe('due 20:00');
  expect(
    dueLabel('today', { dueDate: '2026-06-10' }, new Date('2026-06-10T08:00:00Z'), 'UTC'),
  ).toBe('due today');
});

// ---- boundary cases beyond the binding snippet ----

const NOW = new Date('2026-06-10T08:00:00Z');
const TODAY = '2026-06-10';

test('one-off completed today is done; completed another day is hidden (terminal)', () => {
  const base = { kind: 'oneoff', dueDate: null } as const;
  expect(taskGroup({ ...base, completedAt: '2026-06-10T07:00:00Z' }, NOW, TODAY)).toBe('done');
  expect(taskGroup({ ...base, completedAt: '2026-06-09T07:00:00Z' }, NOW, TODAY)).toBe('hidden');
});

test('future-dated one-off is hidden until its due date', () => {
  const t = { kind: 'oneoff', completedAt: null, dueDate: '2026-06-12' } as const;
  expect(taskGroup(t, NOW, TODAY)).toBe('hidden');
});

test('recurring completed today and not yet due again is done', () => {
  const t = {
    kind: 'recurring',
    intervalHours: 12,
    nextDue: '2026-06-10T19:00:00Z', // not due yet
    latestCompletionLocalDate: '2026-06-10',
  } as const;
  expect(taskGroup(t, NOW, TODAY)).toBe('done');
});

test('recurring due again overrides done-today (sub-daily reappearance)', () => {
  const t = {
    kind: 'recurring',
    intervalHours: 4,
    nextDue: '2026-06-10T07:00:00Z', // due again
    latestCompletionLocalDate: '2026-06-10',
  } as const;
  expect(taskGroup(t, NOW, TODAY)).toBe('today');
});

test('recurring completed only on a previous day and not due is hidden', () => {
  const t = {
    kind: 'recurring',
    intervalHours: 120,
    nextDue: '2026-06-13T08:00:00Z',
    latestCompletionLocalDate: '2026-06-08',
  } as const;
  expect(taskGroup(t, NOW, TODAY)).toBe('hidden');
});

test('taskGroup respects the user timezone for nextDue day boundaries', () => {
  // 23:30 UTC yesterday = 01:30 today in Berlin (UTC+2 in June) → today group
  const t = { kind: 'recurring', intervalHours: 12, nextDue: '2026-06-09T23:30:00Z' } as const;
  expect(taskGroup(t, NOW, TODAY, 'Europe/Berlin')).toBe('today');
  expect(taskGroup(t, NOW, TODAY, 'UTC')).toBe('overdue');
});

test('dueLabel overdue switches to days at 24h and floors fresh overdues to 1h', () => {
  expect(dueLabel('overdue', { nextDue: '2026-06-09T06:00:00Z' }, NOW, 'UTC')).toBe('overdue 1d');
  expect(dueLabel('overdue', { nextDue: '2026-06-07T08:00:00Z' }, NOW, 'UTC')).toBe('overdue 3d');
  // 40 minutes late, already across the local-day boundary → never "overdue 0h"
  expect(
    dueLabel('overdue', { nextDue: '2026-06-09T23:50:00Z' }, new Date('2026-06-10T00:30:00Z'), 'UTC'),
  ).toBe('overdue 1h');
});

test('dueLabel for overdue one-offs counts calendar days from dueDate', () => {
  expect(dueLabel('overdue', { dueDate: '2026-06-09' }, NOW, 'UTC')).toBe('overdue 1d');
  expect(dueLabel('overdue', { dueDate: '2026-06-01' }, NOW, 'UTC')).toBe('overdue 9d');
});

test('dueLabel renders nextDue HH:MM in the user timezone', () => {
  // 18:00 UTC = 20:00 Berlin (June, UTC+2)
  expect(dueLabel('today', { nextDue: '2026-06-10T18:00:00Z' }, NOW, 'Europe/Berlin')).toBe(
    'due 20:00',
  );
});

test('dueLabel is null for undated and done groups', () => {
  expect(dueLabel('undated', { dueDate: null, nextDue: null }, NOW, 'UTC')).toBeNull();
  expect(dueLabel('done', { dueDate: '2026-06-10', nextDue: null }, NOW, 'UTC')).toBeNull();
});
