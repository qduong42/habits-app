# New Features (grilled; shipped status noted per entry)

Decisions resolved via grill-with-docs sessions; domain language in `CONTEXT.md`. Append new entries with date/time.

## 2026-06-10 10:21 — Today: two-section split (Tasks vs Habits)

From live usage: the Task/Habit distinction is too subtle, and the Dump's quick actions are habit-centric while ~90% of dumps should become tasks.

**Decisions (grilled):**
- One Today screen, but **two clearly distinct mega-sections**: "✅ Tasks" and "🌱 Habits" with distinct backgrounds/headers. Habit category sub-groups stay inside the Habits section. No fifth tab.
- **Recurring tasks stay in ✅ Tasks.** The boundary is **chores-vs-practices**, not repeating-vs-once (CONTEXT.md updated 2026-06-10): tasks = things the world needs done (once or cyclically, no streaks); habits = practices you build (streaks, XP identity).
- Dump list quick actions: add **→ Task as the FIRST action** per item (then → Habit, then Discard) — matching the 90/10 expectation.

**Implementation notes for the planner:** mostly `web/src/pages/Today.tsx` + `index.css` (the 📌 Tasks section already exists and only needs visual promotion); Dump quick action needs a small inline once/recurring picker or defaults to one-off undated with edit affordance — decide at plan time.

**Shipped in v1.1, 2026-06-10** (branch `feat/v1.1-dump-and-today`; → Task converts immediately to a one-off undated task, scheduling later via Edit/Triage).

## 2026-06-10 10:21 — Dump: braindump History (by dump date)

**Decisions (grilled):**
- History contains **everything triaged** — discarded 🗑, became-task ✅, became-habit 🌱 — each with a status icon. Discarded is just one outcome; History is the journal of your mind.
- Grouped by **dump date** (`createdAt`, user TZ) — "what was on my mind on Jun 10". **Zero schema change** (there is deliberately no `triagedAt` column; grouping by triage date was rejected).
- UI: collapsed date rows ("Jun 10 · 5 items") at the bottom of the Dump tab; tap a date to expand that day's items with capture time + status icon.
- Data caveat the UI must tolerate: converted items whose task/habit was later deleted have `status: 'converted'` with both links null (FK ON DELETE SET NULL) — show as "converted (since deleted)".

**Implementation notes:** `GET /inbox?all=1` already returns everything; likely wants a grouped variant or client-side grouping; no migration needed.

**Shipped in v1.1, 2026-06-10** (branch `feat/v1.1-dump-and-today`; client-side grouping over lazily fetched `?all=1`).

## 2026-06-10 11:49 — Discard with optional answer note

Sometimes a dumped question gets answered at triage time ("sasi teeth is ok?" → "yes, dentist said fine"). Discarding should let that answer be captured without friction.

**Decisions (grilled):**
- Clicking **Discard** (both the list shortcut and the 🗑 triage-card button) prompts for an **optional note**; submitting empty = skip — **no dedicated skip button**.
- Note stored in a new nullable **`discard_note`** column on `inbox_items` (small migration); applies to discards only, not conversions.
- Surfaces in the braindump **History** under the item: "sasi teeth is ok? — 🗑 yes, dentist said fine". The History UI (feature above) must render it.

**Implementation notes:** extend `POST /inbox/:id/discard` body `{note?}` (zod, cap ~2000); inline input replacing the current `window.confirm` (the prompt itself becomes the confirm — Enter discards, Escape cancels); InboxItem contract gains `discardNote: string | null`.

**Shipped in v1.1, 2026-06-10** (branch `feat/v1.1-dump-and-today`; `discard_note` migration, note ≤2000 trimmed, empty → null).

## 2026-06-10 17:40 — Dump: clear braindump History (per item and per day)

History grows forever; sometimes you want a row (or a whole day) gone for good.

**Decisions:**
- **Hard delete** of history (non-open) inbox items — no soft-delete/undo. Deleting never touches the created habit/task (the FK points inbox→habit/task; it's just a row delete).
- `DELETE /inbox/:id` — non-open items only; an **open** item → **409 `still_open`** (open dump items must use Discard); foreign/missing/bogus → 404; success → `{ok:true}`.
- `POST /inbox/history/clear` body `{ids: uuid[] min 1 max 500}` — deletes the caller's non-open items among ids, silently ignores open/foreign/missing ones → `{deleted: n}`. The client sends the **exact ids of a day group** — TZ-proof, no server-side date math.
- UI: a quiet **✕** on each history row (immediate, no confirm — it's history) and a **Clear** button on each date row (`window.confirm("Delete N history items from <label>?")`). The day group disappears on its own once emptied.

**Shipped in v1.1, 2026-06-10** (branch `feat/v1.1-dump-and-today`; post-plan scope, decided here rather than in the v1 plan).

## 2026-06-10 17:43 — Archived habits are unreachable (NOT grilled yet, NOT implemented)

From live usage: archiving a habit removes it from Today (by design) but there is **no view anywhere** to see archived habits — no unarchive, no history of them (their check-in history still counts in Stats totals, but the habit itself is invisible).

**Open questions for the grill session:** where do they live (Profile "Archived" section vs Stats vs a filter on Today)? unarchive action? show their historical streaks? does delete-from-archive need extra friction?

**Implementation notes:** server already has `archivedAt` + the data; needs a `GET /habits?archived=1` (or include-archived flag), an unarchive endpoint (clear `archivedAt`), and a small UI list.

## 2026-06-11 00:25 — Done History on Today (grilled, designed; for tonight's AFK loop)

When Habits and Tasks were actually done (every done-click), shown "like the Dump History" — deliberately NOT a first-class event log yet.

**Decisions (grilled):**
- Lives at the **bottom of the Today page** as a collapsed **History** section, behaviorally identical to the Dump History (lazy fetch on first expand, date rows, per-date expansion).
- **One merged timeline per date**: Check-ins (✅ habit name · HH:MM) and Completions (📦 task name · HH:MM) interleaved chronologically, newest date first. Sub-daily recurring tasks legitimately show multiple rows per day.
- **Read-only** — no undo/delete from History; undo stays where it lives today.
- Grouping uses the server's **localDate** (user-TZ correct), not browser-local createdAt.
- Architecture: **approach A** — read view over the existing tables — three sources: `checkins`, `task_completions` (recurring), and `tasks.completed_at` (one-offs; added 2026-06-11 morning after QA gap #1 caught that the original two-source list contradicted the "every done-click" headline); NO new event table, NO new write path. API shape is forward-compatible with a future first-class events table (swap internals, UI unchanged).

**Accepted v1 limitations (= documented triggers for the future first-class promotion):**
- Deleting a task/habit cascades away its history rows.
- Renames show the current name on old entries (live join, no snapshot).

**Contract:** `GET /api/history?limit=` (default+cap 2000) → `{ entries: [{ id, kind: 'checkin'|'completion', name, localDate, createdAt }] }`, newest first, auth-scoped.

**Shipped in v1.2-night, 2026-06-11** (branch `feat/v1.2-night`). ⚠️ QA found a gap baked into this very entry: "every done-click" vs. "read view over checkins + task_completions" contradict each other — **one-off task completions set only `tasks.completed_at` (no completions row) and therefore never appear in History**. Resolved 2026-06-11 morning with option (a) — History scans `tasks.completed_at` as a third read-only source (see the corrected Architecture bullet above and `current_issues.md` 2026-06-11).

## 2026-06-11 00:25 — Task Reminders (grilled; for tonight's AFK loop)

A one-off Task can carry a "look at this again" date — a **Reminder** that fires a push notification. ("Resurface/snooze" semantics were explicitly REJECTED: the task never hides from Today.)

**Decisions (grilled):**
- **Push reminder on that date; task stays visible in Today throughout.**
- **One-off Tasks only** — recurring Tasks self-schedule via their interval; a second date would fight that model (rejected).
- Defaults decided at design time (revisit in morning review if wrong): `remindAt` is a full timestamp; UI offers date + time with time defaulting 09:00 user-local. Setting/clearing lives in the task's ⋯ Edit; Triage pickers untouched tonight.
- Refire guard: `remindedAt` timestamp set when the push goes out; editing `remindAt` clears `remindedAt`. Completed tasks never fire. No push subscription → reminder is skipped silently (same as nudges).
- Scheduler: extend the existing node-schedule setup with a per-minute scan: `remindAt <= now AND remindedAt IS NULL AND completedAt IS NULL` → push "🔔 <task name>", stamp `remindedAt`. Trivial at this scale.
- Server validation: `remindAt` on a recurring task → 400.

**Contract:** `tasks` gains nullable `remind_at` + `reminded_at` (migration). Task create/update schemas accept `remindAt: ISO | null` (one-off only). Task serializer returns both.

**Shipped in v1.2-night, 2026-06-11** (branch `feat/v1.2-night`; per-minute scan smoke-verified set→scan→stamped, including the stamp-always-without-subscription rule).

## 2026-06-11 00:25 — Change Password (decided; for tonight's AFK loop)

**Decisions:**
- Profile page section: current password + new password (min 8 chars), Save.
- `POST /api/me/password {currentPassword, newPassword}` — bcrypt-verify current (wrong → 401 `wrong_password`), zod min 8 on new, update hash → `{ok:true}`.
- Existing JWTs stay valid after a change (no session invalidation in v1 — noted, not a goal for a tailnet-only app).

**Shipped in v1.2-night, 2026-06-11** (branch `feat/v1.2-night`; smoke-verified full round-trip — old password rejected, new accepted).

## 2026-06-12 — Habit over-completion (decided in chat, shipped same day)

A weekly Habit whose target is met stays **clickable** on later days: the row keeps its done style (strikethrough), the circle works again, and the count overshoots ("2/1 this week").

**Decisions:**
- Web-only change: the cap was purely the client's disabled circle — the server never rejected over-target check-ins (only same-day duplicates, which still 409).
- Extra Check-ins earn the normal **+10 XP** (existing server path, unchanged); streak math (weeks meeting target) and the day-complete bonus are unaffected by overshoot.
- Daily habits unchanged: one Check-in per Local Date remains a DB constraint.

## 2026-06-12 — Tick notes on Habits and Tasks (grilled, shipped same day)

An optional note on today's tick — "Strength ✓ — climbing 1 hr".

**Decisions (grilled):**
- **Capture UX: after-tick "+ note" chip** (chosen over a per-tick prompt or a ⋯ menu item): the tick stays instant; the just-done row grows a small "+ note" chip (existing note shows as italic text, tappable to edit). Same-day window, mirroring undo.
- Input behavior mirrors the discard-note: Enter saves, Esc cancels, Enter on an emptied input clears; trimmed, ≤2000.
- Storage: `checkins.note`, `task_completions.note` (recurring), `tasks.completion_note` (one-offs — no completion row exists; cleared by undo so a re-complete starts clean). Migration 0010.
- API: `PUT /habits/:id/checkin-note`, `PUT /tasks/:id/completion-note` — idempotent set/edit/clear against TODAY's tick only (404 `nothing_to_note` otherwise). Contracts gain `todayNote`; Done History entries gain `note` (shown italic under the row).
- XP, streaks, day-complete bonus: untouched — a note is annotation, not action.

## 2026-06-12 — Done History: collapsible entries + note editing (decided in chat, shipped same day)

History entries are now tappable: collapsed shows just `✅ Strength · 17:42`; tapping the activity expands it, revealing the note — and the note is editable right there, for ANY past entry (not just today's).

**Decisions:**
- Notes in History are hidden until the entry is expanded (per-entry toggle, same latch pattern as the date rows).
- New `PUT /api/history/:id/note` resolves the entry id across all three sources (checkin / completion row / one-off task with a recorded completion); ownership per-table userId; 404 `nothing_to_note` otherwise. Same note rules as the row chips (trimmed, ≤2000, empty clears).
- The today-only row-chip endpoints stay — the history endpoint is the any-day superset.
- Reuses the TickNote component for the expanded editor.

## 2026-06-12 — Today rows: collapsed note chip, 30s auto-expand on tick (decided in chat)

Done rows on Today now mirror the History pattern: collapsed shows just the struck-through name; tapping the activity name toggles the note chip/editor.

**Decisions:**
- **Ticking auto-expands the chip for 30 seconds** — the "write it while it's fresh" window — then it collapses on its own.
- A **manual** tap (on the name, or into the editor) is sticky: it cancels the auto-collapse and stays open until tapped closed. Opening the editor inside the auto window also cancels the timer (no draft loss at second 30).
- Undo collapses the chip immediately.

## 2026-06-12 — Households / shared Tasks, a.k.a. v2 (NOT grilled yet, NOT implemented)

The CONTEXT.md "personal-only v1" boundary's other half. Analysis from the 2026-06-12 session: **households + shared Tasks would fully subsume the old reminder-app** — its recurrence model is identical (interval hours, next deadline = completion + interval), so the task core is already here.

**The real work package (not the task model):**
- Membership machinery: households, invite tokens, pending/active members, access rules, lifecycle cascades (the reminder-app repo has ADRs + CONTEXT.md for all of this — steal liberally).
- Notification fan-out: a shared task's reminder/deadline notifies all active members, not one owner.
- Identity layer (open registration, email, password reset): **skippable while it's just huy+sasi** — manually seeded accounts get 80% of the value.

**Open design question for the grill session:** does completing a shared Task grant the completer the +5 XP? Shared tasks + one XP economy = a chore race between household members — decide deliberately (feature or fight).
