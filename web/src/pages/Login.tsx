import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../api';
import type { Me } from '../useMe';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Login() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setWaking(false);
    setSubmitting(true);
    // The free Heroku dyno sleeps after 30 min idle; the first request then
    // cold-starts (~15-20s). Show a reassuring hint if it's slow so the user
    // waits instead of giving up, and retry network failures (an aborted
    // cold-start connection) rather than surfacing "something went wrong".
    const wakeTimer = setTimeout(() => setWaking(true), 3000);
    try {
      let user: Me | null = null;
      for (let attempt = 0; ; attempt++) {
        try {
          user = await apiFetch<Me>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ name, password, rememberMe }),
          });
          break;
        } catch (err) {
          // A real server response (e.g. bad credentials) won't change on
          // retry — surface it. Only network failures get retried.
          if (err instanceof ApiError || attempt >= 3) throw err;
          setWaking(true);
          await sleep(2000);
        }
      }
      queryClient.setQueryData(['me'], user);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_credentials') {
        setError('Invalid name or password');
      } else {
        setError('Something went wrong — please try again');
      }
    } finally {
      clearTimeout(wakeTimer);
      setWaking(false);
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">🔥 Habits</h1>
        <form onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <span>Remember me</span>
          </label>
          {error && <p className="form-error">{error}</p>}
          {waking && !error && (
            <p className="form-hint">Waking the server up — the free server sleeps, this can take ~20s…</p>
          )}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? (waking ? 'Waking up…' : 'Logging in…') : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  );
}
