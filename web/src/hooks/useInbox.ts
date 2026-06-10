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

export function useDiscard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch<InboxItem>(`/inbox/${itemId}/discard`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  });
}
