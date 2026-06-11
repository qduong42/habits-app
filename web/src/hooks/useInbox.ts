// React Query hooks for the Dump (API name: inbox). The ['inbox'] query feeds
// both the Dump list and the tab-bar badge (open count) in Layout.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api';
import type {
  CaptureInput,
  ConvertInput,
  ConvertResponse,
  ConvertTaskInput,
  ConvertTaskResponse,
  InboxItem,
} from '../types';

/** Open dump items, newest first (the server's default GET filter). */
export function useInbox() {
  return useQuery({
    queryKey: ['inbox'],
    queryFn: () => apiFetch<InboxItem[]>('/inbox'),
  });
}

/**
 * ALL dump items (open + triaged), newest first — feeds the braindump History.
 * Lazy: pass `enabled=false` until the History section is first expanded.
 * Sharing the ['inbox'] key prefix means every mutation's
 * invalidateQueries({queryKey: ['inbox']}) keeps this fresh too.
 */
export function useInboxAll(enabled: boolean) {
  return useQuery({
    queryKey: ['inbox', 'all'],
    queryFn: () => apiFetch<InboxItem[]>('/inbox?all=1'),
    enabled,
  });
}

export function useCapture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CaptureInput) =>
      apiFetch<InboxItem>('/inbox', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  });
}

export function useConvert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: ConvertInput }) =>
      apiFetch<ConvertResponse>(`/inbox/${itemId}/convert`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['habits'] });
      // Freshly unlocked badges should show in the Profile gallery.
      if (res.unlockedAchievements.length > 0) {
        void queryClient.invalidateQueries({ queryKey: ['achievements'] });
      }
    },
  });
}

/** Triage a dump item into a one-off or recurring task (Task 27). */
export function useConvertTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: ConvertTaskInput }) =>
      apiFetch<ConvertTaskResponse>(`/inbox/${itemId}/convert-task`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (res.unlockedAchievements.length > 0) {
        void queryClient.invalidateQueries({ queryKey: ['achievements'] });
      }
    },
  });
}

/** Clear one History item (non-open) — hard delete, never touches a created
 * habit/task. Invalidating ['inbox'] refreshes the History (['inbox','all']). */
export function useDeleteHistoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch<{ ok: true }>(`/inbox/${itemId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  });
}

/** Clear a History day group — sends the group's exact item ids (TZ-proof);
 * the server deletes the caller's non-open ones and ignores the rest. */
export function useClearHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ deleted: number }>('/inbox/history/clear', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  });
}

/** Discard with an optional answer note — empty/absent note stores null. */
export function useDiscard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, note }: { itemId: string; note?: string }) =>
      apiFetch<InboxItem>(`/inbox/${itemId}/discard`, {
        method: 'POST',
        body: JSON.stringify(note !== undefined ? { note } : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  });
}
