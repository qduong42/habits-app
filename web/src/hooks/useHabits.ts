// React Query hooks for habits + categories. The check-in mutation is
// optimistic: it flips doneToday in the cache immediately and rolls back on
// error (except 409 already_done, where the optimistic state already matches
// the server and the settle-time invalidation re-syncs everything).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../api';
import { useGame } from './useGame';
import type {
  Category,
  CategoryInput,
  CheckinResponse,
  Habit,
  HabitInput,
  HabitPatch,
  HabitsResponse,
  UndoResponse,
} from '../types';

export function useHabits() {
  return useQuery({
    queryKey: ['habits'],
    queryFn: () => apiFetch<HabitsResponse>('/habits'),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  });
}

export interface CheckinVars {
  habitId: string;
  /** Desired new state: true = check in (POST), false = undo (DELETE). */
  done: boolean;
}

interface CheckinContext {
  previous: HabitsResponse | undefined;
}

/** Discriminate with `'xpGained' in result` (check-in) vs undo. */
export type CheckinResult = CheckinResponse | UndoResponse;

export function useCheckin() {
  const queryClient = useQueryClient();
  const { applyXp } = useGame();
  return useMutation<CheckinResult, Error, CheckinVars, CheckinContext>({
    // Shared key across all check-in/undo mutations so concurrent taps can be
    // counted in onSettled (and so they dedupe-invalidate, see below).
    mutationKey: ['checkin'],
    mutationFn: ({ habitId, done }) =>
      done
        ? apiFetch<CheckinResponse>(`/habits/${habitId}/checkin`, { method: 'POST' })
        : apiFetch<UndoResponse>(`/habits/${habitId}/checkin`, { method: 'DELETE' }),
    onMutate: async ({ habitId, done }) => {
      await queryClient.cancelQueries({ queryKey: ['habits'] });
      const previous = queryClient.getQueryData<HabitsResponse>(['habits']);
      queryClient.setQueryData<HabitsResponse>(['habits'], (old) =>
        old === undefined
          ? undefined
          : {
              ...old,
              habits: old.habits.map((h) =>
                h.id === habitId
                  ? {
                      ...h,
                      doneToday: done,
                      weekCount:
                        h.frequencyType === 'weekly'
                          ? Math.max(0, h.weekCount + (done ? 1 : -1))
                          : h.weekCount,
                      // Naive guess; the settle-time refetch corrects it.
                      streak: Math.max(0, h.streak + (done ? 1 : -1)),
                    }
                  : h,
              ),
            },
      );
      return { previous };
    },
    // Both response shapes carry server-truth {xpTotal, level} — feed the
    // GameContext so the XpBar tracks every check-in AND undo.
    onSuccess: (res, { habitId }) => {
      applyXp(res);
      if ('habitStreak' in res) {
        // Correct the optimistic streak guess with the server's number so the
        // flame is right immediately (the settle-time refetch confirms it).
        queryClient.setQueryData<HabitsResponse>(['habits'], (old) =>
          old === undefined
            ? undefined
            : {
                ...old,
                habits: old.habits.map((h) =>
                  h.id === habitId ? { ...h, streak: res.habitStreak } : h,
                ),
              },
        );
      }
    },
    onError: (err, _vars, context) => {
      // 409 already_done: the habit IS done — keep the optimistic "done" state
      // and let onSettled's invalidation reconcile. Everything else (e.g. 400
      // archived) rolls back to the snapshot.
      if (err instanceof ApiError && err.code === 'already_done') return;
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['habits'], context.previous);
      }
    },
    onSettled: () => {
      // Only the LAST in-flight check-in mutation invalidates; earlier ones
      // settling would refetch mid-burst and flicker optimistic rows back.
      if (queryClient.isMutating({ mutationKey: ['checkin'] }) === 1) {
        queryClient.invalidateQueries({ queryKey: ['habits'] });
      }
    },
  });
}

export function useCreateHabit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: HabitInput) =>
      apiFetch<Habit>('/habits', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['habits'] }),
  });
}

export function useUpdateHabit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: HabitPatch }) =>
      apiFetch<Habit>(`/habits/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['habits'] }),
  });
}

export function useArchiveHabit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/habits/${id}/archive`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['habits'] }),
  });
}

export function useDeleteHabit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/habits/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['habits'] }),
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CategoryInput) =>
      apiFetch<Category>('/categories', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories'] }),
  });
}
