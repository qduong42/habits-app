# Current Progress — habits-app (updated 2026-06-11, v1.2 night loop wrap-up)

## Shipped

- **v1** — merged to `master` via PR #1 (28/28 plan tasks, full overnight AFK loop). Spec/plan/QA under `docs/superpowers/`. Working: auth, habits + Today checklist, XP/levels/streaks/achievements (race-hardened), Dump capture + triage → habits/one-off/recurring tasks (sub-daily reset-on-completion), Stats, settings, PWA, web push nudge, production Docker Compose.
- **v1.2 "night shift"** — complete on `feat/v1.2-night` (off `feat/v1.1-dump-and-today`), 10/10 plan tasks, **276 tests green**, NO PR yet (open it after #2 merges — see Next actions). QA: `docs/superpowers/ralph/QA-REPORT-v1.2.md` (verdict GREEN with one feature gap for morning review: one-off completions invisible in Done History, `current_issues.md` 2026-06-11):
  - Done History section on Today (merged checkins+completions timeline, `GET /api/history`)
  - Task Reminders on one-off tasks (`remindAt`/`remindedAt`, per-minute push scan, Edit-UI + 🔔 badge)
  - Change password (API + Profile section)
  - All 7 polish items from `current_issues.md` 2026-06-10 (sw click-nav, push button errors/drift, settings input ergonomics, bounded queries + new checkins index, Tasks 0/0, fractional intervals)
- **v1.1** — complete on `feat/v1.1-dump-and-today`, **PR #2 OPEN + mergeable** (8 commits, 246 tests green, per-task spec+quality reviews):
  - Discard with optional answer note (inline input, Enter empty = skip; stored in `discard_note`, shown in History)
  - Task-first Dump quick action (→ Task instant one-off undated) + braindump History (collapsed date rows, status icons, discard notes, "converted (since deleted)")
  - Today two-section split (✅ Tasks / 🌱 Habits tinted mega-sections)
  - Add-button offers tasks/habits only (Dump-a-thought removed per Huy)
  - History clear: ✕ per item + per-day Clear with confirm

## Running locally

http://localhost:3001 — **`tsx watch`** (hot-reloads server code; plain tsx was the root cause of the "✕ doesn't remove" bug — stale process missing the new routes). Postgres :5433. Logins huy/lea, `changeme123`. Frontend changes still need `npm run build -w web` (served from static dist).

## Deployment (Tailscale, option 2 — in progress 2026-06-10 evening)

- **Production container `habits-app-api-1` is RUNNING on host port 3002** (`docker compose up --build -d api`, `restart: unless-stopped`): NODE_ENV=production, shares the dev postgres volume/db (`habits`) so all data is live there. **Secrets are baked into the container env at creation** (JWT_SECRET = random hex, VAPID keypair generated 2026-06-10 via `npx web-push generate-vapid-keys`, subject mailto:h.duong@turbit.de) — they persist across restarts/reboots but are LOST if the container is recreated; on `docker compose up --build` after merges, re-export them in the shell first (or finally create a `.env` next to compose — Huy must do that by hand, agents can't write `.env*`). To read current values: `docker inspect habits-app-api-1 --format '{{json .Config.Env}}'`.
- **Tailscale**: machine moved from work tailnet (turbitduong@) to personal tailnet **huyictigcse@** via profile switch (`tailscale switch` toggles; work profile preserved). Devices on personal tailnet: this machine (100.127.36.43), huys-s24-ultra, iphone171.
- **BLOCKED on one manual click:** Tailscale "serve" isn't enabled on the personal tailnet yet. Huy must open https://login.tailscale.com/f/serve?node=nMjJvnxR6i11CNTRL logged in as huyictigcse@ and enable (earlier 404 was a work/personal account mismatch in the browser). THEN run: `tailscale serve --bg --https=443 http://localhost:3002` → app at `https://huy-tuxedo-infinitybook-pro-gen8-mk1.<tailnet>.ts.net`. Phones: open that URL → Add to Home Screen → enable notifications in Profile.
- Logins still huy/lea `changeme123` — fine for tailnet-only, but should be changed (no in-app password change exists; would need a hash update script or new feature).

## Next actions

1. **Huy: click the serve-enable link above**, then finish serve setup (one command, see above).
2. **Huy: review/merge PR #2** (v1.1), THEN open + review the v1.2 PR (`gh pr create --base master --head feat/v1.2-night` — opened earlier it would drag v1.1 commits into its diff), then refresh the deployed container (`docker compose up --build -d api` with env re-exported).
3. **Morning decision:** one-off task completions don't show in Done History (options a/b in `current_issues.md` 2026-06-11 + QA-REPORT-v1.2.md Known Gap #1).
4. **Change the seeded passwords** — in-app change-password shipped in v1.2; `changeme123` has no excuse left.
5. **Grill session pending:** archived habits are unreachable (no view/unarchive anywhere) — open questions in `new_features.md` 2026-06-10 17:43. Don't implement before grilling.

## Process notes (for fresh sessions)

Workflow: grill-with-docs → record decisions in new_features.md → plan → subagent-per-task with spec+quality reviews → PR. Classifier blocks: master pushes, `.env*` writes, remote-branch deletion, skip-permissions loops. Never mutate as seeded huy/lea (achievement pollution). CONTEXT.md = domain language; v1 plan Rules 1–11 binding for workers. `current_tasks.md` is an obsolete early handoff.
