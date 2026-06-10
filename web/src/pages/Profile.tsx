// Profile — settings (daily nudge time, timezone), achievements gallery
// (full catalog; locked badges grayed with 🔒 and their description still
// visible so they read as goals), and logout.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';
import { useMe } from '../useMe';
import type { Achievement } from '../types';

const DEFAULT_NUDGE_TIME = '20:00';

// Frequently-used zones surfaced first; the full IANA list follows below.
const COMMON_ZONES = [
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/Warsaw',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'UTC',
];
const ALL_ZONES = Intl.supportedValuesOf('timeZone');
const OTHER_ZONES = ALL_ZONES.filter((z) => !COMMON_ZONES.includes(z));

interface SettingsBody {
  nudgeTime?: string | null;
  timezone?: string;
}

export default function Profile() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const achievements = useQuery({
    queryKey: ['achievements'],
    queryFn: () => apiFetch<Achievement[]>('/achievements'),
  });

  const settings = useMutation({
    mutationFn: (body: SettingsBody) =>
      apiFetch('/me/settings', { method: 'PUT', body: JSON.stringify(body) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  });

  // Local copy of the time-picker value so toggling the nudge back on reuses
  // the last chosen time; resynced whenever the server value changes (state
  // adjusted during render — React's sanctioned alternative to a sync effect).
  const serverNudgeTime = me.data?.nudgeTime ?? null;
  const [time, setTime] = useState(serverNudgeTime ?? DEFAULT_NUDGE_TIME);
  const [prevServerTime, setPrevServerTime] = useState(serverNudgeTime);
  if (serverNudgeTime !== prevServerTime) {
    setPrevServerTime(serverNudgeTime);
    if (serverNudgeTime) setTime(serverNudgeTime);
  }

  const nudgeOn = serverNudgeTime !== null;

  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    setLoggingOut(true);
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      // The ['me'] cache has a 5-min staleTime — without clearing, logging in
      // as a different user right after logout would render the previous user.
      queryClient.clear();
      navigate('/login');
    }
  }

  const unlockedCount = achievements.data?.filter((a) => a.unlockedAt !== null).length ?? 0;

  return (
    <div>
      <h1 className="page-title">Profile</h1>
      {me.data && <p className="profile-name">Logged in as {me.data.name}.</p>}

      <h2 className="section-title">Settings</h2>
      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-label" id="nudge-label">
            Daily nudge
          </span>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              aria-labelledby="nudge-label"
              checked={nudgeOn}
              disabled={!me.data || settings.isPending}
              onChange={(e) =>
                settings.mutate({ nudgeTime: e.target.checked ? time : null })
              }
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
        </div>

        {nudgeOn && (
          <div className="settings-row">
            <label className="settings-label" htmlFor="nudge-time">
              Time
            </label>
            <input
              id="nudge-time"
              className="settings-time"
              type="time"
              value={time}
              disabled={settings.isPending}
              onChange={(e) => {
                setTime(e.target.value);
                // A time input emits either '' or a complete HH:MM.
                if (e.target.value) settings.mutate({ nudgeTime: e.target.value });
              }}
            />
          </div>
        )}

        <div className="settings-row settings-row-stacked">
          <label className="settings-label" htmlFor="timezone">
            Timezone
          </label>
          <select
            id="timezone"
            className="settings-select"
            value={me.data?.timezone ?? 'Europe/Berlin'}
            disabled={!me.data || settings.isPending}
            onChange={(e) => settings.mutate({ timezone: e.target.value })}
          >
            <optgroup label="Common">
              {COMMON_ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </optgroup>
            <optgroup label="All timezones">
              {OTHER_ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {settings.error && (
          <p className="form-error">Could not save settings: {settings.error.message}</p>
        )}
      </div>

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

      <button
        type="button"
        className="btn-secondary logout-btn"
        disabled={loggingOut}
        onClick={() => void logout()}
      >
        {loggingOut ? 'Logging out…' : 'Log out'}
      </button>
    </div>
  );
}
