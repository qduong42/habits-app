# Habits App — Design Spec

_2026-06-09_

## Problem Statement

Huy reads Substack posts about healthy habits (fitness, mental health, sleep hygiene) but the insights go "in one ear and out the other" — he starts practicing them, then friction kills the follow-through. He wants a mobile-optimized webapp that (a) captures insights at the moment of reading, (b) turns them into trackable habits, and (c) uses gamification ("dopamine tricking") to keep the daily practice going. He also wants the **brain dump** practice covered: dump everything on your mind to decrease mental load, then schedule the items — some become one-off tasks, some recurring tasks, some habits.

## Solution

A mobile-first PWA habit tracker with a **brain dump → triage** flow (dump any thought; triage each item card-by-card into a one-off task, a recurring task, a habit, or let it go), a **daily checklist** of tasks + habits grouped by category, and a gamification layer of **XP + levels, per-habit streaks, and achievements**. Multi-user (Huy + partner/friends) with simple login. One configurable **daily nudge** push notification.

Stack mirrors the validated recurring-task-tracker design: React + Vite + TypeScript PWA frontend, Express + TypeScript backend, Postgres + Drizzle, Docker Compose. Hosting decided later — everything Docker-ready.

## Decisions Made During Brainstorm (with user)

| Question | Decision |
|---|---|
| Users | Me + partner/friends; username+password, JWT in httpOnly cookie |
| Core loop | Daily checklist — open app, tap to check off today's habits |
| Insight capture | Idea inbox → convert to habit (or discard) |
| Gamification | XP + levels, achievements, streaks (all three; no social features in v1) |
| Notifications | One configurable daily nudge ("You have N habits left today") via web push |
| Hosting | Decide later; Docker Compose, deploy-anywhere |
| Today screen | Hybrid mockup approved: thin XP bar header + flat habit rows grouped under light category headers, streak flame on the right of each row |
| Architecture | "Proven stack" — same architecture as the 2026-05-13 task-tracker spec |
| Brain dump flow | Approved via mockup: Inbox tab becomes **Dump**; triage card-by-card → one-off task / recurring task / habit / let go; Today gains a 📌 Tasks section above the habit groups |
| Recurring tasks | **Reset on completion** — `interval_hours` counted from the last completion (the task-tracker model), not fixed calendar; **sub-daily intervals supported** (see ADR-0001) |
| Tasks & XP | Tasks earn XP too: +5 per completion; one shared dopamine economy (habits keep streaks); **+25 day bonus = all habits done, tasks never block it** |
| Task scope | **Personal-only in v1** — shared household tasks deferred to v2 (see ADR-0002) |
| Undated one-offs | Always visible on Today: overdue → due today → undated, in that order |
| Sub-daily UX | Due → reappears in 📌 Tasks ("due 20:00" / "overdue 3h"); complete → hides until next due; **no per-task push in v1**, the daily nudge counts due tasks |

## Users & Auth

- Small known group — no public signup. Users seeded directly in DB (same as task tracker).
- `POST /auth/login` sets JWT in **httpOnly cookie**; "remember me" → `Max-Age: 30 days`, otherwise session cookie.
- All data is **per-user** (habits, inbox, XP, streaks, achievements). No shared/social features in v1.
- Each user has a `timezone` (default `Europe/Berlin`) — "today" and streaks are computed in the user's timezone.

## User Stories

- As a user, I can log in and stay logged in on my phone.
- As a user, I see today's habits grouped by category and tap a circle to check one off (tap again to undo, same day only).
- As a user, I can brain-dump anything on my mind (free text + optional source URL) into the Dump from any screen, with zero friction.
- As a user, I can triage dump items card-by-card: each becomes a one-off task, a recurring task, or a habit — or I let it go. The original text stays attached as the "why".
- As a user, I see a 📌 Tasks section at the top of Today: overdue tasks (red), tasks due today, then undated one-offs; completing one earns +5 XP.
- As a user, I can create a recurring task with an interval (hours or days); after I complete it, it disappears and comes back when the interval has elapsed since that completion — even twice in one day for sub-daily intervals.
- As a user, I can undo a task completion (same local day only) and the XP is taken back.
- As a user, I can create habits directly, too: name, category (preset or custom), frequency (daily, or N times per week), optional notes.
- As a user, I earn XP for every check-in, level up, see per-habit streaks, and unlock achievements.
- As a user, I get one push notification per day at a time I choose, telling me how many habits are still open (skipped if I already finished everything).
- As a user, I can pause (archive) or delete a habit without losing its history.
- As a user, I can see simple stats: current streaks, weekly completion rate, XP/level progress.

## UI (4 tabs, mobile-first)

1. **Today** (approved hybrid mockup + approved brain-dump mockup)
   - Header: date + thin XP progress bar (`Lv 7 — 620/1000 XP`).
   - **📌 Tasks section first** (square check boxes to distinguish from round habit circles): overdue (red `overdue 1d` / `overdue 3h` label) → due today (`due today` / `due 20:00`) → undated one-offs (no label) → today's completed tasks (checked, struck through). Recurring tasks not yet due are hidden. Completing earns a `+5 XP` toast; sub-daily tasks reappear when next due.
   - Habit rows grouped under light colored category headers (`💪 Fitness 1/2`), flat white rows: check circle, name, streak flame (`🔥 12`) on the right.
   - Checking off: instant optimistic UI, `+10 XP` toast; level-up and achievement unlocks get a celebratory modal/confetti.
   - Weekly-frequency habits show `2/3 this week` instead of a daily checkbox state; they appear every day until the weekly target is met, then show as done for the rest of the week.
   - Floating "+" button → quick-capture sheet: "💡 Dump a thought" / "✅ New task" / "🌱 New habit".
2. **Dump** (replaces "Inbox"; DB keeps the table name `inbox_items`)
   - Top: zero-friction capture box — type, hit enter, keep going (optional source URL field).
   - Below: open dump items (text, link-out icon, age) + a `Triage N items →` button.
   - **Triage flow**: one card at a time, four big buttons: ✅ Task — once (then optional due date) / 🔁 Task — recurring (then interval picker: hours or days) / 🌱 Habit (prefilled habit form) / 🗑 Let it go. Tab badge shows open count.
   - Empty state explains the dump→schedule mental-load bridge.
3. **Stats**
   - Per-habit: current streak, best streak, completion % last 4 weeks.
   - Overall: day streak (consecutive days with ≥1 check-in), total check-ins, XP/level.
4. **Profile**
   - Achievements gallery (locked/unlocked), nudge time setting, timezone, logout.

PWA: installable (manifest + service worker), works as a home-screen app. Offline support limited to cached shell — API calls require connectivity (no sync engine in v1).

## Gamification Rules

- **XP**: +10 per habit check-in, **+5 per task completion**. +25 daily bonus when all of today's scheduled **habits** are done (tasks never affect the bonus). The only way XP goes down is the same-local-day undo, which reverses what that check-in/completion gained — past days are immutable.
- **Levels**: flat curve — every 1000 XP is one level (`level = floor(xp_total / 1000) + 1`). Always forward progress.
- **Per-habit streaks**: for daily habits, consecutive days completed (computed in user TZ); for weekly habits, consecutive weeks hitting the target. Breaking a streak just resets the counter — no punishment beyond that.
- **Overall day streak**: consecutive days with at least one check-in (deliberately gentle).
- **Achievements** (fixed catalog seeded in DB, awarded server-side on check-in/convert events):
  - First check-in; 100 / 1000 total check-ins
  - 7-day / 30-day / 100-day habit streak
  - 7-day / 30-day overall day streak
  - Reach level 5 / level 10
  - First triage conversion; 5 / 25 triage conversions ("conversion" = a dump item turned into a habit OR a task)
  - "Balanced day": check-ins in 3+ categories on one day
- Unlocks are returned in the check-in API response so the frontend can celebrate immediately.

## Architecture

### Components

**Frontend — React + Vite + TypeScript (PWA)**
- React Router, 4-tab layout; TanStack Query for data fetching/optimistic updates.
- Service worker: PWA install + receives web push.
- Built static, served by Express in production.

**Backend — Express + TypeScript**
- REST API, JWT in httpOnly cookie, Drizzle ORM over Postgres.
- Gamification engine: pure functions (`computeXp`, `computeStreak`, `checkAchievements`) — unit-testable, no I/O.
- `node-schedule`: one daily job per user at their nudge time; sends web push via `web-push` (VAPID) if open habits remain.
- Catch-up on server start: reschedule all nudge jobs.

**Infrastructure**
- `docker-compose.yml`: `postgres` (named volume) + `api`.
- `.env` for secrets (JWT secret, VAPID keys, DB url).

### Data Model

```
users
  id              uuid PK
  name            text NOT NULL UNIQUE
  password_hash   text NOT NULL
  timezone        text NOT NULL DEFAULT 'Europe/Berlin'
  xp_total        integer NOT NULL DEFAULT 0
  nudge_time      time NULL            -- local time of daily nudge; null = off
  push_subscription jsonb NULL
  created_at      timestamptz NOT NULL DEFAULT now()

categories
  id        uuid PK
  user_id   uuid FK users NULL        -- null = built-in preset (Fitness, Mental Health, Sleep)
  name      text NOT NULL
  emoji     text NOT NULL
  color     text NOT NULL             -- hex, used for headers

habits
  id            uuid PK
  user_id       uuid FK users NOT NULL
  category_id   uuid FK categories NOT NULL
  name          text NOT NULL
  notes         text NULL             -- the "why" / source insight text
  source_url    text NULL             -- carried over from inbox item
  frequency_type  text NOT NULL CHECK IN ('daily','weekly')
  weekly_target   integer NULL        -- required when weekly (1-7)
  archived_at   timestamptz NULL
  created_at    timestamptz NOT NULL DEFAULT now()

checkins
  id          uuid PK
  habit_id    uuid FK habits NOT NULL
  user_id     uuid FK users NOT NULL
  local_date  date NOT NULL           -- "today" in the user's TZ at check-in time
  created_at  timestamptz NOT NULL DEFAULT now()
  UNIQUE (habit_id, local_date)

inbox_items                            -- UI name: "Dump"
  id          uuid PK
  user_id     uuid FK users NOT NULL
  text        text NOT NULL
  source_url  text NULL
  status      text NOT NULL DEFAULT 'open' CHECK IN ('open','converted','discarded')
  habit_id    uuid FK habits NULL     -- set when triaged into a habit
  task_id     uuid FK tasks NULL      -- set when triaged into a task (exactly one of habit_id/task_id when converted)
  created_at  timestamptz NOT NULL DEFAULT now()

tasks
  id              uuid PK
  user_id         uuid FK users NOT NULL
  name            text NOT NULL
  notes           text NULL            -- the "why" / source dump text
  source_url      text NULL
  due_date        date NULL            -- one-off only, optional (user-TZ local date)
  interval_hours  numeric NULL         -- recurring when set (>= 1); NULL = one-off
  next_due        timestamptz NULL     -- recurring only; last completion + interval (creation time + interval initially)
  completed_at    timestamptz NULL     -- one-off terminal completion
  created_at      timestamptz NOT NULL DEFAULT now()

task_completions
  id          uuid PK
  task_id     uuid FK tasks NOT NULL (cascade)
  user_id     uuid FK users NOT NULL
  local_date  date NOT NULL            -- user-TZ day of completion (for undo + XP audit)
  created_at  timestamptz NOT NULL DEFAULT now()
  -- NO unique constraint: sub-daily recurring tasks legitimately complete multiple times per local_date

achievements
  id          text PK                 -- slug, e.g. 'streak-7'
  name        text NOT NULL
  description text NOT NULL
  emoji       text NOT NULL

user_achievements
  user_id        uuid FK users NOT NULL
  achievement_id text FK achievements NOT NULL
  unlocked_at    timestamptz NOT NULL DEFAULT now()
  PRIMARY KEY (user_id, achievement_id)
```

Streaks are **computed from `checkins`**, not stored — avoids drift; cached per-request. `xp_total` is stored (incremented transactionally with each check-in) for cheap reads.

### API Routes

```
POST   /auth/login                 -- set httpOnly cookie (remember-me flag)
POST   /auth/logout
GET    /auth/me

GET    /habits                     -- active habits + today's status + streaks
POST   /habits                     -- create (directly or from inbox item)
PATCH  /habits/:id                 -- edit name/category/frequency/notes
POST   /habits/:id/archive
DELETE /habits/:id

POST   /habits/:id/checkin         -- check off for today; returns {xpGained, newLevel?, unlockedAchievements[]}
DELETE /habits/:id/checkin         -- undo today's check-in (same local_date only)

GET    /tasks                      -- attention-worthy tasks: overdue / due / undated open one-offs / done today
POST   /tasks                      -- create {name, dueDate?} one-off or {name, intervalHours} recurring
PATCH  /tasks/:id                  -- edit name/notes/dueDate/intervalHours
DELETE /tasks/:id
POST   /tasks/:id/complete         -- +5 XP; one-off: terminal; recurring: next_due = now + interval
DELETE /tasks/:id/complete         -- undo most recent completion (same local_date only); reverses XP

GET    /inbox                      -- dump items (UI: "Dump")
POST   /inbox                      -- quick capture {text, sourceUrl?}
POST   /inbox/:id/convert          -- {name, categoryId, frequency...} → creates habit, links item
POST   /inbox/:id/convert-task     -- {name, dueDate?|intervalHours?} → creates task, links item
POST   /inbox/:id/discard

GET    /categories                 -- presets + own
POST   /categories                 -- custom category

GET    /stats                      -- per-habit + overall aggregates
GET    /achievements               -- catalog + unlocked status

PUT    /me/settings                -- nudge_time, timezone
POST   /push/subscribe             -- save web push subscription
```

### Check-in Flow (core transaction)

1. Validate habit belongs to user, not archived, not already checked in for `local_date` (user TZ).
2. Insert `checkins` row; increment `xp_total` by 10 (+25 if this completes all of today's scheduled habits).
3. Recompute streaks for the habit; run achievement checks; insert any new `user_achievements`.
4. Return `{xpGained, xpTotal, newLevel?, streak, unlockedAchievements[]}` — frontend celebrates.

All in one DB transaction so XP/achievements never desync from check-ins.

### Task Completion Flow

1. Validate task belongs to user and is open (one-off: `completed_at IS NULL`; recurring: always completable when visible).
2. One-off: set `completed_at`. Recurring: insert `task_completions` row, set `next_due = now() + interval_hours`.
3. Increment `xp_total` by 5; run achievement checks (level thresholds can be crossed).
4. Return `{xpGained: 5, xpTotal, level, leveledUp, nextDue?, unlockedAchievements[]}`.
5. Undo (same `local_date` only): reverse step 2 (one-off: clear `completed_at`; recurring: delete latest completion, recompute `next_due` from the previous completion or `created_at + interval`), decrement XP by 5.

One transaction, same as check-ins.

### Daily Nudge Flow

1. On server start and on settings change: schedule a daily `node-schedule` job per user at `nudge_time` (user TZ → server cron).
2. Job: count today's unfinished scheduled habits and currently due/overdue tasks; if either > 0 and a push subscription exists, send "🔥 N habits · M tasks left today" via `web-push` (omit a part when zero).
3. Tapping the notification opens the PWA on the Today tab.

## Error Handling

- API: consistent `{error: {code, message}}` envelope; 401 redirects to login on the client.
- Double check-in race: DB unique constraint `(habit_id, local_date)` → 409, client treats as already-done.
- Push failures (expired subscription): catch 410, clear `push_subscription`.
- Optimistic UI rollback on failed check-in.

## Testing

- **Unit (vitest)**: gamification pure functions — XP, level boundaries, daily/weekly streak computation across TZ and DST edges, achievement triggers, weekly-target scheduling logic; task dueness grouping (overdue/today/undated) and next_due reset math incl. sub-daily double-completion.
- **Integration (vitest + supertest, test DB)**: auth flow; check-in transaction (XP increment + achievement award + 409 on double check-in); task complete/undo transaction (XP ±5, recurring reset, same-day undo guard); dump capture → triage (both convert routes).
- **Manual**: PWA install + push notification end-to-end on the phone.

## Out of Scope (v1)

- Social features: shared visibility, leaderboards, accountability partners
- **Shared household tasks** (ADR-0002 — explicit v2)
- **Per-task push notifications at due time** (daily nudge only)
- Streak freezes / repair
- Public signup, password reset, user management UI
- Offline-first sync engine
- Habit reminder times per habit (only the single daily nudge)
- Substack API/RSS integration (capture is manual paste); PWA share-target
- Native app

## Key Implementation Decisions

| Decision | Choice | Reason |
|---|---|---|
| Auth storage | httpOnly cookie JWT | XSS-safe; validated in prior project |
| DB | Postgres (Docker volume) | Proven; Drizzle migrations |
| Streaks | Computed from check-ins | No stored-counter drift |
| XP | Stored `xp_total`, transactional | Cheap reads, consistent with check-ins |
| "Today" | `local_date` in user TZ | Streak correctness for a phone-first app |
| Gamification engine | Pure functions, no I/O | Unit-testable, AFK-friendly TDD |
| Push | web-push + VAPID, single daily job per user | Minimal notification fatigue (user choice) |
