// React Query hooks for habits + categories. The check-in mutation rides the
// shared optimistic-toggle plumbing (useOptimisticToggle): doneToday flips in
// the cache immediately, rolls back on real errors, and 409 already_done
// keeps the optimistic state (it already matches the server).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api';
import { useOptimisticToggle } from './useOptimisticToggle';
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

/** Discriminate with `'xpGained' in result` (check-in) vs undo. */
export type CheckinResult = CheckinResponse | UndoResponse;

export function useCheckin() {
  return useOptimisticToggle<HabitsResponse, CheckinVars, CheckinResult>({
    mutationKey: 'checkin',
    queryKey: ['habits'],
    mutationFn: ({ habitId, done }) =>
      done
        ? apiFetch<CheckinResponse>(`/habits/${habitId}/checkin`, { method: 'POST' })
        : apiFetch<UndoResponse>(`/habits/${habitId}/checkin`, { method: 'DELETE' }),
    optimisticUpdate: (old, { habitId, done }) => ({
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
    }),
    // Correct the optimistic streak guess with the server's number so the
    // flame is right immediately (the settle-time refetch confirms it).
    onServerSuccess: (res, { habitId }, patchCache) => {
      if ('habitStreak' in res) {
        patchCache((old) => ({
          ...old,
          habits: old.habits.map((h) =>
            h.id === habitId ? { ...h, streak: res.habitStreak } : h,
          ),
        }));
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
