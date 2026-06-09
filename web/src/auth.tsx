import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { apiFetch } from './api';

export interface Me {
  id: string;
  name: string;
}

export function useMe() {
  return useQuery<Me>({
    queryKey: ['me'],
    queryFn: () => apiFetch<Me>('/auth/me'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();

  if (me.isPending) {
    return <div className="loading">Loading…</div>;
  }
  if (me.isError) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
