// React Query hooks for the 📌 Tasks section. The ['tasks'] query fetches
// /tasks?all=1 so the collapsed "⏳ Scheduled" list is reachable from one
// cache entry; the complete/undo mutation mirrors useCheckin — optimistic
// group flip with rollback, GameContext XP feed, and last-in-flight
// invalidation to avoid double-tap flicker.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '../api';
import { useGame } from './useGame';
import type {
  TaskCompleteResponse,
  TaskGroup,
  TaskInput,
  TaskItem,
  TaskPatch,
  TasksResponse,
  UndoResponse,
} from '../types';

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: () => apiFetch<TasksResponse>('/tasks?all=1'),
  });
}

export interface TaskToggleVars {
  task: TaskItem;
  /** Desired new state: true = complete (POST), false = undo (DELETE). */
  done: boolean;
}

interface TaskToggleContext {
  previous: TasksResponse | undefined;
}

/** Discriminate with `'xpGained' in result` (complete) vs undo. */
export type TaskCompleteResult = TaskCompleteResponse | UndoResponse;

/** Local YYYY-MM-DD (en-CA formats as ISO) for the optimistic undo guess. */
function localToday(): string {
  return new Date().toLocaleDateString('en-CA');
}

/**
 * Where an undone task probably goes back to. A naive guess — the settle-time
 * refetch corrects it (recurring dueness lives server-side).
 */
function guessOpenGroup(task: TaskItem): TaskGroup {
  if (task.kind === 'recurring') return 'today';
  if (task.dueDate === null) return 'undated';
  const today = localToday();
  if (task.dueDate < today) return 'overdue';
  return task.dueDate === today ? 'today' : 'scheduled';
}

export function useCompleteTask() {
  const queryClient = useQueryClient();
  const { applyXp } = useGame();
  return useMutation<TaskCompleteResult, Error, TaskToggleVars, TaskToggleContext>({
    // Shared key so concurrent toggles can be counted in onSettled.
    mutationKey: ['task-complete'],
    mutationFn: ({ task, done }) =>
      done
        ? apiFetch<TaskCompleteResponse>(`/tasks/${task.id}/complete`, { method: 'POST' })
        : apiFetch<UndoResponse>(`/tasks/${task.id}/complete`, { method: 'DELETE' }),
    onMutate: async ({ task, done }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previous = queryClient.getQueryData<TasksResponse>(['tasks']);
      const group: TaskGroup = done ? 'done' : guessOpenGroup(task);
      queryClient.setQueryData<TasksResponse>(['tasks'], (old) =>
        old === undefined
          ? undefined
          : {
              ...old,
              tasks: old.tasks.map((t) =>
                t.id === task.id ? { ...t, group, dueLabel: done ? null : t.dueLabel } : t,
              ),
            },
      );
      return { previous };
    },
    // Both response shapes carry server-truth {xpTotal, level} → XpBar.
    onSuccess: (res) => {
      applyXp(res);
      if ('xpGained' in res && res.unlockedAchievements.length > 0) {
        void queryClient.invalidateQueries({ queryKey: ['achievements'] });
      }
    },
    onError: (err, _vars, context) => {
      // 409 already_done: the one-off IS done — keep the optimistic state and
      // let onSettled's invalidation reconcile. Everything else rolls back.
      if (err instanceof ApiError && err.code === 'already_done') return;
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['tasks'], context.previous);
      }
    },
    onSettled: () => {
      // Only the LAST in-flight toggle invalidates (see useCheckin).
      if (queryClient.isMutating({ mutationKey: ['task-complete'] }) === 1) {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      }
    },
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TaskInput) =>
      apiFetch<TaskItem>('/tasks', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) =>
      apiFetch<TaskItem>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
