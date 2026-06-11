# Current Issues

Append new entries with date/time.

## 2026-06-10 10:21 — "Bright Idea" achievement pre-unlocked for huy (RESOLVED + process guard)

**Symptom:** first-conversion (💡) showed unlocked though Huy never triaged anything.
**Root cause:** an overnight AFK implementer smoke-tested `capture → convert-task` logged in as the seeded `huy` user against the **dev** DB (2026-06-10 01:24); it cleaned up the inbox/task rows but the `user_achievements` row persisted — achievements are never revoked by design.
**Fix applied:** stray row deleted from dev DB (2026-06-10 10:15).
**Guard going forward:** smoke tests must use throwaway users (never seeded `huy`/`lea`) and clean up `user_achievements` too — this rule is now included in agent dispatch prompts.

## 2026-06-10 10:21 — Open minor polish items (queued, mostly in plan Task 23)

**All 7 FIXED in v1.2-night, 2026-06-11** (branch `feat/v1.2-night`, Tasks 7–9; details in `docs/superpowers/ralph/QA-REPORT-v1.2.md`):

- ~~Notification click focuses an existing app window but doesn't navigate it to Today (`web/src/sw.ts`).~~ Fixed: focused client also navigates to `/`.
- ~~Profile push button: non-503 vapid fetch error leaves it disabled with no hint/retry; dev builds surface "production build only" only after clicking Enable.~~ Fixed: inline error + Retry; dev hint shown before clicking.
- ~~Push enable/disable state can drift from server after a 410-cleared subscription (harmless; disable is idempotent).~~ Fixed: `resyncPush()` re-uploads the live subscription on Profile mount.
- ~~Settings time input saves per-change (focus loss while typing); nudge switch isn't optimistic.~~ Fixed across v1 Task 23 (blur-save, optimistic switch) + v1.2 Task 8 (Enter-to-commit).
- ~~Nudge counting loads full checkin history per fire; `listTasks` loads all completions (indexes + bounded queries queued in Task 23).~~ Fixed: nudge bounded to the current ISO week, `listTasks` DISTINCT-ON (v1 Task 23), new `idx_checkins_user_date` index (migration 0009).
- ~~Today shows "📌 Tasks 0/0" when only scheduled (not-yet-due) tasks exist.~~ Fixed: header count ignores not-yet-due tasks.
- ~~Triage interval picker accepts integers only (1.5 days unenterable; server accepts fractional ≥1h).~~ Fixed: fractional days ≥ 1h (step 0.5, validated ≥ 1/24).

## 2026-06-11 — Done History misses one-off task completions (found in v1.2 QA, needs morning decision)

**Symptom:** a done-clicked one-off task never appears in the Done History on Today; habit check-ins and recurring-task completions do.
**Root cause:** `completeTask` records one-offs by setting `tasks.completed_at` only — no `task_completions` row — while the history view (approach A) reads only `checkins` + `task_completions`. The contradiction sits inside the `new_features.md` 2026-06-11 00:25 entry itself ("every done-click" headline vs. the approach-A table list).
**Options:** (a) history additionally scans `tasks WHERE completed_at IS NOT NULL` — read-only, undo-consistent (undo clears `completed_at`), keeps approach A's no-new-write-path property; or (b) one-off completion also inserts a `task_completions` row — write-path change, undo must delete it.
**Status:** RESOLVED 2026-06-11 morning — Huy chose **(a)**. `listHistory` now merges a third read-only source (`tasks WHERE completed_at IS NOT NULL`, localDate derived via `localDateFor(user.timezone, completedAt)`); round-trip test covers complete → appears, undo → disappears. The `new_features.md` entry is corrected to list all three sources.
