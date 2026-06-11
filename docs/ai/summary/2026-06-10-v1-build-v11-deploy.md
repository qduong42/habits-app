# habits-app: v1 overnight build, v1.1 features, Tailscale deployment

- **Date (UTC):** 2026-06-10 ~19:30
- **Branch:** feat/v1.1-dump-and-today

## ONE LINER

Branch: feat/v1.1-dump-and-today. v1 merged (PR #1) and v1.1 complete on PR #2 with the app deployed in a prod container on :3002; next: Huy clicks the Tailscale serve-enable link, we run `tailscale serve --bg --https=443 http://localhost:3002`, and PR #2 gets merged.

## SUMMARY

- **v1 (overnight AFK loop):** 28-task plan executed via subagent-per-task + spec review + quality review; brainstormed and grilled interactively first (spec, plan, CONTEXT.md, ADRs 0001/0002). Reviews caught real bugs: day-bonus TOCTOU race + parallel-undo double charge (fixed with user-row locks), inbox FK 500 on deleting converted items (ON DELETE SET NULL). Merged to master via PR #1; master made default branch.
- **v1.1 (same loop, 4 tasks):** discard-with-note (`discard_note` column, inline input), task-first Dump quick action + braindump History (by dump date), Today two-section split (✅ Tasks / 🌱 Habits). Post-plan additions on user request: Add-button reduced to tasks/habits only; History clear per item (✕) and per day. 246 tests green. PR #2 open + mergeable.
- **Debugging:** "✕ doesn't remove" was a stale plain-`tsx` process missing new routes (frontend dist newer than API process). Root-cause fix: dev server now runs `tsx watch`.
- **Deployment (option 2 of 3 considered — VPS and PaaS rejected for cost/need):** prod container `habits-app-api-1` on :3002, restart unless-stopped, secrets (JWT, fresh VAPID keys) baked into container env; Tailscale moved from work tailnet (turbitduong@) to personal (huyictigcse@, profile switch — work profile preserved); 3 devices enrolled.
- **Recorded, NOT implemented:** archived habits unreachable (needs grill); password change missing (logins still changeme123).

## CURRENT POINT

- PR #2 open/mergeable; working tree clean; all docs (current_progress.md, new_features.md, current_issues.md) current and committed.
- Local: dev server :3001 (`tsx watch`, dies with the session — restart: `cd server && SERVE_STATIC=1 PORT=3001 npx tsx watch src/index.ts`), prod container :3002 (survives), postgres :5433 (survives).
- Deployment BLOCKED on one manual click: https://login.tailscale.com/f/serve?node=nMjJvnxR6i11CNTRL (as huyictigcse@), then `tailscale serve --bg --https=443 http://localhost:3002`.

## NEXT

Huy enables Tailscale serve (link above) → run the serve command → verify https URL on phones (Add to Home Screen, enable push) → merge PR #2 → refresh container (`docker compose up --build -d api` with secrets re-exported — see current_progress.md).
