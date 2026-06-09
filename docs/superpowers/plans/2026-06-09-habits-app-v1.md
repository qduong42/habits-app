# Habits App v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mobile-first gamified habit tracker PWA — daily checklist grouped by category, idea inbox, XP/levels/streaks/achievements, daily nudge push — per `docs/superpowers/specs/2026-06-09-habits-app-design.md`.

**Architecture:** npm workspaces monorepo: `server/` (Express + TypeScript + Drizzle + Postgres) and `web/` (React + Vite + TypeScript PWA). Gamification is pure functions in `server/src/game/` (no I/O). Express serves the built frontend in production; Docker Compose runs Postgres (and later the API).

**Tech Stack:** Node 20+, Express 4, Drizzle ORM + pg, bcryptjs, jsonwebtoken, zod, node-schedule, web-push, vitest + supertest; React 18, react-router-dom 6, @tanstack/react-query 5, Vite 5.

---

## Rules for every worker (read before any task)

1. **One task per session.** Pick the FIRST task below (in **document order** — task numbers are labels, not ordering; Tasks 25–27 sit between 16 and 17 on purpose) whose checkboxes are not all ticked. Do only that task.
2. **TDD for server logic**: write the failing test, see it fail, implement, see it pass. Frontend tasks are verified by `npm run verify` + the listed manual checks.
3. Before every commit run `npm run verify` from the repo root (typecheck + tests + build). It must pass.
4. Tick the checkboxes of your task in THIS file (edit `- [ ]` → `- [x]`), commit everything in one commit with the message given in the task, and push with `git push origin feat/habits-app-v1`.
5. Work on branch `feat/habits-app-v1`. NEVER push to `master`/`main`. NEVER force-push.
6. Do not edit the spec. Do not start the next task. Do not refactor other tasks' code (Task 23 does that).
7. If genuinely blocked (missing tool, broken environment), write the reason to `docs/superpowers/ralph/BLOCKED.md` and stop — the loop runner halts on that file.
8. Postgres for dev/tests runs via `docker compose up -d postgres` (Task 0 creates the compose file). Tests use database `habits_test`, dev uses `habits`.

## Shared API contracts (single source of truth — do not drift)

```ts
// Category
{ id: string, name: string, emoji: string, color: string, builtin: boolean }

// Habit (GET /habits item)
{ id: string, name: string, notes: string | null, sourceUrl: string | null,
  category: Category, frequencyType: 'daily' | 'weekly', weeklyTarget: number | null,
  scheduledToday: boolean,    // daily: true; weekly: weekCount < weeklyTarget || doneToday
  doneToday: boolean, weekCount: number, streak: number }

// GET /habits → { today: string /* YYYY-MM-DD in user TZ */, habits: Habit[] }

// POST /habits/:id/checkin →
{ xpGained: number,           // 10, or 35 when this check-in completes all scheduled habits
  xpTotal: number, level: number, leveledUp: boolean,
  habitStreak: number, unlockedAchievements: Achievement[] }

// Achievement
{ id: string, name: string, description: string, emoji: string, unlockedAt: string | null }

// InboxItem (UI name: "Dump item" — the tab is labeled Dump, DB/API keep `inbox`)
{ id: string, text: string, sourceUrl: string | null, status: 'open'|'converted'|'discarded',
  habitId: string | null, taskId: string | null, createdAt: string }

// TaskItem (GET /tasks item) — server-computed grouping; recurring tasks not yet due are EXCLUDED
{ id: string, name: string, notes: string | null, sourceUrl: string | null,
  kind: 'oneoff' | 'recurring',
  group: 'overdue' | 'today' | 'undated' | 'done',   // done = completed this local day
  dueLabel: string | null,   // 'overdue 1d' | 'overdue 3h' | 'due today' | 'due 20:00' | null
  dueDate: string | null, intervalHours: number | null, nextDue: string | null }

// GET /tasks → { tasks: TaskItem[] }  (ordered: overdue, today, undated, done)

// POST /tasks/:id/complete →
{ xpGained: 5, xpTotal: number, level: number, leveledUp: boolean,
  nextDue: string | null, unlockedAchievements: Achievement[] }

// GET /stats →
{ dayStreak: number, totalCheckins: number, xpTotal: number, level: number,
  habits: [{ id: string, name: string, emoji: string, streak: number, bestStreak: number,
             last28: number /* completion % 0-100 */ }] }

// Errors: { error: { code: string, message: string } } — 401 unauthenticated, 404 not found,
// 409 duplicate check-in, 400 validation.
```

Level math: `level = floor(xpTotal / 1000) + 1`; progress to next = `xpTotal % 1000`.

---

## Slice 0 — Walking skeleton: repo, DB, auth, app shell

### Task 0: Scaffold monorepo + Postgres compose

**Files:**
- Create: `package.json`, `server/package.json`, `web/` (vite scaffold), `server/tsconfig.json`, `docker-compose.yml`, `.env.example`, `server/vitest.config.ts`

- [x] **Step 1: Root workspace**

```json
// package.json (root)
{
  "name": "habits-app",
  "private": true,
  "workspaces": ["server", "web"],
  "scripts": {
    "verify": "npm run typecheck -ws --if-present && npm run test -ws --if-present && npm run build -ws --if-present",
    "dev": "npm run dev -w server & npm run dev -w web & wait"
  }
}
```

- [x] **Step 2: Server package**

```json
// server/package.json
{
  "name": "server",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "tsc -p tsconfig.build.json",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:seed": "tsx src/db/seed.ts"
  }
}
```

Install: `npm i -w server express cookie-parser bcryptjs jsonwebtoken zod drizzle-orm pg node-schedule web-push && npm i -w server -D typescript tsx vitest supertest drizzle-kit @types/express @types/cookie-parser @types/bcryptjs @types/jsonwebtoken @types/pg @types/supertest @types/node @types/web-push @types/node-schedule`

`server/tsconfig.json`: `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2022"`, `"strict": true`, `"outDir": "dist"`. `tsconfig.build.json` extends it excluding `test/`.

- [x] **Step 3: Web package** — `npm create vite@latest web -- --template react-ts`, then `npm i -w web react-router-dom @tanstack/react-query`. Add `"typecheck": "tsc --noEmit"` script. Vite dev proxy: `server: { proxy: { '/api': 'http://localhost:3001' } }` in `vite.config.ts`.

- [x] **Step 4: docker-compose + env**

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: habits
      POSTGRES_PASSWORD: habits
      POSTGRES_DB: habits
    ports: ["5433:5432"]
    volumes: [postgres_data:/var/lib/postgresql/data]
volumes:
  postgres_data:
```

`.env.example`: `DATABASE_URL=postgres://habits:habits@localhost:5433/habits`, `JWT_SECRET=change-me`, `PORT=3001`. Copy to `server/.env` (gitignored).

- [x] **Step 5: Verify + commit** — `docker compose up -d postgres`, `npm run verify` passes (no tests yet is OK — vitest needs `passWithNoTests: true` in `server/vitest.config.ts`). Commit: `chore: scaffold monorepo, postgres compose, toolchain`

### Task 1: Drizzle schema (users) + migrate + seed

**Files:**
- Create: `server/src/db/schema.ts`, `server/src/db/client.ts`, `server/src/db/migrate.ts`, `server/src/db/seed.ts`, `server/drizzle.config.ts`
- Test: `server/test/setup.ts` (global setup creating `habits_test` + running migrations)

- [ ] **Step 1: Schema (users only for now)**

```ts
// server/src/db/schema.ts
import { pgTable, uuid, text, integer, timestamp, jsonb, time } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  timezone: text('timezone').notNull().default('Europe/Berlin'),
  xpTotal: integer('xp_total').notNull().default(0),
  nudgeTime: time('nudge_time'),
  pushSubscription: jsonb('push_subscription'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

```ts
// server/src/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
export { pool };
```

`drizzle.config.ts`: dialect postgresql, schema `./src/db/schema.ts`, out `./drizzle`, url from `DATABASE_URL`.

- [ ] **Step 2: Test setup** — `server/test/setup.ts` (vitest `globalSetup`): connect to `postgres` admin db, `CREATE DATABASE habits_test` if missing, then run drizzle `migrate()` against `habits_test`. Point tests at it: in `vitest.config.ts` set `env: { DATABASE_URL: 'postgres://habits:habits@localhost:5433/habits_test', JWT_SECRET: 'test-secret' }`.

- [ ] **Step 3: Migrate + seed** — `migrate.ts` runs drizzle migrator. `seed.ts` upserts users `huy` and `lea` with bcrypt hash of env `SEED_PASSWORD` (default `changeme123`), and is idempotent. Run `npm run db:generate -w server && npm run db:migrate -w server && npm run db:seed -w server`.

- [ ] **Step 4: Smoke test** — `server/test/db.test.ts`: insert+select a user row, expect roundtrip. Run `npm run test -w server`, expect PASS. Commit: `feat(server): drizzle schema, migrations, seed users`

### Task 2: Express app + auth (login/logout/me)

**Files:**
- Create: `server/src/app.ts`, `server/src/index.ts`, `server/src/auth/routes.ts`, `server/src/auth/middleware.ts`, `server/src/errors.ts`
- Test: `server/test/auth.test.ts`

- [ ] **Step 1: Failing tests** — supertest against `createApp()`: `POST /api/auth/login` with bad creds → 401 envelope; good creds → 200 `{id,name}` + httpOnly cookie (Max-Age present only when `rememberMe: true`); `GET /api/auth/me` without cookie → 401, with cookie → 200; `POST /api/auth/logout` clears cookie. Run: `npm run test -w server` → FAIL (modules missing).

- [ ] **Step 2: Implement**

```ts
// server/src/auth/middleware.ts
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthedRequest extends Request { userId: string }

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: { code: 'unauthenticated', message: 'Login required' } });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { sub: string };
    (req as AuthedRequest).userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: { code: 'unauthenticated', message: 'Invalid session' } });
  }
}
```

`auth/routes.ts`: zod-validate `{name, password, rememberMe?}`; bcrypt compare; sign `{sub: user.id}` 30d; `res.cookie('token', t, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV==='production', ...(rememberMe ? { maxAge: 30*24*3600*1000 } : {}) })`. `app.ts` exports `createApp()` wiring `express.json()`, `cookie-parser`, `/api/auth`, `GET /api/healthz → {ok:true}`, central error handler from `errors.ts` (an `HttpError` class with `code`/`status`). `index.ts` calls `createApp().listen(PORT)`.

- [ ] **Step 3: Tests green** — `npm run test -w server` → PASS. Commit: `feat(server): auth with httpOnly JWT cookie`

### Task 3: Web shell — login, tab layout, auth guard

**Files:**
- Create: `web/src/api.ts`, `web/src/auth.tsx`, `web/src/pages/Login.tsx`, `web/src/pages/Today.tsx` (placeholder), `web/src/pages/Inbox.tsx`, `web/src/pages/Stats.tsx`, `web/src/pages/Profile.tsx`, `web/src/Layout.tsx`; rewrite `web/src/App.tsx`, `web/src/index.css`
- Modify: `server/src/app.ts` (serve `web/dist` static + SPA fallback when it exists)

- [ ] **Step 1: API client** — `api.ts`: `apiFetch(path, opts)` → `fetch('/api'+path, { credentials: 'include', headers: {'Content-Type':'application/json'}, ...opts })`; throws `ApiError {code,message,status}` parsed from the error envelope; on 401 set `location.hash = '#/login'`. Use hash routing (`createHashRouter`) so static serving needs no server config.

- [ ] **Step 2: Auth + layout** — `auth.tsx`: React Query `useMe()` (`GET /auth/me`), `<RequireAuth>` redirects to `/login`. `Layout.tsx`: mobile-first column, content area + fixed bottom tab bar with 4 NavLinks (Today ✅ / Dump 🧠 / Stats 📊 / Profile 👤 — yes, the tab is called **Dump**), active tab highlighted purple `#5e35b1`. `index.css`: system font stack, `max-width: 480px` centered shell, light gray `#fafafa` background — matches approved mockup styling.

- [ ] **Step 3: Login page** — name + password inputs, "remember me" checkbox, error message on 401. On success invalidate `me` query and navigate to `/`.

- [ ] **Step 4: Static serving** — in `app.ts`, if `web/dist` exists: `express.static` + non-`/api` fallback to `index.html`.

- [ ] **Step 5: Verify + manual check + commit** — `npm run verify`; `npm run dev`, open `http://localhost:5173`, log in as `huy`, see empty tabs. Commit: `feat(web): app shell with login and tab navigation`

**Slice 0 demo:** log in from a phone-sized viewport, navigate 4 tabs.

---

## Slice 1 — Habits CRUD + Today checklist

### Task 4: Schema: categories, habits, checkins (+ preset seed)

**Files:**
- Modify: `server/src/db/schema.ts`, `server/src/db/seed.ts`
- Test: extend `server/test/db.test.ts`

- [ ] **Step 1: Schema additions**

```ts
export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),       // null = builtin preset
  name: text('name').notNull(),
  emoji: text('emoji').notNull(),
  color: text('color').notNull(),
});

export const habits = pgTable('habits', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  name: text('name').notNull(),
  notes: text('notes'),
  sourceUrl: text('source_url'),
  frequencyType: text('frequency_type', { enum: ['daily', 'weekly'] }).notNull(),
  weeklyTarget: integer('weekly_target'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const checkins = pgTable('checkins', {
  id: uuid('id').primaryKey().defaultRandom(),
  habitId: uuid('habit_id').notNull().references(() => habits.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  localDate: date('local_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('uniq_checkin_per_day').on(t.habitId, t.localDate)]);
```

(import `date`, `unique` from pg-core)

- [ ] **Step 2: Seed presets** — idempotent insert of builtin categories (userId null): 💪 Fitness `#2e7d32`, 🧠 Mental Health `#5e35b1`, 😴 Sleep `#1565c0`. Generate + run migration against dev db; test setup migrates test db automatically.

- [ ] **Step 3: Roundtrip test green, commit** — `feat(server): categories/habits/checkins schema + preset categories`

### Task 5: `localDate` util (TDD)

**Files:**
- Create: `server/src/game/dates.ts`
- Test: `server/test/dates.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { localDateFor, addDays, isoWeekOf } from '../src/game/dates.js';

test('localDateFor converts instant to TZ-local date', () => {
  const at = new Date('2026-06-09T23:30:00Z');
  expect(localDateFor('Europe/Berlin', at)).toBe('2026-06-10'); // UTC+2 in June
  expect(localDateFor('UTC', at)).toBe('2026-06-09');
});
test('addDays handles month boundaries', () => {
  expect(addDays('2026-05-31', 1)).toBe('2026-06-01');
  expect(addDays('2026-06-01', -1)).toBe('2026-05-31');
});
test('isoWeekOf returns ISO year-week', () => {
  expect(isoWeekOf('2026-01-01')).toBe('2026-W01');
  expect(isoWeekOf('2026-06-09')).toBe('2026-W24');
});
```

- [ ] **Step 2: Implement** — `localDateFor` via `Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: undefined, year:'numeric', month:'2-digit', day:'2-digit' })`; `addDays` via `Date.UTC` arithmetic on the Y-M-D parts; `isoWeekOf` via UTC Thursday-of-week algorithm.

- [ ] **Step 3: Green + commit** — `feat(server): timezone-aware date utilities`

### Task 6: Habits routes (list with today status, create, edit, archive, delete)

**Files:**
- Create: `server/src/habits/routes.ts`, `server/src/habits/service.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/habits.test.ts`

- [ ] **Step 1: Failing integration tests** — login helper returns cookie; create habit (daily + weekly w/ target 3); `GET /api/habits` matches the **shared contract** (`scheduledToday`, `doneToday:false`, `weekCount:0`, `streak:0`, `today` = localDate in user TZ); PATCH renames / changes frequency; archive removes it from GET; DELETE removes row; another user's habit → 404; weekly without `weeklyTarget` → 400.

- [ ] **Step 2: Implement** — zod schemas; `service.ts` builds the contract object: one query for active habits + categories, one for today's checkins, one for this-ISO-week checkin counts per habit. `scheduledToday` rule from contract comment. Wire `/api/habits` with `requireAuth`.

- [ ] **Step 3: Green + commit** — `feat(server): habits CRUD with today status`

### Task 7: Check-in / undo endpoints (no XP yet)

**Files:**
- Modify: `server/src/habits/routes.ts`, `server/src/habits/service.ts`
- Test: `server/test/checkins.test.ts`

- [ ] **Step 1: Failing tests** — `POST /api/habits/:id/checkin` → 200, `GET /habits` now `doneToday:true`, `streak:1`; duplicate same day → 409 `{error.code:'already_done'}`; `DELETE .../checkin` undoes today only (404 if nothing today); archived habit check-in → 400; foreign habit → 404. Response shape: full contract with `xpGained: 0` placeholder fields zeroed for now (`xpGained:0, xpTotal:0, level:1, leveledUp:false, unlockedAchievements:[]`, real `habitStreak`).

- [ ] **Step 2: Implement** — insert with unique-violation catch → 409. Streak: fetch habit's checkin dates, compute inline consecutive-days count ending today (full streak logic arrives in Task 11; reuse `addDays`).

- [ ] **Step 3: Green + commit** — `feat(server): habit check-in and undo`

### Task 8: Categories routes

**Files:**
- Create: `server/src/categories/routes.ts`; Modify: `server/src/app.ts`
- Test: `server/test/categories.test.ts`

- [ ] **Step 1: Failing tests** — `GET /api/categories` returns 3 builtins (`builtin:true`) + own customs; `POST /api/categories {name,emoji,color}` creates user-owned; other users don't see it.
- [ ] **Step 2: Implement + green + commit** — `feat(server): categories listing and custom categories`

### Task 9: Today page UI (approved hybrid mockup)

**Files:**
- Create: `web/src/components/HabitRow.tsx`, `web/src/components/XpBar.tsx`, `web/src/components/HabitForm.tsx`, `web/src/hooks/useHabits.ts`
- Modify: `web/src/pages/Today.tsx`, `web/src/index.css`

- [ ] **Step 1: Data hooks** — `useHabits()` (React Query on `/habits`), `useCheckin(habitId)` mutation with optimistic toggle of `doneToday` + rollback, `useCategories()`.

- [ ] **Step 2: Today layout per approved mockup** — header: "Today" + weekday/date right; thin XP bar (gradient `#7c4dff→#448aff`) with `Lv N` / `xp % 1000 / 1000 XP` row beneath (values from check-in responses later; render from `/stats` once Task 17 lands — until then read level/xp from the last check-in response or show `Lv 1, 0/1000`). Habits grouped by category: light colored header row `{emoji} {name} {done}/{scheduled}` in category color, flat white rounded rows under it: tap circle → check (green ✓, strikethrough), streak flame `🔥 N` right-aligned when `streak > 0`. Weekly habits show `{weekCount}/{weeklyTarget} this week` under the name; when target met and not doneToday, row renders in the done style with circle disabled.

- [ ] **Step 3: Create/edit** — floating `+` button (bottom right, above tab bar) → `HabitForm` bottom sheet: name, category select (with inline "new category" option), frequency toggle daily/weekly + target stepper, notes. Long-press or row-menu (simple ⋯ button) → edit / archive / delete with confirm.

- [ ] **Step 4: Verify + manual + commit** — `npm run verify`; manual: create habits in 3 categories, check off, undo, see weekly counter. Commit: `feat(web): Today checklist with grouped categories and habit management`

**Slice 1 demo:** usable daily habit tracker on the phone (sans gamification).

---

## Slice 2 — Gamification engine + celebration UI

### Task 10: XP + levels pure functions (TDD)

**Files:**
- Create: `server/src/game/xp.ts`; Test: `server/test/xp.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { levelFromXp, levelProgress, checkinXp } from '../src/game/xp.js';

test('level math', () => {
  expect(levelFromXp(0)).toBe(1);
  expect(levelFromXp(999)).toBe(1);
  expect(levelFromXp(1000)).toBe(2);
  expect(levelFromXp(6620)).toBe(7);
});
test('progress', () => expect(levelProgress(6620)).toEqual({ into: 620, needed: 1000 }));
test('checkinXp: base 10, +25 bonus when completing the day', () => {
  expect(checkinXp({ completesDay: false })).toBe(10);
  expect(checkinXp({ completesDay: true })).toBe(35);
});
```

- [ ] **Step 2: Implement + green + commit** — `feat(server): xp and level functions`

### Task 11: Streak pure functions (TDD)

**Files:**
- Create: `server/src/game/streaks.ts`; Test: `server/test/streaks.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { dailyStreak, weeklyStreak, dayStreak } from '../src/game/streaks.js';

// dailyStreak(dates: Set<string>, today: string): consecutive days ending today,
// or ending yesterday if today unchecked (today doesn't break it until it's over).
test('dailyStreak', () => {
  const d = new Set(['2026-06-07', '2026-06-08', '2026-06-09']);
  expect(dailyStreak(d, '2026-06-09')).toBe(3);
  expect(dailyStreak(new Set(['2026-06-07', '2026-06-08']), '2026-06-09')).toBe(2); // not broken yet
  expect(dailyStreak(new Set(['2026-06-06']), '2026-06-09')).toBe(0);
  expect(dailyStreak(new Set(), '2026-06-09')).toBe(0);
});
// weeklyStreak(counts: Map<isoWeek, number>, target, currentWeek): consecutive weeks
// meeting target, ending current week (counts if met) or the week before (current pending).
test('weeklyStreak', () => {
  const m = new Map([['2026-W22', 3], ['2026-W23', 4]]);
  expect(weeklyStreak(m, 3, '2026-W24')).toBe(2);          // current week pending, not broken
  expect(weeklyStreak(new Map([['2026-W24', 3]]), 3, '2026-W24')).toBe(1);
  expect(weeklyStreak(new Map([['2026-W22', 2]]), 3, '2026-W24')).toBe(0);
});
// dayStreak: consecutive days with >=1 check-in of any habit (same grace rule as dailyStreak)
test('dayStreak', () => {
  expect(dayStreak(new Set(['2026-06-08', '2026-06-09']), '2026-06-09')).toBe(2);
});
```

- [ ] **Step 2: Implement + green + commit** — `feat(server): streak computation`. (`weeklyStreak` needs `prevIsoWeek(week)` — add it to `dates.ts` with a test: `prevIsoWeek('2026-W01') === '2025-W53'`.)

### Task 12: Achievements catalog + checker (TDD)

**Files:**
- Create: `server/src/game/achievements.ts`; Test: `server/test/achievements.test.ts`
- Modify: `server/src/db/schema.ts` (+`achievements`, `userAchievements` tables), `server/src/db/seed.ts`

- [ ] **Step 1: Schema + seed** — tables per spec; seed the catalog:

```
first-checkin 🎉 / checkins-100 💯 / checkins-1000 🏔
habit-streak-7 🔥 / habit-streak-30 ⚡ / habit-streak-100 🌟
day-streak-7 📅 / day-streak-30 🗓
level-5 🥉 / level-10 🥇
first-conversion 💡 / conversions-5 📚 / conversions-25 🧪
balanced-day ⚖️ (check-ins in 3+ categories on one day)
```

- [ ] **Step 2: Failing tests for pure checker**

```ts
// checkAchievements(ctx) → string[] of newly unlocked ids
// ctx: { totalCheckins, habitStreak, dayStreak, level, conversions,
//        categoriesToday, unlocked: Set<string> }
test('awards thresholds crossed and skips already-unlocked', () => {
  const ids = checkAchievements({ totalCheckins: 1, habitStreak: 1, dayStreak: 1,
    level: 1, conversions: 0, categoriesToday: 1, unlocked: new Set() });
  expect(ids).toEqual(['first-checkin']);
  const ids2 = checkAchievements({ totalCheckins: 100, habitStreak: 7, dayStreak: 7,
    level: 5, conversions: 0, categoriesToday: 3, unlocked: new Set(['first-checkin']) });
  expect(ids2.sort()).toEqual(['balanced-day','checkins-100','day-streak-7','habit-streak-7','level-5']);
});
```

- [ ] **Step 3: Implement (data-driven threshold table) + green + commit** — `feat(server): achievements catalog and checker`

### Task 13: Wire gamification into the check-in transaction

**Files:**
- Modify: `server/src/habits/service.ts` (checkin/undo), `server/src/habits/routes.ts`
- Test: `server/test/checkin-rewards.test.ts`

- [ ] **Step 1: Failing integration tests** — single daily habit: check-in → `{xpGained:35, xpTotal:35, level:1, leveledUp:false, habitStreak:1, unlockedAchievements:[first-checkin]}` (35 because it completes the day); two habits: first check-in gains 10, second 35; undo subtracts what was gained (xp back to previous; if the undo breaks the completed day the bonus goes too — assert via `GET /stats`-less route: re-read user row); set user `xpTotal: 995` directly then check-in → `leveledUp: true, level: 2`; `balanced-day` unlocks on 3rd category same day; achievements never re-awarded.

- [ ] **Step 2: Implement** — all inside one `db.transaction`: insert checkin → compute `completesDay` (all scheduled habits done after this insert) → `checkinXp` → increment `users.xpTotal` → streaks via Task 11 fns → `checkAchievements` (conversions count = inbox converted rows, 0 until Slice 3 — query the table only if it exists… **it does not yet**: hard-code `conversions: 0` with a `// wired in Task 15` note) → insert new `user_achievements` → return contract response. Undo: delete today's checkin, recompute what that check-in had gained (recompute `completesDay` before/after) and decrement; achievements stay (one-way, per spec "past days immutable" applies to XP only — achievements are never revoked).

- [ ] **Step 3: Green + commit** — `feat(server): check-in awards xp, streaks, achievements transactionally`

### Task 14: Celebration UI + achievements gallery

**Files:**
- Create: `web/src/components/Celebration.tsx`, `web/src/components/Toast.tsx`
- Modify: `web/src/pages/Today.tsx`, `web/src/pages/Profile.tsx`, `web/src/hooks/useHabits.ts`, `web/src/api.ts`

- [ ] **Step 1: Wire responses** — `useCheckin` returns the rewards payload; keep latest `xpTotal`/`level` in a small context (`GameContext`) feeding `XpBar`; streak flame updates from response.

- [ ] **Step 2: Feedback** — `+10 XP` / `+35 XP` toast near the tapped row; `Celebration` modal (CSS-only confetti burst, no library) when `leveledUp` or `unlockedAchievements.length > 0`, listing badge emoji + name; auto-dismiss 2.5s or tap.

- [ ] **Step 3: Profile gallery** — `GET /api/achievements` (add tiny route returning catalog LEFT JOIN user unlocks → contract shape) — grid of badges, locked ones grayed with 🔒 and description.

- [ ] **Step 4: Verify + manual + commit** — `feat(web): xp bar, celebration modals, achievements gallery`

**Slice 2 demo:** checking off habits feels like a game — XP pops, levels, badges.

---

## Slice 3 — Idea inbox

### Task 15: Inbox schema + routes (TDD)

**Files:**
- Modify: `server/src/db/schema.ts` (inbox_items per spec), `server/src/habits/service.ts` (real `conversions` count in achievement ctx)
- Create: `server/src/inbox/routes.ts`; Modify: `server/src/app.ts`
- Test: `server/test/inbox.test.ts`

- [ ] **Step 1: Failing tests** — capture `{text, sourceUrl?}` → open item; list newest-first (only own, only non-discarded by default, `?all=1` for everything); convert `{name, categoryId, frequencyType, weeklyTarget?, notes?}` → creates habit carrying `notes` (default = item text) + `sourceUrl`, item → `status:'converted', habitId`; converting twice → 409; discard → `status:'discarded'`; `first-conversion` achievement awarded on convert (response includes `unlockedAchievements`).

- [ ] **Step 2: Implement + green + commit** — `feat(server): idea inbox with convert-to-habit`

### Task 16: Dump tab UI + quick capture

**Files:**
- Modify: `web/src/pages/Inbox.tsx` (the tab labeled "Dump"), `web/src/pages/Today.tsx`, `web/src/components/HabitForm.tsx`
- Create: `web/src/components/CaptureSheet.tsx`

- [ ] **Step 1: Capture everywhere** — top of the Dump tab: zero-friction capture box (type → enter → posts `POST /inbox` → input clears, keep typing; optional collapsed URL field). The floating `+` on Today opens a sheet with "💡 Dump a thought" (same capture → `POST /inbox`) / "➕ New habit" (existing form). Dump tab badge shows open count in the tab bar.

- [ ] **Step 2: Dump list** — open items with text, link-out icon when sourceUrl, age ("3d"); per item: **→ Habit** (opens `HabitForm` prefilled, on success shows the achievement celebration if any) and **Discard**. (Card-by-card triage incl. task outcomes lands in Task 27.) Empty state: "Mind full? Dump it here — then schedule it."

- [ ] **Step 3: Verify + manual + commit** — `feat(web): dump tab with quick capture and convert-to-habit`

**Slice 3 demo:** paste a Substack takeaway → it becomes a tracked habit.

---

## Slice 3b — Tasks & triage (brain-dump outcomes; numbered 25–27, executed in document order)

### Task 25: Tasks schema + routes (TDD)

**Files:**
- Modify: `server/src/db/schema.ts` (+`tasks`, `taskCompletions` tables; +`taskId` column on `inboxItems`), `server/src/app.ts`
- Create: `server/src/tasks/routes.ts`, `server/src/tasks/service.ts`, `server/src/game/dueness.ts`
- Test: `server/test/dueness.test.ts`, `server/test/tasks.test.ts`

- [ ] **Step 1: Schema** — per spec: `tasks` (`dueDate date` nullable, `intervalHours numeric` nullable — set = recurring, `nextDue timestamptz` nullable, `completedAt timestamptz` nullable) and `task_completions` (`taskId` cascade FK, `userId`, `localDate date`, `createdAt`; **no unique constraint** — sub-daily tasks complete multiple times per day). Add `taskId uuid` nullable FK on `inbox_items`. Generate + run migration.

- [ ] **Step 2: Failing unit tests for dueness (pure fn)**

```ts
import { taskGroup, dueLabel } from '../src/game/dueness.js';
// taskGroup(task, now, today, tz) → 'overdue'|'today'|'undated'|'done'|'hidden'
test('one-off grouping', () => {
  const base = { kind: 'oneoff', completedAt: null, dueDate: null };
  expect(taskGroup({ ...base, dueDate: '2026-06-09' }, new Date('2026-06-10T08:00:00Z'), '2026-06-10')).toBe('overdue');
  expect(taskGroup({ ...base, dueDate: '2026-06-10' }, new Date('2026-06-10T08:00:00Z'), '2026-06-10')).toBe('today');
  expect(taskGroup(base, new Date('2026-06-10T08:00:00Z'), '2026-06-10')).toBe('undated');
});
test('recurring grouping incl. sub-daily reappearance', () => {
  const rec = { kind: 'recurring', intervalHours: 12 };
  expect(taskGroup({ ...rec, nextDue: '2026-06-10T06:00:00Z' }, new Date('2026-06-10T08:00:00Z'), '2026-06-10')).toBe('today');
  expect(taskGroup({ ...rec, nextDue: '2026-06-09T06:00:00Z' }, new Date('2026-06-10T08:00:00Z'), '2026-06-10')).toBe('overdue'); // >24h late
  expect(taskGroup({ ...rec, nextDue: '2026-06-10T20:00:00Z' }, new Date('2026-06-10T08:00:00Z'), '2026-06-10')).toBe('hidden');
});
test('dueLabel', () => {
  expect(dueLabel('overdue', { nextDue: '2026-06-10T05:00:00Z' }, new Date('2026-06-10T08:00:00Z'), 'UTC')).toBe('overdue 3h');
  expect(dueLabel('today', { nextDue: '2026-06-10T20:00:00Z' }, new Date('2026-06-10T08:00:00Z'), 'UTC')).toBe('due 20:00');
  expect(dueLabel('today', { dueDate: '2026-06-10' }, new Date('2026-06-10T08:00:00Z'), 'UTC')).toBe('due today');
});
```

Definitions: recurring `overdue` = `nextDue <= now` for one-offs `dueDate < today`; recurring with `now - nextDue < 24h` whose nextDue is the current local day = `today` group, otherwise `overdue` with day/hour label; `done` = one-off completed on `today` OR recurring whose latest completion has `localDate === today` AND not yet due again; `hidden` = recurring not yet due (excluded from API response).

- [ ] **Step 3: Failing integration tests** — create one-off (with/without dueDate) and recurring (`intervalHours: 120`); `GET /tasks` matches contract incl. ordering (overdue → today → undated → done) and excludes hidden recurring; `POST /tasks/:id/complete` one-off → `{xpGained: 5}`, user xp +5, task in `done` group; complete again → 409; recurring complete → `nextDue ≈ now + 120h`, completing a 12h task twice in one day works and earns 10 XP total; `DELETE /tasks/:id/complete` same-day undo restores prior state and xp; undo with no completion today → 404; foreign task → 404; `POST /tasks` validation: `dueDate` AND `intervalHours` together → 400, `intervalHours < 1` → 400; achievements come back through the same `checkAchievements` path (level-up by task XP works).

- [ ] **Step 4: Implement** — `dueness.ts` pure; `service.ts` complete/undo in one `db.transaction` mirroring the check-in transaction (reuse the achievement-context builder from `habits/service.ts` — extract a shared `game/rewards.ts` helper if that avoids duplication); wire `/api/tasks`.

- [ ] **Step 5: Green + commit** — `feat(server): one-off and recurring tasks with reset-on-completion`

### Task 26: Today 📌 Tasks section + task create/edit UI

**Files:**
- Create: `web/src/components/TaskRow.tsx`, `web/src/components/TaskForm.tsx`, `web/src/hooks/useTasks.ts`
- Modify: `web/src/pages/Today.tsx`, `web/src/components/CaptureSheet.tsx`

- [ ] **Step 1: Tasks section** — pinned ABOVE habit categories, header `📌 Tasks {done}/{visible}` in `#bf360c`; rows like habit rows but **square** check boxes; right-aligned `dueLabel` (red `#c62828` for overdue, orange `#e65100` for today); done-today tasks struck through at the bottom of the section; section hidden entirely when no tasks. Optimistic complete/undo via `useTasks()` + `useCompleteTask()` (rewards payload feeds the same XP toast/celebration path as check-ins).

- [ ] **Step 2: Create/edit** — `TaskForm` bottom sheet: name, mode toggle "once / recurring"; once → optional due date picker; recurring → interval picker (number + unit hours/days, stored as hours, min 1h); notes. Add "✅ New task" to the CaptureSheet on Today. Row ⋯ menu → edit / delete with confirm.

- [ ] **Step 3: Verify + manual + commit** — manual: water-plants 120h task, 12h task completing twice. Commit: `feat(web): tasks section on Today with create/edit`

### Task 27: Triage flow (card-by-card) + convert-task

**Files:**
- Modify: `server/src/inbox/routes.ts` (+`POST /inbox/:id/convert-task`), `server/test/inbox.test.ts`
- Create: `web/src/components/TriageCard.tsx`; Modify: `web/src/pages/Inbox.tsx`

- [ ] **Step 1: TDD convert-task** — failing tests: convert-task with `{name, dueDate?}` or `{name, intervalHours}` → creates task carrying notes (default item text) + sourceUrl, item → `status:'converted', taskId`; converting an already-converted item → 409; conversions achievement count includes BOTH habit and task conversions (assert `first-conversion` unlocks via convert-task). Implement, green.

- [ ] **Step 2: Triage UI** — `Triage N items →` button on Dump tab opens card-by-card mode (one item per screen, progress `2 / 5`): four big buttons per the approved mockup — ✅ Task once (inline optional date → convert-task) / 🔁 Task recurring (inline interval picker → convert-task) / 🌱 Habit (prefilled `HabitForm` → convert) / 🗑 Let it go (discard). Advances to next item; final card → "Mind clear 🧘" + back to Dump. Per-item **→ Habit / Discard** buttons from Task 16 remain as shortcuts.

- [ ] **Step 3: Verify + manual + commit** — `feat: card-by-card triage with task conversion`

**Slice 3b demo:** dump 5 thoughts → triage into a dated task, a 12h recurring task, a habit, and a discard → Today shows the 📌 section.

---

## Slice 4 — Stats, settings, PWA, daily nudge

### Task 17: Stats endpoint (TDD)

**Files:**
- Create: `server/src/stats/routes.ts`; Modify: `server/src/app.ts`
- Test: `server/test/stats.test.ts`

- [ ] **Step 1: Failing tests** — seed habits + checkins across days, assert full `GET /stats` contract: `dayStreak`, `totalCheckins`, `xpTotal`, `level`, per-habit `streak`, `bestStreak` (longest run anywhere in history — add `bestDailyStreak(dates)` to `streaks.ts` with unit test), `last28` percentage (daily: days done /28; weekly: weeks target-met /4, as %).
- [ ] **Step 2: Implement + green + commit** — `feat(server): stats endpoint`

### Task 18: Stats UI

**Files:** Modify: `web/src/pages/Stats.tsx`

- [ ] **Step 1: Implement** — top cards: 🔥 day streak, total check-ins, Lv + XP bar; per-habit list: name, current/best streak, thin 28-day completion bar. Verify + commit: `feat(web): stats page`

### Task 19: Settings (nudge time, timezone)

**Files:**
- Create: `server/src/settings/routes.ts`; Modify: `server/src/app.ts`, `web/src/pages/Profile.tsx`
- Test: `server/test/settings.test.ts`

- [ ] **Step 1: TDD** — `PUT /api/me/settings {nudgeTime: '21:30' | null, timezone: 'Europe/Berlin'}` zod-validated (HH:MM regex, `Intl.supportedValuesOf('timeZone')` check), persists, `GET /auth/me` returns them.
- [ ] **Step 2: Profile UI** — time input + on/off switch, timezone select (default Europe/Berlin), logout button. Verify + commit: `feat: nudge and timezone settings`

### Task 20: PWA (manifest + service worker)

**Files:** Modify: `web/vite.config.ts`, `web/index.html`; Create: `web/public/icons/*` (generate simple 🔥-on-purple SVG → 192/512 PNG via a tiny node script or hand-made SVG icons — `vite-plugin-pwa` accepts SVG)

- [ ] **Step 1: Implement** — `npm i -w web -D vite-plugin-pwa`; `VitePWA({ registerType: 'autoUpdate', manifest: { name: 'Habits', short_name: 'Habits', display: 'standalone', theme_color: '#5e35b1', background_color: '#fafafa', icons } })`; cache app shell only (default workbox config — API stays network-only via `navigateFallbackDenylist: [/^\/api/]`).
- [ ] **Step 2: Verify build emits `manifest.webmanifest` + `sw.js`; commit** — `feat(web): installable PWA`

### Task 21: Web push + daily nudge job

**Files:**
- Create: `server/src/push/routes.ts`, `server/src/push/nudge.ts`; Modify: `server/src/app.ts`, `server/src/index.ts`, `.env.example` (VAPID keys), `web/src/pages/Profile.tsx` (+ enable-notifications button), `web/src/sw-push.ts` (push event → showNotification, click → open `/`)
- Test: `server/test/nudge.test.ts`

- [ ] **Step 1: TDD nudge logic** — `openHabitsCount(userId, today)` (scheduled-but-not-done count) and `dueTasksCount(userId, now)` (overdue + today groups via `dueness.ts`) tested via seeded data; `sendNudge(user)` with injected `webpush` fake: sends `{title: '🔥 2 habits · 1 task left today'}` (omit a zero part; singular/plural correct) only when total>0 and subscription exists; on 410 clears `push_subscription`.
- [ ] **Step 2: Scheduler** — `scheduleAllNudges()` on boot + reschedule on settings change: `node-schedule` cron at user's `nudgeTime` interpreted in user TZ (use `{ rule, tz }` recurrence). Generate VAPID via `npx web-push generate-vapid-keys`, document in `.env.example`; `GET /api/push/vapid-public-key` route; frontend: `pushManager.subscribe` → `POST /push/subscribe`.
- [ ] **Step 3: Green + verify + commit** — `feat: daily nudge web push`

### Task 22: Production compose + README

**Files:** Create: `server/Dockerfile`, `README.md`; Modify: `docker-compose.yml` (api service: build server, run migrations then start, serve web/dist; depends_on postgres)

- [ ] **Step 1: Implement** — multi-stage Dockerfile (build web + server, copy `web/dist`); compose `api` service with env vars, `npm run db:migrate && node dist/index.js` entry. README: what it is, dev setup, seed users, deploy notes (HTTPS required for PWA/push), screenshot placeholder strictly excluded — describe instead.
- [ ] **Step 2: `docker compose up --build` smoke test (healthz + login via curl), commit** — `chore: production docker compose and README`

---

## Slice 5 — Refactor + QA pass

### Task 23: Dedicated refactor pass

- [ ] **Step 1:** Re-read all of `server/src` and `web/src`: collapse duplication (esp. habit status computation used by routes/stats/nudge, and the rewards transaction shared by check-ins and task completions — each should live once in `service.ts`/`game/`), dead code, naming drift vs the contracts section and CONTEXT.md language (Dump/Triage/Check-in/Completion). No behavior changes; `npm run verify` green before and after. Commit: `refactor: consolidate habit status logic, naming cleanup`

### Task 24: QA report

- [ ] **Step 1:** Run full suite + build; exercise main flows with curl against a dev server (login → create habit → checkin → rewards → dump capture → triage to habit AND to recurring task → complete task incl. sub-daily double-complete → undo → stats). Write `docs/superpowers/ralph/QA-REPORT.md`: what works, response samples, any gaps for the morning review. Commit: `docs: overnight QA report`
