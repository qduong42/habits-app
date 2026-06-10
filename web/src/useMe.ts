import { useQuery } from '@tanstack/react-query';
import { ApiError, apiFetch } from './api';

export interface Me {
  id: string;
  name: string;
  /** IANA zone, e.g. 'Europe/Berlin' (server default). */
  timezone: string;
  /** 'HH:MM' 24h, or null when the daily nudge is off. */
  nudgeTime: string | null;
}

export function useMe() {
  return useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => apiFetch<Me>('/auth/me'),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 5 * 60 * 1000,
  });
}
