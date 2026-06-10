// Shared display formatting helpers (kept outside component files so
// react-refresh/only-export-components stays happy).

/** Age label for a dump item: "just now", "5m", "5h", "3d". */
export function formatAge(createdAt: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(createdAt).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/* --- v1.1 additions --------------------------------------------------------- */

const MAX_TASK_NAME = 200; // server-enforced name limit

/** Dump text → task-name prefill: first line, capped at the server limit. */
export function taskNameFromDumpText(text: string): string {
  const firstLine = text.split('\n', 1)[0]!.trim();
  return firstLine.length > MAX_TASK_NAME
    ? firstLine.slice(0, MAX_TASK_NAME - 1).trimEnd() + '…'
    : firstLine;
}

/**
 * Local calendar date key (YYYY-MM-DD, browser TZ) — for GROUPING dump items
 * by dump date. Display labels are formatDumpDate; this key disambiguates
 * "Jun 10" across years.
 */
export function localDateKey(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** History date label: "Jun 10" (browser locale/TZ); adds the year when older. */
export function formatDumpDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Capture time "14:05" (browser TZ, 24h) for History items. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
