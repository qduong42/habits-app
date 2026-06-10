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
