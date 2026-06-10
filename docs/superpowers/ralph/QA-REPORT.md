# QA Report — habits-app v1 (Task 24)

**Date:** 2026-06-10 · **Branch:** `feat/habits-app-v1` · **Verdict: GREEN — ready for morning review.**

Method: full gates from a clean tree, then end-to-end curl smoke against a private server instance
(`DATABASE_URL=…/habits_test SERVE_STATIC=1 PORT=3101 npx tsx server/src/index.ts`) using a **throwaway
DB user `qa_smoke_t24`** (per the achievement-pollution guard in `current_issues.md` — the dev server
on :3001 and seeded `huy`/`lea` were never touched). All test rows including `user_achievements` were
deleted afterwards in FK order; achievement *catalog* rows are shared fixtures and stay.

## Status summary — what works

- **Auth**: login sets httpOnly cookie (30d JWT, `rememberMe` → maxAge), `GET /auth/me` returns
  `{id, name, timezone, nudgeTime}`, logout clears the cookie and subsequent requests get
  `401 unauthenticated`. Wrong-password and unknown-name both return 401 `invalid_credentials`
  (timing-equalized with a dummy bcrypt compare).
- **Categories + Habits**: custom category creation, habit CRUD against it; contract shape exactly as
  the plan's "Shared API contracts" (nested `category`, `scheduledToday`, `doneToday`, `weekCount`,
  `streak`). Cross-field validation enforced (weekly requires `weeklyTarget`, daily rejects it).
- **Check-in rewards engine**: +10 base, **35 when the check-in completes all scheduled habits**
  (observed: single scheduled habit → `xpGained: 35`), level math `floor(xp/1000)+1`, achievement
  unlocks ride the response (`first-checkin` 🎉 unlocked on first check-in). Duplicate check-in →
  `409 already_done`. Undo refunds exactly what was gained (`xpLost: 35`) and the habit is
  re-checkinable; unlocked achievements persist through undo (by design — never revoked).
- **Dump (inbox)**: capture with optional `sourceUrl`; triage → **habit** (`/convert`, sourceUrl
  carried over from the item, item linked via `habitId`, `first-conversion` 💡 unlocked) and →
  **recurring task** (`/convert-task` with `intervalHours: 12`, sub-daily accepted, `nextDue = now+12h`,
  group `scheduled`). Re-triaging a converted item → `409 already_triaged`.
- **Tasks**: recurring sub-daily task completed **twice the same day, +5 XP each** (reset-on-completion
  per ADR-0001 — `nextDue` re-anchors to each completion). Undo refunds 5 XP and restores the previous
  `nextDue` (verified: reverted from `…37.384Z` to `…37.361Z`). One-off with `dueDate` lands in group
  `today` with `dueLabel: "due today"`. `dueDate`+`intervalHours` together → 400 with the
  mutual-exclusion message. `GET /tasks` orders overdue → today → undated → done;
  `?all=1` appends `scheduled`.
- **Stats**: `{dayStreak, totalCheckins, xpTotal, level, habits[]}` with per-habit
  `streak/bestStreak/last28` (1 check-in in 28 days → `last28: 4` i.e. rounded %).
- **Achievements**: full 14-slug catalog in catalog order, `unlockedAt` null when locked.
- **Settings**: `PUT /api/me/settings` partial update, `HH:MM` normalization (pg `time` →
  API `HH:MM`), bad time string → 400, nudge job rescheduled on change.
- **Push**: without VAPID env the server boots fine, logs a warning, and
  `GET /api/push/vapid-public-key` → `503 push_disabled` (graceful degradation as specced).
- **Static serving / SPA fallback**: with `SERVE_STATIC=1`, `/` serves the built `web/dist` index
  (HTTP 200); `/api/*` always gets the JSON 404 catch-all, never index.html.
- **Error envelope** is uniform everywhere: `{error: {code, message}}` — verified for
  400 `validation`, 401 `unauthenticated`/`invalid_credentials`, 404 `not_found`,
  409 `already_done`/`already_triaged`, 503 `push_disabled`.

## Response samples (trimmed)

### Login → me → logout

```
POST /api/auth/login {"name":"qa_smoke_t24","password":"…"}
→ 200 {"id":"ed02305d-…","name":"qa_smoke_t24"}                       (+ Set-Cookie: token=…; HttpOnly)

GET /api/auth/me
→ 200 {"id":"ed02305d-…","name":"qa_smoke_t24","timezone":"Europe/Berlin","nudgeTime":null}

POST /api/auth/logout → 200 {"ok":true}
GET /api/habits (after logout) → 401 {"error":{"code":"unauthenticated","message":"Login required"}}
```

### Category + habit + check-in cycle

```
POST /api/categories {"name":"QA Lab","emoji":"🧪","color":"#aa3366"}
→ 201 {"id":"26dd9076-…","name":"QA Lab","emoji":"🧪","color":"#aa3366","builtin":false}

POST /api/habits {"name":"QA stretch","categoryId":"26dd9076-…","frequencyType":"daily","notes":"smoke"}
→ 201 {"id":"7c98359d-…","name":"QA stretch", …,
       "category":{…"QA Lab"…}, "frequencyType":"daily","weeklyTarget":null,
       "scheduledToday":true,"doneToday":false,"weekCount":0,"streak":0}

POST /api/habits/7c98359d-…/checkin
→ 200 {"xpGained":35,"xpTotal":35,"level":1,"leveledUp":false,"habitStreak":1,
       "unlockedAchievements":[{"id":"first-checkin","name":"First Step",…,"emoji":"🎉",
                                "unlockedAt":"2026-06-10T12:33:01.048Z"}]}

POST …/checkin (again)   → 409 {"error":{"code":"already_done","message":"Habit already checked in today"}}
DELETE …/checkin (undo)  → 200 {"ok":true,"xpLost":35,"xpTotal":0,"level":1}
POST /api/habits/<random-uuid>/checkin → 404 {"error":{"code":"not_found","message":"Habit not found"}}
POST /api/habits (weekly, no weeklyTarget)
→ 400 {"error":{"code":"validation","message":"weeklyTarget: required for weekly habits"}}
```

### Dump capture → triage (habit AND recurring task)

```
POST /api/inbox {"text":"try 10min meditation","sourceUrl":"https://example.com/med"}
→ 201 {"id":"617ee821-…","text":"try 10min meditation","sourceUrl":"https://example.com/med",
       "status":"open","habitId":null,"taskId":null,"createdAt":"2026-06-10T12:33:22.201Z"}

POST /api/inbox/617ee821-…/convert {"name":"Meditate 10min","categoryId":"26dd9076-…",
                                    "frequencyType":"weekly","weeklyTarget":3}
→ 200 {"item":{…"status":"converted","habitId":"db8c2596-…"…},
       "habit":{…"sourceUrl":"https://example.com/med" (carried over)…,"weeklyTarget":3…},
       "unlockedAchievements":[{"id":"first-conversion","name":"Bright Idea","emoji":"💡",…}]}

POST /api/inbox/96257ee4-…/convert-task {"name":"Water the plants","intervalHours":12}
→ 200 {"item":{…"status":"converted","taskId":"6ea26b37-…"…},
       "task":{…"kind":"recurring","group":"scheduled","dueLabel":"due Jun 11",
               "intervalHours":12,"nextDue":"2026-06-11T00:33:22.304Z"},
       "unlockedAchievements":[]}

POST …/convert-task (same item again)
→ 409 {"error":{"code":"already_triaged","message":"Inbox item was already converted or discarded"}}
```

### Tasks: sub-daily double-complete, undo, one-off, ordering

```
POST /api/tasks/6ea26b37-…/complete
→ 200 {"xpGained":5,"xpTotal":40,"level":1,"leveledUp":false,"nextDue":"2026-06-11T00:33:37.364Z",…}
POST …/complete (same local day — sub-daily interval, allowed)
→ 200 {"xpGained":5,"xpTotal":45,…,"nextDue":"2026-06-11T00:33:37.384Z",…}
DELETE …/complete (undo latest)
→ 200 {"ok":true,"xpLost":5,"xpTotal":40,"level":1}        // nextDue reverted to …37.361Z ✔

POST /api/tasks {"name":"Renew car registration","dueDate":"2026-06-10","notes":"QA one-off"}
→ 201 {…"kind":"oneoff","group":"today","dueLabel":"due today","dueDate":"2026-06-10",…}

POST /api/tasks {"name":"bad","dueDate":"2026-06-12","intervalHours":24}
→ 400 {"error":{"code":"validation","message":"dueDate: dueDate and intervalHours are mutually exclusive"}}

GET /api/tasks
→ 200 {"tasks":[ {…"Renew car registration","group":"today"…},
                 {…"Water the plants","group":"done" (completed today, nextDue tomorrow)…} ]}
GET /api/tasks?all=1 → same + any 'scheduled' tasks appended last
```

### Stats, achievements, settings, push

```
GET /api/stats
→ 200 {"dayStreak":1,"totalCheckins":1,"xpTotal":40,"level":1,
       "habits":[{"id":"7c98359d-…","name":"QA stretch","emoji":"🧪","streak":1,"bestStreak":1,"last28":4},
                 {"id":"db8c2596-…","name":"Meditate 10min","emoji":"🧪","streak":0,"bestStreak":0,"last28":0}]}

GET /api/achievements → 200, 14 entries in catalog order; unlocked here: first-checkin, first-conversion
  [0] {"id":"first-checkin","name":"First Step",…,"unlockedAt":"2026-06-10T12:33:01.048Z"}

PUT /api/me/settings {"nudgeTime":"20:30"} → 200 {"ok":true,"nudgeTime":"20:30","timezone":"Europe/Berlin"}
PUT /api/me/settings {"nudgeTime":"25:99"} → 400 {"error":{"code":"validation","message":"nudgeTime: expected HH:MM (24h)"}}

GET /api/push/vapid-public-key (no VAPID env)
→ 503 {"error":{"code":"push_disabled","message":"Push notifications are not configured"}}
GET /api/nope → 404 {"error":{"code":"not_found","message":"Not found"}}   (JSON catch-all, not index.html)
```

Server boot log with no VAPID keys (graceful):

```
server listening on http://localhost:3101
[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — web push disabled. Generate keys with `npx web-push generate-vapid-keys`.
```

## Gates evidence

`npm run verify` (typecheck + tests + build, all workspaces) — run before the smoke AND re-run after
cleanup on the final tree; both green:

```
 Test Files  18 passed (18)
      Tests  234 passed (234)
…
dist/index.html                                    0.64 kB │ gzip:   0.36 kB
dist/assets/index-A6tJpD6J.js                    366.14 kB │ gzip: 112.35 kB
PWA v1.3.0
mode      injectManifest
precache  9 entries (381.28 KiB)
files generated
  dist/sw.js
```

`npm run lint -w web` — eslint, zero findings (exit 0).

## KNOWN GAPS (for the morning review)

Accepted/intentional (decided during Tasks 22–23, see also `current_issues.md`):

1. **Blur-save edge on Settings nudge time**: an edited time is only persisted on blur; closing the
   tab or hash-navigating (popstate) without blurring loses the edit. Accepted by design in Task 23
   (trade-off vs. the old save-per-keystroke behavior that fired mid-typing).
2. **Row "⋯" menus gained Escape-to-close and a focus trap** in the Task 23 refactor — an intentional
   a11y improvement; behavior differs (better) from the pre-refactor menus.
3. **Login body field is `name`, not `username`** — `{"username": …}` gets
   400 `validation: "name: Invalid input: expected string, received undefined"`. Any external client
   or tester must send `{name, password, rememberMe?}`.
4. **Push prerequisites**: web push needs VAPID keys in env (else 503 `push_disabled`, verified above)
   **and** HTTPS (or localhost) for the browser side; the service worker is only generated/registered
   in a **production build** (`vite build`) — dev-server sessions can't enable push.
5. **Manual phone-viewport check of the Today rows is still outstanding** — desktop-browser and curl
   coverage only; nobody has eyeballed the row layout on an actual narrow viewport yet.

Queued work (tracked, not regressions):

6. Minor polish backlog in `current_issues.md` (notification click doesn't navigate to Today;
   push-button error/drift edge cases; "📌 Tasks 0/0" when only scheduled tasks exist;
   triage interval picker integer-only while the server accepts fractional ≥1h).
7. Grilled-but-unbuilt features in `new_features.md`: Today two-section split (✅ Tasks / 🌱 Habits)
   with "→ Task" as the first Dump quick action; braindump History grouped by dump date;
   discard-with-note (`discard_note` column). All have resolved decisions, ready for writing-plans.

Found during this QA pass (new observations, low severity):

8. **Converted items copy the dump text into `notes`** (`convert-task` set the task's notes to the
   raw item text "water the plants", duplicating the name). Harmless, arguably useful provenance,
   but the morning reviewer may want triage to leave `notes` empty when it equals the name.
9. **Stats `habits[].emoji` is the category emoji, not per-habit** — both habits in one category show
   the same 🧪. Matches the data model (habits have no own emoji); just don't read it as habit identity.
10. **An undone-then-redone day still reads naturally** (re-check-in after undo grants full reward
    again, achievements stay unlocked) — verified working; noted only because the asymmetry
    (XP refunded, achievements kept) can surprise testers. By design.

## QA hygiene

Throwaway user `qa_smoke_t24` (id `ed02305d-…`) and every row it created were deleted from
`habits_test` after the run, in FK order: `user_achievements` → `checkins` → `task_completions` →
`tasks` → `habits` → `inbox_items` → custom `categories` → `users` row. Verified 0 rows remaining.
The QA server (port 3101) was stopped. Dev server on :3001 and the dev DB were not touched.
