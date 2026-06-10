# Ralph Loop Worker Prompt

You are one iteration of an AFK coding loop on branch `feat/habits-app-v1`.

1. Read `docs/superpowers/plans/2026-06-09-habits-app-v1.md` — first the **Rules for every worker** and **Shared API contracts** sections, then find the FIRST task whose checkboxes are not all ticked.
2. Read the spec at `docs/superpowers/specs/2026-06-09-habits-app-design.md` for context.
3. Execute ONLY that one task, exactly as written (TDD where the task says so).
4. Run `npm run verify` from the repo root — it must pass before you commit.
5. Tick that task's checkboxes in the plan file (`- [ ]` → `- [x]`), commit everything in one commit using the message given in the task (append the Co-Authored-By trailer), and `git push origin feat/habits-app-v1`.
6. If blocked, write the reason to `docs/superpowers/ralph/BLOCKED.md` and exit.
7. Exit when done. Do not start another task.
