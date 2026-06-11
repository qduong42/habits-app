// Profile — settings (daily nudge time, timezone), achievements gallery
// (full catalog; locked badges grayed with 🔒 and their description still
// visible so they read as goals), and logout.

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiFetch } from '../api';
import { disablePush, enablePush, pushSupported, resyncPush } from '../push';
import { useMe, type Me } from '../useMe';
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

function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setChanged(false);
    try {
      await apiFetch('/me/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setChanged(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_password') {
        setError('Current password is wrong');
      } else {
        setError(err instanceof Error ? err.message : 'Could not change the password');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="section-title">Change password</h2>
      <div className="settings-card">
        <form onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label">Current password</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">New password (min 8 characters)</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          {changed && <p className="settings-hint">Password changed</p>}
          <button type="submit" className="btn-secondary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </form>
      </div>
    </>
  );
}

export default function Profile() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const achievements = useQuery({
    queryKey: ['achievements'],
    queryFn: () => apiFetch<Achievement[]>('/achievements'),
  });

  // Optimistic: the nudge switch / timezone select reflect the new value
  // immediately via the ['me'] cache; a failure rolls back and surfaces the
  // error below, and the settle-time invalidation re-syncs either way.
  const settings = useMutation({
    mutationFn: (body: SettingsBody) =>
      apiFetch('/me/settings', { method: 'PUT', body: JSON.stringify(body) }),
    onMutate: async (body: SettingsBody) => {
      await queryClient.cancelQueries({ queryKey: ['me'] });
      const previous = queryClient.getQueryData<Me>(['me']);
      queryClient.setQueryData<Me>(['me'], (old) =>
        old === undefined
          ? undefined
          : {
              ...old,
              ...(body.nudgeTime !== undefined ? { nudgeTime: body.nudgeTime } : {}),
              ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
            },
      );
      return { previous };
    },
    onError: (_err, _body, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['me'], context.previous);
      }
    },
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

  // --- Push notifications ------------------------------------------------
  // Only offered where the browser supports SW + Push. The VAPID key fetch
  // doubles as the server-side feature flag: a 503 push_disabled means the
  // server has no VAPID keys, so the button is replaced by a hint. Any other
  // fetch error shows inline with a Retry button. Dev builds never register
  // the SW, so the button is replaced by a hint up front (no fetch either).
  const supported = pushSupported();
  const devBuild = import.meta.env.DEV;
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    // resyncPush re-uploads any live browser subscription so a server record
    // cleared by a 410 bounce matches the pushManager again before we show
    // the button as "enabled".
    void resyncPush().then((on) => {
      if (!cancelled) setPushOn(on);
    });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const vapid = useQuery({
    queryKey: ['push', 'vapid-key'],
    queryFn: () => apiFetch<{ key: string }>('/push/vapid-public-key'),
    enabled: supported && !devBuild,
    retry: false,
    staleTime: Infinity,
  });
  const pushDisabledOnServer =
    vapid.error instanceof ApiError && vapid.error.code === 'push_disabled';

  async function togglePush() {
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
      } else {
        if (!vapid.data) throw new Error('Push key not available');
        await enablePush(vapid.data.key);
        setPushOn(true);
      }
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Could not update notifications');
    } finally {
      setPushBusy(false);
    }
  }

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
              disabled={!me.data}
              onChange={(e) =>
                // Optimistic (see the settings mutation): the switch flips
                // immediately from the ['me'] cache, no pending lock-out.
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
              onChange={(e) => setTime(e.target.value)}
              // Save once on leaving the field, not per spinner tick/keystroke.
              // A time input emits either '' or a complete HH:MM.
              onBlur={() => {
                if (time && time !== serverNudgeTime) settings.mutate({ nudgeTime: time });
              }}
              onKeyDown={(e) => {
                // Enter commits the same way leaving the field does.
                if (e.key === 'Enter') e.currentTarget.blur();
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

        {supported && (
          <div className="settings-row">
            <span className="settings-label" id="push-label">
              Notifications
            </span>
            {devBuild ? (
              <span className="settings-hint">Production build only</span>
            ) : pushDisabledOnServer ? (
              <span className="settings-hint">Not configured on the server</span>
            ) : vapid.isError ? (
              <button
                type="button"
                className="btn-secondary"
                aria-labelledby="push-label"
                disabled={vapid.isFetching}
                onClick={() => void vapid.refetch()}
              >
                {vapid.isFetching ? 'Retrying…' : 'Retry'}
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary"
                aria-labelledby="push-label"
                disabled={pushBusy || vapid.isPending}
                onClick={() => void togglePush()}
              >
                {pushBusy ? 'Working…' : pushOn ? 'Disable notifications' : 'Enable notifications'}
              </button>
            )}
          </div>
        )}
        {supported && !devBuild && !pushDisabledOnServer && vapid.isError && (
          <p className="form-error">Could not load the push key: {vapid.error.message}</p>
        )}
        {pushError && <p className="form-error">{pushError}</p>}

        {settings.error && (
          <p className="form-error">Could not save settings: {settings.error.message}</p>
        )}
      </div>

      <ChangePasswordSection />

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
