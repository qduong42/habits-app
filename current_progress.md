# Current Progress — habits-app (updated 2026-06-10, v1.1 implemented)

Dev server may be running locally on :3001 (`SERVE_STATIC=1 PORT=3001 npx tsx server/src/index.ts`, postgres via `docker compose up -d --wait postgres`). Logins: huy/lea, password `changeme123` (SEED_PASSWORD default).

## v1: DONE — merged to master via PR #1

All 28 tasks of `docs/superpowers/plans/2026-06-09-habits-app-v1.md` complete (incl. production compose/README, refactor pass, overnight QA report at `docs/superpowers/ralph/QA-REPORT.md`); merge commit `211f8a1`.

Working: auth, habits CRUD + Today checklist (category groups), check-in/undo with XP/levels/streaks/achievements (race-hardened with user-row locks), Dump capture + card-by-card triage → one-off/recurring tasks (reset-on-completion, sub-daily OK) or habits, Tasks on Today (+ ⏳ Scheduled toggle), Stats, settings (nudge time/TZ), PWA (installable, injectManifest SW), web push + daily nudge job (needs VAPID keys, see README).

## v1.1: implemented on `feat/v1.1-dump-and-today` — awaiting PR/merge (Huy's call)

Plan: `docs/superpowers/plans/2026-06-10-v1.1-dump-and-today.md` (all tasks ticked). Decisions: `new_features.md` (each entry now carries a "Shipped in v1.1" line). The three features:

1. **Discard with optional answer note** — `discard_note` column + `POST /inbox/:id/discard {note?}` (≤2000, trimmed, empty → null); inline note input replaces `window.confirm` in both Dump list and TriageCard.
2. **Dump task-first quick action + braindump History** — → Task (FIRST) converts immediately to a one-off undated task; History section groups all triaged items by dump date (lazy `?all=1` fetch), shows discard notes and "converted (since deleted)".
3. **Today two-section split** — ✅ Tasks / 🌱 Habits mega-sections with tinted containers; category sub-headers stay inside Habits.

Mini QA 2026-06-10: curl smoke on a private server against `habits_test` with a throwaway user (discard-with-note visible in `?all=1`; quick convert-task {name only} → oneoff/undated task, item linked; empty-body discard → null note). All rows cleaned up incl. `user_achievements`; `npm run verify` green.

## Backlog

Only the minor polish list in `current_issues.md` (Bright Idea incident resolved; remaining items are small UX/perf polish).

## Process notes

- Permission classifier blocks: pushing to master (use the feature branch; merge decision is Huy's, via superpowers:finishing-a-development-branch), any `.env*` writes (code has dev fallbacks), ralph.sh with --dangerously-skip-permissions (run the loop in-session instead).
- Plan Rules section (top of plan file) is binding for every worker; review carry-overs get appended to Task 23's text.
- `current_tasks.md` is the older handoff (pre-implementation) — this file supersedes it.
