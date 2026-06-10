// Shared optimistic-toggle mutation plumbing for habit check-ins
// (useCheckin) and task completions (useCompleteTask). Both follow the same
// dance: flip the cached row immediately, feed server-truth XP to the
// GameContext, keep the optimistic state on 409 already_done (the row IS
// done server-side), roll back on real errors, and let only the LAST
// in-flight toggle invalidate so double-taps don't flicker.

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from '../api';
import { useGame } from './useGame';

interface ToggleContext<TCache> {
  previous: TCache | undefined;
}

export interface OptimisticToggleOptions<
  TCache,
  TVars,
  TResult extends { xpTotal: number; level: number },
> {
  /** Shared mutation key so concurrent toggles can be counted in onSettled. */
  mutationKey: string;
  /** The cache entry to flip optimistically and refetch on settle. */
  queryKey: QueryKey;
  mutationFn: (vars: TVars) => Promise<TResult>;
  /** Pure optimistic cache flip; the settle-time refetch corrects guesses. */
  optimisticUpdate: (old: TCache, vars: TVars) => TCache;
  /**
   * Extra server-truth patching after success (e.g. the habit streak fix).
   * `patchCache` applies an updater to the cache entry when it exists.
   */
  onServerSuccess?: (
    res: TResult,
    vars: TVars,
    patchCache: (updater: (old: TCache) => TCache) => void,
  ) => void;
}

export function useOptimisticToggle<
  TCache,
  TVars,
  TResult extends { xpTotal: number; level: number },
>({
  mutationKey,
  queryKey,
  mutationFn,
  optimisticUpdate,
  onServerSuccess,
}: OptimisticToggleOptions<TCache, TVars, TResult>) {
  const queryClient = useQueryClient();
  const { applyXp } = useGame();
  return useMutation<TResult, Error, TVars, ToggleContext<TCache>>({
    mutationKey: [mutationKey],
    mutationFn,
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TCache>(queryKey);
      queryClient.setQueryData<TCache>(queryKey, (old) =>
        old === undefined ? undefined : optimisticUpdate(old, vars),
      );
      return { previous };
    },
    // Both response shapes (reward and undo) carry server-truth
    // {xpTotal, level} — feed the GameContext so the XpBar tracks every
    // toggle. Undo responses carry no unlockedAchievements field.
    onSuccess: (res, vars) => {
      applyXp(res);
      const unlocked = (res as { unlockedAchievements?: unknown[] }).unlockedAchievements;
      if (unlocked !== undefined && unlocked.length > 0) {
        // Freshly unlocked badges should show in the Profile gallery without
        // a manual refresh.
        void queryClient.invalidateQueries({ queryKey: ['achievements'] });
      }
      onServerSuccess?.(res, vars, (updater) =>
        queryClient.setQueryData<TCache>(queryKey, (old) =>
          old === undefined ? undefined : updater(old),
        ),
      );
    },
    onError: (err, _vars, context) => {
      // 409 already_done: the row IS done — keep the optimistic state and
      // let onSettled's invalidation reconcile. Everything else (e.g. 400
      // archived) rolls back to the snapshot.
      if (err instanceof ApiError && err.code === 'already_done') return;
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      // Only the LAST in-flight toggle invalidates; earlier ones settling
      // would refetch mid-burst and flicker optimistic rows back.
      if (queryClient.isMutating({ mutationKey: [mutationKey] }) === 1) {
        void queryClient.invalidateQueries({ queryKey });
        // Stats reads xpTotal/streaks from its own cache — refresh it after
        // every toggle so the Stats page (and the XP-bar seed in Layout)
        // can't serve a stale snapshot.
        void queryClient.invalidateQueries({ queryKey: ['stats'] });
      }
    },
  });
}
