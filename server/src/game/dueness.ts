/**
 * Pure task dueness grouping + due labels (no I/O). Tasks have two time
 * grains on purpose (ADR-0001): one-offs live on user-TZ local dates,
 * recurring tasks on `nextDue` instants that reset from the last completion.
 */

import { localDateFor } from './dates.js';

export type TaskGroup = 'overdue' | 'today' | 'undated' | 'done' | 'hidden';

/**
 * Contract-facing groups (Task 26 extension): the internal 'hidden' group
 * splits at the API boundary into excluded history (one-offs completed on a
 * past day) and 'scheduled' (not yet due — recurring before nextDue,
 * future-dated one-offs), which GET /tasks?all=1 includes.
 */
export type TaskContractGroup = Exclude<TaskGroup, 'hidden'> | 'scheduled';

/** The fields taskGroup needs — a Task row or a plain literal both fit. */
export interface DuenessTask {
  kind: 'oneoff' | 'recurring';
  /** one-off only */
  dueDate?: string | null;
  /** one-off terminal completion (instant) */
  completedAt?: string | Date | null;
  /** recurring only */
  intervalHours?: number | null;
  /** recurring only (instant) */
  nextDue?: string | Date | null;
  /** localDate of the recurring task's most recent completion, if any */
  latestCompletionLocalDate?: string | null;
}

const HOUR_MS = 3_600_000;

function instant(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Which Today-screen group a task belongs to. `hidden` tasks are excluded
 * from the API response entirely:
 * - recurring tasks that aren't due yet (and weren't completed today);
 * - future-dated one-offs (hidden until their due date — consistent with
 *   recurring tasks: nothing demands attention before it's due);
 * - one-offs completed on a previous day (terminal — they're history).
 *
 * `tz` resolves which local day an instant (nextDue/completedAt) falls on;
 * it defaults to UTC, matching the plan's pinned test snippet.
 */
export function taskGroup(
  task: DuenessTask,
  now: Date,
  today: string,
  tz: string = 'UTC',
): TaskGroup {
  if (task.kind === 'oneoff') {
    if (task.completedAt != null) {
      return localDateFor(tz, instant(task.completedAt)) === today ? 'done' : 'hidden';
    }
    if (task.dueDate == null) return 'undated';
    if (task.dueDate < today) return 'overdue';
    if (task.dueDate === today) return 'today';
    return 'hidden'; // future-dated: hidden until due
  }

  // recurring — nextDue is always set in practice; treat a missing one as
  // not-yet-due rather than guessing a due time.
  if (task.nextDue == null) return 'hidden';
  const nextDue = instant(task.nextDue);
  if (nextDue.getTime() <= now.getTime()) {
    // Due: it's the `today` group when the due time falls on the current
    // local day, `overdue` once it slipped past a day boundary.
    return localDateFor(tz, nextDue) === today ? 'today' : 'overdue';
  }
  // Not due: completed earlier today → show as done; otherwise hidden.
  return task.latestCompletionLocalDate === today ? 'done' : 'hidden';
}

/** The fields dueLabel needs: whichever of nextDue/dueDate applies. */
export interface DueLabelTask {
  dueDate?: string | null;
  nextDue?: string | Date | null;
}

/** 'due 20:00'-style time of day in the user's timezone. */
function hhmm(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/** 'Jun 13'-style short date in the given timezone. */
function monthDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
  }).format(at);
}

/**
 * Human label for a group:
 * - overdue: 'overdue 3h' under 24h late, 'overdue 1d' from 24h on
 *   (recurring measures from nextDue; one-offs count calendar days from
 *   dueDate — they're only ever overdue by whole days);
 * - today: recurring → 'due 20:00' (nextDue HH:MM in user TZ),
 *   one-off → 'due today';
 * - scheduled (not yet due, ?all=1 only): 'due 20:00' when nextDue is still
 *   today, otherwise 'due Jun 13' (nextDue/dueDate short date);
 * - undated/done/hidden: null.
 */
export function dueLabel(
  group: TaskGroup | TaskContractGroup,
  task: DueLabelTask,
  now: Date,
  tz: string,
): string | null {
  if (group === 'overdue') {
    if (task.nextDue != null) {
      const hoursLate = (now.getTime() - instant(task.nextDue).getTime()) / HOUR_MS;
      if (hoursLate < 24) return `overdue ${Math.max(1, Math.floor(hoursLate))}h`;
      return `overdue ${Math.floor(hoursLate / 24)}d`;
    }
    if (task.dueDate != null) {
      const today = localDateFor(tz, now);
      const days = Math.round(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${task.dueDate}T00:00:00Z`)) /
          (24 * HOUR_MS),
      );
      return `overdue ${days}d`;
    }
    return null;
  }
  if (group === 'today') {
    if (task.nextDue != null) return `due ${hhmm(instant(task.nextDue), tz)}`;
    return 'due today';
  }
  if (group === 'scheduled') {
    if (task.nextDue != null) {
      const due = instant(task.nextDue);
      // Due later today (e.g. a 12h chore knocked out this morning) keeps the
      // time-of-day form; anything beyond today gets the short date.
      if (localDateFor(tz, due) === localDateFor(tz, now)) return `due ${hhmm(due, tz)}`;
      return `due ${monthDay(due, tz)}`;
    }
    if (task.dueDate != null) {
      // dueDate is a plain user-TZ local date — format its parts as UTC so no
      // timezone math can shift the day.
      return `due ${monthDay(new Date(`${task.dueDate}T00:00:00Z`), 'UTC')}`;
    }
    return null;
  }
  return null;
}
