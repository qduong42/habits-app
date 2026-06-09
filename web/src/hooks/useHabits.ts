// React Query hooks for habits + categories. The check-in mutation is
// optimistic: it flips doneToday in the cache immediately and rolls back on
// error (except 409 already_done, where the optimistic state already matches
// the server and the settle-time invalidation re-syncs everything).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../api';
import type {
  Category,
  CategoryInput,
  CheckinResponse,
  Habit,
  HabitInput,
  HabitPatch,
  HabitsResponse,
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

export function useCheckin() {
  const queryClient = useQueryClient();
  return useMutation<CheckinResponse | undefined, Error, CheckinVars, CheckinContext>({
    mutationFn: async ({ habitId, done }) => {
      if (done) {
        return apiFetch<CheckinResponse>(`/habits/${habitId}/checkin`, { method: 'POST' });
      }
      await apiFetch(`/habits/${habitId}/checkin`, { method: 'DELETE' });
      return undefined;
    },
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
    onError: (err, _vars, context) => {
      // 409 already_done: the habit IS done — keep the optimistic "done" state
      // and let onSettled's invalidation reconcile. Everything else (e.g. 400
      // archived) rolls back to the snapshot.
      if (err instanceof ApiError && err.code === 'already_done') return;
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['habits'], context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['habits'] }),
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
