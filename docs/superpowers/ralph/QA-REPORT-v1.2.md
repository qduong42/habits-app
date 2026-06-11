# QA Report — habits-app v1.2 "night shift" (Task 10)

**Date:** 2026-06-11 · **Branch:** `feat/v1.2-night` (off `feat/v1.1-dump-and-today`) · **Verdict: GREEN, with ONE feature gap for the morning review (see Known Gaps #1).**

Method: full `npm run verify` gates, then end-to-end curl smoke against a private server instance
(`DATABASE_URL=…/habits_smoke PORT=3199 npx tsx server/src/index.ts`) on a **dedicated throwaway
database `habits_smoke`** (created → migrated → seeded → dropped). Rationale: `current_progress.md`
documents that the dev DB `habits` is shared with the production container, so even a throwaway
*user* there would touch live data — a throwaway *database* keeps the smoke fully isolated. The
running containers, the `habits`/`habits_test` databases, and seeded huy/lea/sasi were never touched;
dropping the database removes the throwaway user and all its rows including `user_achievements`.

## What shipped (9 commits, Tasks 1–9)

| Task | Commit | Feature |
|---|---|---|
| 1 | `81c401b` | Done History server module — `GET /api/history` merged checkins+completions |
| 2 | `c0a3c57` | Done History web section at the bottom of Today (lazy, Dump-History-style) |
| 3 | `c03ac7d` | `remindAt`/`remindedAt` on one-off tasks (schema, validation, serializer) |
| 4 | `3d138e1` | Per-minute reminder push scan (`sendDueReminders`, scheduler job) |
| 5 | `ae54126` | Reminder date+time fields in task Edit + 🔔 row badge |
| 6 | `11edd31` | Change password — `POST /api/me/password` + Profile section |
| 7 | `72adbde` | Polish: sw notification click navigates to Today; push button error/retry + dev hint |
| 8 | `4132b59` | Polish: push state resync on Profile mount; settings time input Enter-to-commit |
| 9 | `40427ea` | Polish: bounded nudge/listTasks queries (+ `idx_checkins_user_date`), Tasks 0/0 hidden, fractional interval picker |

## Smoke evidence (throwaway user `smoke_v12_qa` on `habits_smoke`)

### Done History — merged timeline

```
POST /api/habits/…/checkin                          → 200 (xpGained 35)
POST /api/tasks/<recurring intervalHours:24>/complete → 200 (xpGained 5)

GET /api/history
→ 200 {"entries":[
    {"id":"8e1f8d34-…","kind":"completion","name":"Smoke recurring","localDate":"2026-06-11","createdAt":"2026-06-11T01:15:28.086Z"},
    {"id":"30253205-…","kind":"checkin","name":"Smoke habit","localDate":"2026-06-11","createdAt":"2026-06-11T01:14:23.789Z"}]}
GET /api/history?limit=1 → 1 entry (the newest, kind completion)   ✔ cap honored
GET /api/history (no cookie) → 401                                  ✔ auth required
```

⚠️ A completed **one-off** task ("Smoke task", completed via the same flow) did **not** appear in
history — see Known Gaps #1.

### Task Reminders — set → scan → stamped

```
POST /api/tasks {"name":"Smoke reminder task","remindAt":"2026-06-11T01:15:19.000Z"}   (30s in the past)
→ 201 {…"remindAt":"2026-06-11T01:15:19.000Z","remindedAt":null}

POST /api/tasks {"name":"bad","intervalHours":24,"remindAt":…} → 400   ✔ one-off only

(per-minute scan fired at 01:16:00)
GET /api/tasks?all=1 → …"remindAt":"2026-06-11T01:15:19.000Z","remindedAt":"2026-06-11T01:16:00.005Z"   ✔ stamped
```

Server log (no VAPID keys in the smoke env, user has no push subscription — stamped anyway,
exactly the spec §2 "never leave it unstamped" rule):

```
[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — web push disabled. …
[push] reminder for task 337e4862-… skipped — push disabled (no VAPID keys)
```

No re-fire on subsequent minutes (stays stamped; re-fire guard also covered by unit tests).

### Change Password — round-trip

```
POST /api/me/password {"currentPassword":"nope-wrong",…}        → 401 {"error":{"code":"wrong_password","message":"Current password is wrong"}}
POST /api/me/password {…,"newPassword":"short"}                 → 400 (zod min 8)
POST /api/me/password {correct current, 13-char new}            → 200 {"ok":true}
POST /api/auth/login (OLD password)                             → 401   ✔ old hash gone
POST /api/auth/login (NEW password)                             → 200   ✔ round-trip complete
```

## Gates evidence

`npm run verify` (typecheck + tests + build, all workspaces) — green on the final tree:

```
 Test Files  22 passed (22)
      Tests  276 passed (276)
…
dist/assets/index-7AOurrgN.js  375.23 kB │ gzip: 114.29 kB
PWA v1.3.0 / mode injectManifest / precache 9 entries — dist/sw.js generated
```

276 tests vs 246 at the v1.1 PR — +30 covering history (merge order, both kinds, cap, user
isolation), reminders (one-off-only 400, clear-on-edit, stamp-always, re-fire guard, completed
skip), password (wrong-current 401, short-new 400, hash change), and the bounded nudge week-window.

## KNOWN GAPS (for the morning review)

Found during this QA pass:

1. **One-off task completions never appear in Done History.** `completeTask` records one-offs by
   setting `tasks.completed_at` only — no `task_completions` row — and the history view reads only
   `checkins` + `task_completions`. So the timeline shows habit check-ins and *recurring* completions,
   but a done-clicked one-off (90% of dumps become one-off tasks!) is invisible. The contradiction is
   inside `new_features.md` 2026-06-11 00:25 itself: headline says "every done-click", architecture
   says "read view over checkins + task_completions". Not fixed tonight — it needs a (small) design
   call: (a) history additionally scans `tasks WHERE completed_at IS NOT NULL` (read-only, consistent
   with undo since undo clears `completed_at`), or (b) one-off completion also inserts a
   `task_completions` row (write-path change; undo must delete it). (a) looks cheaper and keeps
   approach A's "no new write path" property. Logged in `current_issues.md`.

Accepted/intentional (per spec, unchanged):

2. **History rename/delete semantics**: live join — renames rewrite old entries, deletes cascade
   history away. Documented promotion triggers for the future first-class event table.
3. **Reminders for users without a push subscription are silently consumed** (stamped, no
   notification, no UI hint). Spec §2 decision; same stance as nudges.
4. **Changing the password does not invalidate existing JWTs** (30d expiry). Accepted for the
   tailnet-only deployment; noted in `new_features.md`.
5. **Smoke env had no VAPID keys**, so the reminder *push delivery* itself (vs. scan+stamp) wasn't
   exercised end-to-end here; unit tests cover the send + 410-cleanup path, and the prod container
   has keys baked in. Worth one real-phone reminder after deploy (morning checklist).

## Morning checklist for Huy

1. **Merge order matters:** PR #2 (v1.1, `feat/v1.1-dump-and-today`) is still OPEN; `feat/v1.2-night`
   branches off it. Review/merge **#2 first**, then open the v1.2 PR
   (`gh pr create --base master --head feat/v1.2-night`) — opened against master before #2 merges it
   would drag the v1.1 commits into its diff.
2. **Decide Known Gap #1** (one-off completions in Done History) — option (a) is a one-query addition;
   could be a small follow-up commit on the branch before the PR.
3. **Redeploy** after merge: re-export the baked-in secrets first (read them with
   `docker inspect habits-app-api-1 --format '{{json .Config.Env}}'`), then
   `docker compose up --build -d api` — see `current_progress.md` "Deployment" (or finally hand-write
   the `.env` next to the compose file so this stops being a footgun).
4. **On-phone sanity** (2 min): expand History on Today; set a reminder a few minutes out on a one-off
   task and feel the push arrive (verifies VAPID + sw click-through to Today); change your password
   (`changeme123` should die tonight — that was half the point of the feature).
5. The fractional-interval picker now takes e.g. `0.5` days (min 1h ≈ `0.042`) — try it in Triage.

## QA hygiene

Throwaway database `habits_smoke` (with its only mutated user `smoke_v12_qa`, its habits, tasks,
checkins, completions, and `user_achievements`) was **dropped** after the run — verified only
`habits` and `habits_test` remain. The smoke server (port 3199) was stopped. The running containers,
the dev/prod `habits` DB, and seeded users were never touched.
