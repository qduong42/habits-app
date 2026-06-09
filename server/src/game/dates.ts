/**
 * Pure date utilities. All "local date" strings are YYYY-MM-DD; weeks are
 * ISO 8601 'YYYY-Www'. No I/O, no mutable state.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Calendar date (YYYY-MM-DD) of the instant `at` in the IANA time zone `tz`. */
export function localDateFor(tz: string, at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function partsOf(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined || Number.isNaN(y + m + d)) {
    throw new Error(`Invalid date string: ${date}`);
  }
  return [y, m, d];
}

function toDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add `n` calendar days to a YYYY-MM-DD string. UTC arithmetic — DST-proof. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = partsOf(date);
  return toDateString(new Date(Date.UTC(y, m - 1, d + n)));
}

/** ISO 8601 week of a YYYY-MM-DD date, as 'YYYY-Www' (Thursday algorithm). */
export function isoWeekOf(date: string): string {
  const [y, m, d] = partsOf(date);
  const thursday = new Date(Date.UTC(y, m - 1, d));
  // shift to the Thursday of this ISO week (Mon=0 ... Sun=6)
  const dow = (thursday.getUTCDay() + 6) % 7;
  thursday.setUTCDate(thursday.getUTCDate() - dow + 3);
  const weekYear = thursday.getUTCFullYear();
  // W01 is the week containing Jan 4 of the week-year
  const jan4 = new Date(Date.UTC(weekYear, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const week1Thursday = Date.UTC(weekYear, 0, 4 - jan4Dow + 3);
  const week = 1 + Math.round((thursday.getTime() - week1Thursday) / WEEK_MS);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

/** The ISO week immediately before `week` ('YYYY-Www'), e.g. 2026-W01 → 2025-W52. */
export function prevIsoWeek(week: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) throw new Error(`Invalid ISO week string: ${week}`);
  const year = Number(match[1]);
  const wk = Number(match[2]);
  // Thursday of W01 is in the week containing Jan 4
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const thursdayOfWeek = new Date(Date.UTC(year, 0, 4 - jan4Dow + 3 + (wk - 1) * 7));
  thursdayOfWeek.setUTCDate(thursdayOfWeek.getUTCDate() - 7);
  return isoWeekOf(toDateString(thursdayOfWeek));
}
