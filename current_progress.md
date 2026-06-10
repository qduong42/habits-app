# Current Progress — habits-app (updated 2026-06-10 18:05)

## Shipped

- **v1** — merged to `master` via PR #1 (28/28 plan tasks, full overnight AFK loop). Spec/plan/QA under `docs/superpowers/`. Working: auth, habits + Today checklist, XP/levels/streaks/achievements (race-hardened), Dump capture + triage → habits/one-off/recurring tasks (sub-daily reset-on-completion), Stats, settings, PWA, web push nudge, production Docker Compose.
- **v1.1** — complete on `feat/v1.1-dump-and-today`, **PR #2 OPEN + mergeable** (8 commits, 246 tests green, per-task spec+quality reviews):
  - Discard with optional answer note (inline input, Enter empty = skip; stored in `discard_note`, shown in History)
  - Task-first Dump quick action (→ Task instant one-off undated) + braindump History (collapsed date rows, status icons, discard notes, "converted (since deleted)")
  - Today two-section split (✅ Tasks / 🌱 Habits tinted mega-sections)
  - Add-button offers tasks/habits only (Dump-a-thought removed per Huy)
  - History clear: ✕ per item + per-day Clear with confirm

## Running locally

http://localhost:3001 — **`tsx watch`** (hot-reloads server code; plain tsx was the root cause of the "✕ doesn't remove" bug — stale process missing the new routes). Postgres :5433. Logins huy/lea, `changeme123`. Frontend changes still need `npm run build -w web` (served from static dist).

## Next actions

1. **Huy: review/merge PR #2** (test plan in the PR description), then optionally delete merged branches.
2. **Grill session pending:** archived habits are unreachable (no view/unarchive anywhere) — open questions in `new_features.md` 2026-06-10 17:43. Don't implement before grilling.
3. Polish backlog: `current_issues.md` (minor UX/perf items).

## Process notes (for fresh sessions)

Workflow: grill-with-docs → record decisions in new_features.md → plan → subagent-per-task with spec+quality reviews → PR. Classifier blocks: master pushes, `.env*` writes, remote-branch deletion, skip-permissions loops. Never mutate as seeded huy/lea (achievement pollution). CONTEXT.md = domain language; v1 plan Rules 1–11 binding for workers. `current_tasks.md` is an obsolete early handoff.
