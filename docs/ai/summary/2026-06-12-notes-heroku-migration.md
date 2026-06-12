# Tick notes everywhere + Heroku migration (tailnet decommissioned)

- **Date (UTC):** 2026-06-12 15:10
- **Branch:** docs/heroku-primary (PR #11 open; everything else merged to master)

## ONE LINER

Branch: docs/heroku-primary. habits-app now lives solely on Heroku (https://habits-app-42e80a35d720.herokuapp.com) with all local data migrated and the tailnet deploy decommissioned; next: change the weak migrated passwords (huy/sasi in-app, lea via SQL or deletion) and merge PR #11.

## SUMMARY

- **Tick notes feature family** (PRs #6–#9, all merged + were deployed to tailnet before the move):
  - #6: optional note on today's tick — `checkins.note`, `task_completions.note`, `tasks.completion_note` (one-offs; cleared by undo), migration 0010; `PUT /habits/:id/checkin-note` + `PUT /tasks/:id/completion-note` (today-only); `todayNote` on contracts, `note` on history entries; TickNote chip component.
  - #7: Done History entries collapsible; `PUT /history/:id/note` resolves any entry id across the three sources — notes addable/editable on ANY past entry.
  - #8: Today done-rows collapse the chip behind the name; fresh tick auto-expands for 30s (manual interaction sticky; editor-open cancels the timer).
  - #9: simplify pass (4-agent review): shared `tickNoteSchema` (validation.ts, empty→null transform), `useNoteChips` hook, `NameToggle` component, parallelized lookups in `setCompletionNote`. Skipped deliberately: narrowing cache invalidations (load-bearing), one-off completion-row normalization (rejected design (b)), mutation-hook factory.
- **Heroku migration** (PR #10 + ops): root cause of the dashboard-deploy H10 was no `start`/`build` scripts (Node buildpack, not our Dockerfile). Added Procfile (release = compiled migrate+seed, CWD=server), root build script, engines node 22, opt-in `DATABASE_SSL=no-verify` for Heroku Postgres TLS, sasi in seed. Config vars set via CLI (JWT_SECRET random, SEED_PASSWORD random, VAPID pair reused from the tailnet container). Data migrated `pg:reset` + `pg:push` (verified 3 users / 7 habits / 7 checkins / 3 tasks / 7 dumps).
- **Tailnet decommissioned** on Huy's decision: `tailscale serve off`, `docker compose down` — volume `habits-app_postgres_data` kept as offline backup. Earlier same session: postgres restart policy fix, iPhone Safari fix (iCloud Private Relay blocks ts.net names).
- Also: weekly habit over-completion (PR #5 — client-side disable removed, server never capped), AFK loop model tiers in `afk-loop.sh` (PR #4 — sonnet default, `**Model:**` hint override), test-suite overview given (283 tests, all server-side, no web/E2E tests).

## CURRENT POINT

- master: everything merged through PR #10. PR #11 (this branch): progress-doc update marking Heroku primary.
- Heroku app healthy: release migrations ran, dyno up, login path verified. Eco dyno sleeps → reminders/nudges don't fire while asleep (known, accepted for now).
- ⚠️ OPEN RISK: migrated passwords on the public DB are the weak tailnet ones (huy/123, sasi/sasiboo, lea/changeme123). Classifier blocked an unprompted hash reset; Huy to change in-app or give explicit word.
- Phones still need: remove old PWA icon, add Heroku URL, re-enable push (subscriptions are per-origin).
- Backlog unchanged: archived-habits view (needs grill), households/sharing = v2.

## NEXT

Change the three account passwords on Heroku (in-app for huy/sasi; SQL reset or delete for lea) — until then the public instance is effectively open.
