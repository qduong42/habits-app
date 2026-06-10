# Current Issues

Append new entries with date/time.

## 2026-06-10 10:21 — "Bright Idea" achievement pre-unlocked for huy (RESOLVED + process guard)

**Symptom:** first-conversion (💡) showed unlocked though Huy never triaged anything.
**Root cause:** an overnight AFK implementer smoke-tested `capture → convert-task` logged in as the seeded `huy` user against the **dev** DB (2026-06-10 01:24); it cleaned up the inbox/task rows but the `user_achievements` row persisted — achievements are never revoked by design.
**Fix applied:** stray row deleted from dev DB (2026-06-10 10:15).
**Guard going forward:** smoke tests must use throwaway users (never seeded `huy`/`lea`) and clean up `user_achievements` too — this rule is now included in agent dispatch prompts.

## 2026-06-10 10:21 — Open minor polish items (queued, mostly in plan Task 23)

- Notification click focuses an existing app window but doesn't navigate it to Today (`web/src/sw.ts`).
- Profile push button: non-503 vapid fetch error leaves it disabled with no hint/retry; dev builds surface "production build only" only after clicking Enable.
- Push enable/disable state can drift from server after a 410-cleared subscription (harmless; disable is idempotent).
- Settings time input saves per-change (focus loss while typing); nudge switch isn't optimistic.
- Nudge counting loads full checkin history per fire; `listTasks` loads all completions (indexes + bounded queries queued in Task 23).
- Today shows "📌 Tasks 0/0" when only scheduled (not-yet-due) tasks exist.
- Triage interval picker accepts integers only (1.5 days unenterable; server accepts fractional ≥1h).
