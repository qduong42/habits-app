# Current Progress — habits-app (updated 2026-06-10 10:30, paused by Huy)

Branch `feat/habits-app-v1`, all work committed + pushed. Dev server may be running locally on :3001 (`SERVE_STATIC=1 PORT=3001 npx tsx server/src/index.ts`, postgres via `docker compose up -d --wait postgres`). Logins: huy/lea, password `changeme123` (SEED_PASSWORD default).

## Done: 26 of 28 plan tasks (Tasks 0–21 + 25–27)

Full overnight AFK loop (fresh subagent per task + spec review + quality review + fix loops). 234 server tests, verify/lint green at HEAD. Source of truth for task state: the checkboxes in `docs/superpowers/plans/2026-06-09-habits-app-v1.md`.

Working today: auth, habits CRUD + Today checklist (category groups), check-in/undo with XP/levels/streaks/achievements (race-hardened with user-row locks), Dump capture + card-by-card triage → one-off/recurring tasks (reset-on-completion, sub-daily OK) or habits, 📌 Tasks section on Today (+ ⏳ Scheduled toggle), Stats, settings (nudge time/TZ), PWA (installable, injectManifest SW), web push + daily nudge job (needs VAPID keys, see README).

## Remaining plan work (resume with subagent-driven-development, one task at a time)

1. **Task 22 — Production compose + README**: a full dispatch prompt was already drafted; key points: multi-stage server/Dockerfile (mind WEB_DIST relative resolution in server/src/app.ts and cwd-relative ./drizzle in migrate.ts), compose `api` service (host port 3002 — dev server holds 3001; env incl. optional VAPID trio), expand README (keep Push setup section), smoke via curl, leave postgres running.
2. **Task 23 — Refactor pass**: big queued carry-over list is IN the plan's Task 23 text (indexes, listTasks DISTINCT ON, level/undo dedup, parseBody, CategoryContract direction, convertItem/convertItemToTask fold, web sheet/ActionSheet/optimistic-toggle dedup, checkbox roles, ['stats'] invalidation on mutations, settings polish). No behavior changes; verify green before/after.
3. **Task 24 — QA report**: full suite + curl flows → docs/superpowers/ralph/QA-REPORT.md. RULE: smoke flows must use a THROWAWAY user, never seeded huy/lea (see current_issues.md — achievement pollution incident).

## New features (grilled 2026-06-10, NOT implemented — decisions in new_features.md)

- Today two-section split (✅ Tasks / 🌱 Habits) + "→ Task" first quick action on Dump items (chores-vs-practices boundary, CONTEXT.md).
- Braindump History: all triaged items, grouped by dump date, collapsed dates expand. No schema change.
When Huy says go: brainstorm is already done — go straight to writing-plans for these two, then execute.

## Open issues

See `current_issues.md` (Bright Idea incident resolved + minor polish list, mostly folded into Task 23).

## Process notes

- Permission classifier blocks: pushing to master (use the feature branch; merge decision is Huy's, via superpowers:finishing-a-development-branch), any `.env*` writes (code has dev fallbacks), ralph.sh with --dangerously-skip-permissions (run the loop in-session instead).
- Plan Rules section (top of plan file) is binding for every worker; review carry-overs get appended to Task 23's text.
- `current_tasks.md` is the older handoff (pre-implementation) — this file supersedes it.
