// Profile — achievements gallery (full catalog; locked badges grayed with 🔒
// and their description still visible so they read as goals). Settings arrive
// in Task 19.

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api';
import { useMe } from '../useMe';
import type { Achievement } from '../types';

export default function Profile() {
  const me = useMe();
  const achievements = useQuery({
    queryKey: ['achievements'],
    queryFn: () => apiFetch<Achievement[]>('/achievements'),
  });

  const unlockedCount = achievements.data?.filter((a) => a.unlockedAt !== null).length ?? 0;

  return (
    <div>
      <h1 className="page-title">Profile</h1>
      {me.data && <p className="profile-name">Logged in as {me.data.name}.</p>}

      <h2 className="section-title">
        Achievements
        {achievements.data && (
          <span className="section-count">
            {unlockedCount}/{achievements.data.length}
          </span>
        )}
      </h2>

      {achievements.isPending && <p className="placeholder">Loading…</p>}
      {achievements.error && (
        <p className="form-error">Could not load achievements: {achievements.error.message}</p>
      )}

      {achievements.data && (
        <div className="badge-grid">
          {achievements.data.map((a) => {
            const unlocked = a.unlockedAt !== null;
            return (
              <div
                key={a.id}
                className={'badge-card' + (unlocked ? '' : ' badge-locked')}
                aria-label={`${a.name} — ${unlocked ? 'unlocked' : 'locked'}`}
              >
                <span className="badge-emoji" aria-hidden="true">
                  {unlocked ? a.emoji : '🔒'}
                </span>
                <span className="badge-name">{a.name}</span>
                <span className="badge-desc">{a.description}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
