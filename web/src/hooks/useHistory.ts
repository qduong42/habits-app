// React Query hook for the Done History (v1.2) — the read-only merged
// timeline of habit check-ins and task completions shown at the bottom of
// Today.

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api';
import type { HistoryEntry, HistoryResponse } from '../types';

/**
 * Every done-click, newest first (server default + hard cap 2000).
 * Lazy: pass `enabled=false` until the History section is first expanded —
 * same pattern as useInboxAll for the Dump History.
 */
export function useHistory(enabled: boolean) {
  return useQuery({
    queryKey: ['history'],
    queryFn: async (): Promise<HistoryEntry[]> =>
      (await apiFetch<HistoryResponse>('/history')).entries,
    enabled,
  });
}
