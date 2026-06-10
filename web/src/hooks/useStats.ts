// GET /stats query — shared by the Stats page (rendering) and Layout (which
// seeds GameContext from the same cached data so the XP bar survives reloads).

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api';
import type { StatsResponse } from '../types';

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => apiFetch<StatsResponse>('/stats'),
  });
}
