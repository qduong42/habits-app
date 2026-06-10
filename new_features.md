# New Features (grilled, NOT yet implemented)

Decisions resolved via grill-with-docs sessions; domain language in `CONTEXT.md`. Append new entries with date/time.

## 2026-06-10 10:21 — Today: two-section split (Tasks vs Habits)

From live usage: the Task/Habit distinction is too subtle, and the Dump's quick actions are habit-centric while ~90% of dumps should become tasks.

**Decisions (grilled):**
- One Today screen, but **two clearly distinct mega-sections**: "✅ Tasks" and "🌱 Habits" with distinct backgrounds/headers. Habit category sub-groups stay inside the Habits section. No fifth tab.
- **Recurring tasks stay in ✅ Tasks.** The boundary is **chores-vs-practices**, not repeating-vs-once (CONTEXT.md updated 2026-06-10): tasks = things the world needs done (once or cyclically, no streaks); habits = practices you build (streaks, XP identity).
- Dump list quick actions: add **→ Task as the FIRST action** per item (then → Habit, then Discard) — matching the 90/10 expectation.

**Implementation notes for the planner:** mostly `web/src/pages/Today.tsx` + `index.css` (the 📌 Tasks section already exists and only needs visual promotion); Dump quick action needs a small inline once/recurring picker or defaults to one-off undated with edit affordance — decide at plan time.

## 2026-06-10 10:21 — Dump: braindump History (by dump date)

**Decisions (grilled):**
- History contains **everything triaged** — discarded 🗑, became-task ✅, became-habit 🌱 — each with a status icon. Discarded is just one outcome; History is the journal of your mind.
- Grouped by **dump date** (`createdAt`, user TZ) — "what was on my mind on Jun 10". **Zero schema change** (there is deliberately no `triagedAt` column; grouping by triage date was rejected).
- UI: collapsed date rows ("Jun 10 · 5 items") at the bottom of the Dump tab; tap a date to expand that day's items with capture time + status icon.
- Data caveat the UI must tolerate: converted items whose task/habit was later deleted have `status: 'converted'` with both links null (FK ON DELETE SET NULL) — show as "converted (since deleted)".

**Implementation notes:** `GET /inbox?all=1` already returns everything; likely wants a grouped variant or client-side grouping; no migration needed.
