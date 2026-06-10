# Habits App

Mobile-first PWA that turns what Huy reads (Substack) and thinks (brain dumps) into practiced behavior: dump → triage → daily checklist, glued together by one XP economy.

## Language

**Dump Item**:
A raw, untriaged thought captured in the Dump tab (free text, optional source URL).
_Avoid_: inbox item, note, idea (DB table keeps the legacy name `inbox_items`)

**Triage**:
The card-by-card decision turning one Dump Item into a Task, a Recurring Task, or a Habit — or letting it go.
_Avoid_: convert (use only for the API verb), process, sort

**Task**:
Something the world needs done — once (optional due date) or cyclically (Recurring Task); no streaks, +5 XP. The Task/Habit boundary is chores-vs-practices, NOT repeating-vs-once (decided 2026-06-10 — a recurring chore is still a Task).
_Avoid_: todo, chore

**Recurring Task**:
A Task on an "every N hours/days" cycle whose next-due timestamp resets from its last Completion (not a fixed calendar); sub-daily intervals are supported, so it can recur within one day.
_Avoid_: scheduled task, repeating task

**Habit**:
A practice YOU are building (daily or N-times-per-week), tracked with streaks; the gamified heart of the app. Expected to be the ~10% minority of triage outcomes — most dumps become Tasks.
_Avoid_: routine, goal

**Check-in**:
Marking a Habit done for one local day. Earns +10 XP; drives streaks.
_Avoid_: completion (reserved for Tasks), check-off

**Completion**:
Marking a Task done (one-off: terminal; recurring: resets the cycle, possibly multiple times per Local Date). Earns +5 XP; no streaks; never affects the day-complete bonus.
_Avoid_: check-in (reserved for Habits)

**Local Date**:
"Today" computed in the user's timezone — the unit streaks, dueness, and undo windows operate on.

**XP Economy**:
The single pool of XP from Check-ins (+10), Completions (+5), and the day-complete bonus (+25); levels are floor(xp/1000)+1 and never regress past local-day boundaries.

## Relationships

- A **Dump Item** is triaged into exactly one of: **Task**, **Recurring Task**, **Habit** — or discarded
- A **Habit** has many **Check-ins**, at most one per **Local Date**
- A **Task** (recurring) has many **Completions**; a one-off has at most one
- **Check-ins** and **Completions** both feed the **XP Economy**; only **Check-ins** feed streaks

## Example dialogue

> **Dev:** "When a **Dump Item** about watering plants gets **triaged**, is that a **Habit**?"
> **Domain expert:** "No — watering plants is a **Recurring Task**: every 5 days, counted from the last **Completion**. A **Habit** is a practice you're building, like morning sunlight; it has a streak. The plant doesn't care about your streak, it cares that 5 days passed."

## Flagged ambiguities

- "water the plants" sits in both the old household task-tracker (shared tasks) and this app — resolved: in v1 all Tasks are **personal-only**; shared household tasks are explicitly v2.
- "convert" vs "triage" — resolved: **Triage** is the user-facing flow; `convert` survives only as API route naming.
- "today/done" means two different time grains — resolved: **Habits** live on the **Local Date** grain (one Check-in per day); **Tasks** live on timestamps (a sub-daily Recurring Task can be due, done, and due again within one Local Date). See ADR-0001.
- "history" means two different journals — resolved 2026-06-11: the Dump tab's **History** is the journal of *what was on your mind* (dump items by dump date); Today's **Done History** is the journal of *what you did* (Check-ins + Completions by local date, merged, read-only). Same UI pattern, different nouns.

**Done History**:
The read-only merged timeline of Check-ins and Completions at the bottom of Today, grouped by Local Date. A view over existing tables, not an event log (promotion to first-class deliberately deferred).
_Avoid_: activity log, audit log, feed

**Reminder**:
An optional "look at this again" timestamp (`remindAt`) on a one-off Task that fires one push notification when reached; the Task stays visible in Today the whole time — a Reminder never hides or snoozes anything.
_Avoid_: snooze, resurface, review date
