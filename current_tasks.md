# Habits App — Session Handoff (2026-06-09, late evening)

State dump so a fresh session can pick up where this one left off.

## What this project is

Mobile-first gamified habit tracker PWA ("dopamine-trick myself into practicing what I read on Substack"). Repo: `/home/huy/throwaway/habits-app`, GitHub `qduong42/habits-app`, working branch **`feat/habits-app-v1`** (never push to master — blocked by policy anyway).

## Done so far

1. **Brainstorm (interactive, with Huy)** — decisions locked:
   - Users: Huy + partner/friends; username+password, JWT httpOnly cookie; users seeded in DB, no signup
   - Core loop: daily checklist; habits have frequency daily or N×/week
   - Idea inbox → convert to habit (bridges reading → practice)
   - Gamification: XP (+10/check-in, +25 day-complete bonus), levels (flat 1000 XP), per-habit streaks, achievements catalog; NO social features in v1
   - One configurable daily nudge push notification
   - Hosting: decide later, Docker-ready
   - **Today screen approved via browser mockup**: thin XP bar header + flat habit rows grouped under light colored category headers (Fitness/Mental/Sleep), streak flame right-aligned; tabs Today/Inbox/Stats/Profile
   - Stack: React+Vite+TS PWA, Express+TS, Postgres+Drizzle, Docker Compose ("proven stack" from the 2026-05-13 task-tracker spec in `/home/huy/throwaway/docs/superpowers/specs/`)

2. **Spec written & committed**: `docs/superpowers/specs/2026-06-09-habits-app-design.md` (self-reviewed; user review deferred to morning)

3. **Implementation plan written & committed**: `docs/superpowers/plans/2026-06-09-habits-app-v1.md` — 25 checkbox tasks (Task 0–24) in 6 vertical slices (skeleton/auth → habits+Today → gamification → inbox → stats/PWA/nudge → refactor+QA). Has a **Rules for every worker** section and a **Shared API contracts** section (single source of truth for types). `PROMPT.md` in repo root defines the one-task-per-session worker contract.

4. **AFK execution loop**: was about to dispatch Task 0 via subagent-driven-development (fresh implementer subagent per task + spec-compliance review + code-quality review, auto-continue, halt only on `docs/superpowers/ralph/BLOCKED.md`). **ZERO plan tasks implemented yet — repo has only docs/PROMPT.md/.gitignore.** A ralph.sh runner with `--dangerously-skip-permissions` was vetoed by the permission classifier; the chosen approach is in-session subagents instead.

## INTERRUPTED BY: new feature brainstorm (in progress)

Huy read an article about **brain dumps** (clear your mind → schedule the items → some become recurring tasks) and wants the app to cover it. This folds his old recurring-task-tracker concept into this app:

- **Dump**: zero-friction capture of thoughts/article takeaways (Inbox tab generalizes to "Dump")
- **Triage**: card-by-card, each item becomes ✅ one-off task (optional due date) / 🔁 recurring task / 🌱 habit / 🗑 let go
- **Today screen v3**: gains a 📌 Tasks section (due/overdue one-offs + recurring due) above the habit category groups

A mockup of this 3-screen flow is in the visual companion with **3 open questions (NOT yet answered)**:
- Q1: does the dump→triage→today flow match his mental model? (A yes / B tweak)
- Q2: recurring task scheduling — A resets-on-completion (his task-tracker model) / B fixed calendar / C both per-task
- Q3: do tasks earn XP too? (A yes, tasks +5 / B habits only)

He also said: **"make a html mock-up first, let's do prototyping in pure html as much as possible"** → before implementing, prototype flows as pure-HTML screens in the visual companion (or via the `prototype` skill) and validate with him.

## Visual companion (browser mockup server)

- Session dir: `.superpowers/brainstorm/377071-1781036797/` (gitignored)
- URL http://localhost:58009 — check `state/server.pid` alive; restart with
  `/home/huy/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/brainstorming/scripts/start-server.sh --project-dir /home/huy/throwaway/habits-app`
- Write content fragments to `content/`, never reuse filenames; user clicks land in `state/events`
- Latest screen: `content/brain-dump-flow.html` (the 3 questions above)

## Next steps (in order)

1. Read `state/events` + Huy's terminal answers for Q1–Q3; iterate mockups if "tweak"
2. Possibly more pure-HTML prototyping of: triage interaction detail (interval picker, date picker), Dump tab, tasks-section edge cases (overdue styling) — he wants HTML-first prototyping
3. **Update the spec** (`2026-06-09-habits-app-design.md`): add brain dump/triage flow, tasks (one-off + recurring) data model (likely `tasks` table with `interval_hours`-style reset-on-completion semantics from the old task-tracker spec, if Q2=A), Today-screen Tasks section, XP rules for tasks (per Q3)
4. **Update the plan** accordingly (new tasks for tasks-table slice + triage UI; renumber or append; keep contracts section in sync)
5. Resume the AFK loop: subagent-driven-development, Task 0 first (scaffold is unaffected by the new features), implementer prompt template at `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/subagent-driven-development/implementer-prompt.md`
6. Morning: Huy reviews spec + QA report; merge decision via superpowers:finishing-a-development-branch

## Session task list state (Claude Code TaskList)

Tasks #1–9 (brainstorm pipeline) completed. #10–34 = plan Tasks 0–24, all pending except #10 (Task 0, was in_progress when interrupted — no code written, safe to redo from scratch).
