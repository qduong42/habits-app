// React Query hooks for the 📌 Tasks section. The ['tasks'] query fetches
// /tasks?all=1 so the collapsed "⏳ Scheduled" list is reachable from one
// cache entry; the complete/undo mutation shares the optimistic-toggle
// plumbing with useCheckin (useOptimisticToggle) — only the cache flip
// differs.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api';
import { useOptimisticToggle } from './useOptimisticToggle';
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
  return useOptimisticToggle<TasksResponse, TaskToggleVars, TaskCompleteResult>({
    mutationKey: 'task-complete',
    queryKey: ['tasks'],
    mutationFn: ({ task, done }) =>
      done
        ? apiFetch<TaskCompleteResponse>(`/tasks/${task.id}/complete`, { method: 'POST' })
        : apiFetch<UndoResponse>(`/tasks/${task.id}/complete`, { method: 'DELETE' }),
    optimisticUpdate: (old, { task, done }) => {
      const group: TaskGroup = done ? 'done' : guessOpenGroup(task);
      return {
        ...old,
        tasks: old.tasks.map((t) =>
          t.id === task.id ? { ...t, group, dueLabel: done ? null : t.dueLabel } : t,
        ),
      };
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
