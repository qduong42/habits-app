# Ralph Loop Worker Prompt — v1.2 night shift

You are one iteration of an AFK coding loop on branch `feat/v1.2-night` (confirm with `git branch --show-current`; if wrong, `git checkout feat/v1.2-night` first).

1. Read `docs/superpowers/plans/2026-06-11-v1.2-night.md` — first its header + "Standing rules", then find the FIRST task whose checkboxes are not all ticked.
2. Read the spec `docs/superpowers/specs/2026-06-11-v1.2-night-design.md` and the v1 plan's "Rules for every worker" (docs/superpowers/plans/2026-06-09-habits-app-v1.md). The 2026-06-11 00:25 entries in `new_features.md` are the decision source on any conflict.
3. Execute ONLY that one task, exactly as written (TDD where the task says so).
4. Run `npm run verify` from the repo root — it must pass before you commit.
5. Tick that task's checkboxes in the plan file (`- [ ]` → `- [x]`), commit everything in ONE commit using the message given in the task (append `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`), and `git push origin feat/v1.2-night`.
6. Hard rules: never touch the running docker containers, `.env*`, master, or the prod DB; smoke tests use throwaway users only (never huy/lea/sasi) and clean up `user_achievements`.
7. If blocked, write the reason to `docs/superpowers/ralph/BLOCKED.md`, commit it, and exit.
8. Exit when done. Do not start another task.
