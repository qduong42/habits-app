# Habits App — Session Handoff (2026-06-09, night)

## What this is

Mobile-first gamified habit tracker PWA + brain-dump/triage/tasks. Repo `/home/huy/throwaway/habits-app`, GitHub `qduong42/habits-app`, branch **`feat/habits-app-v1`** (never push master). Spec: `docs/superpowers/specs/2026-06-09-habits-app-design.md`. Plan: `docs/superpowers/plans/2026-06-09-habits-app-v1.md` (28 checkbox tasks; execute in DOCUMENT ORDER: 0–16, then 25–27, then 17–24). Domain language: `CONTEXT.md`. Decisions: `docs/adr/0001` (task time grain, reset-on-completion, sub-daily), `docs/adr/0002` (personal-only v1).

## All design decisions are FINAL (brainstorm + grill-with-docs completed with Huy)

Users huy+lea (seeded, JWT httpOnly); daily habit checklist grouped by categories; Dump tab (capture → card-by-card triage → one-off task / recurring task / habit / discard); recurring tasks reset-on-completion with `interval_hours` (sub-daily OK, reappear when due, no per-task push); undated one-offs always on Today (overdue → due today → undated); XP: +10 check-in, +5 task completion, +25 bonus = all HABITS done (tasks never block); levels flat 1000 XP; streaks habits-only; achievements catalog (conversions = habit OR task triage); single daily nudge "🔥 N habits · M tasks left today"; Today screen + dump/triage mockups approved in visual companion; stack: React+Vite+TS PWA / Express+TS / Postgres+Drizzle / Docker Compose.

## Execution state

**AFK overnight loop running in-session** (superpowers:subagent-driven-development): fresh implementer subagent per plan task → spec-compliance review subagent → code-quality review subagent → fix loops → next task. Implementer prompt template: `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/subagent-driven-development/implementer-prompt.md`. Halt conditions: `docs/superpowers/ralph/BLOCKED.md` or plan exhausted. Each task ticks its plan checkboxes, commits, pushes to `feat/habits-app-v1`.

**Plan task progress: see the checkboxes in the plan file itself — that is the source of truth.** (Session TaskList mirrors it: #10–34 = plan tasks 0–24, #35–37 = plan tasks 25–27.)

A standalone `PROMPT.md` worker contract exists in repo root if anyone wants to run the loop via fresh CLI sessions instead (a ralph.sh with --dangerously-skip-permissions was vetoed by the permission classifier — don't recreate it).

## If resuming fresh

1. `cat docs/superpowers/plans/2026-06-09-habits-app-v1.md | grep -n '\- \[ \]' | head` → first unchecked task = next work item
2. Resume the subagent loop per the skill above (or execute tasks directly, one at a time, following the plan's "Rules for every worker")
3. After all tasks: superpowers:finishing-a-development-branch → Huy reviews QA-REPORT.md + spec, then merge decision
4. Morning report to Huy: what got built, test status, QA report, anything blocked

## Visual companion (browser mockups — brainstorm is DONE, only needed if new design questions)

Session `.superpowers/brainstorm/377071-1781036797/`; restart: `/home/huy/.claude/plugins/cache/claude-plugins-official/superpowers/5.1.0/skills/brainstorming/scripts/start-server.sh --project-dir /home/huy/throwaway/habits-app`
