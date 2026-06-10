# Habits App

Mobile-first gamified habit tracker PWA for two users (huy, lea). Raw thoughts
land in the **Dump** tab, get **triaged** card-by-card into Tasks, Recurring
Tasks, or Habits, and the daily checklist pays out one shared XP economy
(check-ins +10, task completions +5, perfect day +35, levels, streaks,
achievements) — with an optional web-push daily nudge. Domain language and
decisions live in [CONTEXT.md](CONTEXT.md) and `docs/adr/`; the full spec and
implementation plan are under `docs/superpowers/`.

## Architecture

Single Node process: Express 5 API (`server/`, TypeScript + Drizzle ORM on
Postgres 16) that in production also serves the built React 19 SPA
(`web/`, Vite + vite-plugin-pwa, hash router) as static files — one origin,
no CORS. npm workspaces tie the two packages together.

## Dev setup

```sh
docker compose up -d --wait postgres   # Postgres 16 on localhost:5433
npm install
npm run db:migrate -w server
npm run db:seed -w server              # users huy + lea, builtin categories, achievements
npm run dev                            # API on :3001, Vite on :5173 (proxies /api)
```

Log in at http://localhost:5173 as `huy` or `lea`; the seed password is
`changeme123` unless `SEED_PASSWORD` was set when seeding. Re-running the seed
is idempotent (it never resets an existing user's password).

## Tests

```sh
npm run verify    # typecheck + tests + build, all workspaces
```

Server tests run against the `habits_test` database on the same compose
Postgres; dev data in `habits` is untouched.

## Production

```sh
JWT_SECRET=<random> docker compose up --build -d api
```

This builds `server/Dockerfile` (multi-stage: compile server + web, then a
slim runtime image), waits for healthy Postgres, runs migrations and the
idempotent seed, and serves API + SPA on **host port 3002**
(http://localhost:3002).

Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front:
browsers only allow service workers — i.e. **PWA install and push
notifications — over HTTPS** (localhost excepted). Login also depends on it:
with `NODE_ENV=production` the auth cookie is `Secure`, so on plain HTTP from
a non-localhost address (e.g. a LAN IP) the browser drops it and login
silently fails. Set a real `JWT_SECRET` and `SEED_PASSWORD`, and add VAPID
keys (below) if you want push. The login body field is `name` (not
`username`): `{"name": "huy", "password": "..."}`.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://habits:habits@localhost:5433/habits` (compose api: internal `postgres:5432`) | Postgres connection string |
| `JWT_SECRET` | `dev-secret-change-me` (compose: `change-me`) | Signs auth cookies — set a real secret in production |
| `PORT` | `3001` | API listen port inside the container/process |
| `SEED_PASSWORD` | `changeme123` | Initial password for `huy`/`lea` on first seed |
| `VAPID_PUBLIC_KEY` | unset | Web push (optional) |
| `VAPID_PRIVATE_KEY` | unset | Web push (optional) |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Push sender contact (optional) |

## Push setup

Web push (the daily nudge) is **optional**: without VAPID keys the server
boots normally, logs one warning, push routes answer
`503 {error: {code: 'push_disabled'}}`, and the scheduler's sends no-op.

1. Generate a VAPID key pair:

   ```sh
   npx web-push generate-vapid-keys
   ```

2. Put the keys in the server's environment (e.g. your `.env`):

   ```sh
   VAPID_PUBLIC_KEY=<Public Key from step 1>
   VAPID_PRIVATE_KEY=<Private Key from step 1>
   # optional; identifies the sender to push services
   VAPID_SUBJECT=mailto:admin@example.com
   ```

3. Restart the server, open Profile → Notifications in the app (production
   build — the service worker is only registered in `PROD`), and tap
   "Enable notifications". The daily nudge fires at your configured nudge
   time, in your configured timezone.

Note: browsers require HTTPS (or localhost) for service workers and push.
