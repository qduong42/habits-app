import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMe } from './useMe';

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();

  if (me.isPending) {
    return <div className="loading">Loading…</div>;
  }
  if (me.isError && !me.data) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
