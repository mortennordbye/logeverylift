# LogEveryLift rules for assistants

Version: 2026-11-12

This document is served to connected AI assistants as an MCP resource
(`logeverylift://docs/app-rules`). It describes the app as it is today. It holds no personal
data. Keep it true to the code: `pnpm check:docs` checks its citations. When a package changes
what it describes, that package updates this file and the server instructions in
`src/lib/mcp/instructions.ts` in the same PR.

## The model

- **Program.** A named list of exercises. Each exercise slot holds planned sets in order:
  reps or a rep range, weight, rest, or for endurance work a duration, distance, incline and
  heart rate zone. Each slot also holds its progression settings.
- **Training cycle.** A template that runs programs for a number of weeks. The schedule is
  either by weekday (one slot per day, 1 = Monday to 7 = Sunday) or a rotation (slots in order,
  one per workout). A slot points at a program, or at nothing for a rest day. A slot marked
  `autoComplete` is a day the user tracks outside the app; it completes itself. A cycle is a
  draft, active or completed, and only one is active at a time. With the endurance features on,
  a cycle holds a race date and distance, a goal (`build` or `maintain`) and an athlete level.
  `manage_training_cycle` `start` with a later `startDate` keeps the cycle a draft scheduled to
  start that day; on that day it becomes active and the old block completes
  (`startDueScheduledCycle` in `src/lib/plan-revisions.ts`). One cycle is scheduled at a time.
- **Exercise.** The built-in library plus the user's own custom exercises. An endurance
  exercise has a discipline (swim, bike or run). `search_exercises` finds them;
  `create_exercise` makes a custom one. A custom name must not match a built-in exercise or
  another of the user's own.
- **Workout session.** One logged workout, with its sets: reps, weight, duration, distance,
  heart rate zone, effort (RIR or RPE), how the user felt, and the user's notes on the session
  and each set. Assistants can read sessions, log one done outside the app (`log_session`, up to
  60 days back, shown to the user as logged by the assistant), and mark a planned day of the
  active cycle as done (`confirm_session`). They cannot edit or delete sessions.
- **Profile and body weight.** Name, gender, birth year, height, goals, experience level, and a
  weight history.
- **Coach memory.** Short entries the assistant keeps between conversations: a `preference`, a
  `limit` (in the athlete's life: time, travel, equipment), an `observation` or a `decision`,
  each with a date and an in-use flag. The user sees and edits them in More → Coach memory.
  Every change is a revision. Injuries and weekly availability go here until the app has its own
  place for them. A race goes on the cycle, not here.
- **Settings.** The user's time zone and display units (`get_profile`, `update_profile`), and
  whether the endurance add-on is on (`enduranceEnabled`). The add-on gates the triathlon plan
  and the race on a cycle in the app. Only an admin can turn it on; no tool can set it
  (`src/lib/endurance.ts`).

## Who owns which field

Three writers can change a planned set. A write by an assistant to a field another writer owns
lasts only until that writer runs again.

| Field | Owner | What an assistant's edit does |
|---|---|---|
| Target reps and weight on strength sets | The progression engine, after each logged session (`src/lib/utils/progression.ts`) | A one-off. The engine moves it again after the next session. To change the trend, change the slot's progression settings. |
| Distance and duration on sets with a peak anchor | The weekly sync of the active cycle, scaled from the peak by the week's phase (`src/lib/periodization-sync.ts:269-270`) | A set replace stores the new value as the new peak, so the edit changes the peak, not only this week. |
| Heart rate zone and rest on `work` sets with a peak anchor | The weekly sync, by phase (`src/lib/periodization-sync.ts:280-282`) | A different value is refused. An omitted value keeps the sync's. Send `sessionRole: null` on the set to take zone and rest over; the sync still scales its distance or duration. |
| The cycle's volume factor (`adaptationPct`) | The weekly sync, from adherence, readiness and effort; a Garmin suggestion the user applies | `manage_training_cycle` `set_volume` (50-110) sets it for this week and rewrites this week's targets. The next weekly sync computes its own. |
| A session the assistant logged (`log_session`) | The assistant at the time, then the user | You cannot edit or delete it; the user can. |
| Everything else in programs and cycles | The user and the assistant | Stays until changed again. |

## Limits of the app today

- **Revisions, not undo buttons.** Every write applies at once (no accept step) and makes a
  revision of the whole program or cycle: who wrote it, when, the reason, and the full state.
  The user sees the history in the app and can restore any revision; you can with
  `list_revisions` and `restore_revision`. A restore keeps all ids, never changes logged
  workouts, and leaves weekly-sync targets and weights or reps the progression engine set since
  as they are. Your writes in one conversation (within 30 minutes of each other) form one change
  set, which the user can undo in one step.
- **Every write needs a reason and the version you read.** `reason` is shown to the user in the
  history. `expectedVersion` is the program's or cycle's `version` from `get_program`,
  `get_training_cycle` or your last write's result. If the user (or another assistant) changed
  it since, the write is refused with what changed; read it again and redo the change.
- **Deletes can be undone.** Deleted programs and cycles stay restorable for 90 days.
- **Two training limits in code** (`src/lib/utils/training-limits.ts`), for users with
  endurance features on, on assistant plan writes only (the user's own edits are never checked):
  - `long_run_cap`: no planned run more than 1.10x the longest run in the last 30 days (Study,
    large cohort). Needs Garmin data; without it the cap is not checked, and the result says so.
  - `hard_sessions_per_week`: at most 3 interval sessions (a `work` set or zone 4-5 on an
    endurance set) in a weekday cycle's week (Coach convention; what counts as hard is
    Inference). Rotation cycles have no fixed week and are not counted.

  A limit blocks only a write that makes things worse. A refused write changes nothing; send it
  again with `overrideLimits` and `overrideReason` if it still fits, and the revision stores the
  override for the user to see. A restore you make is never refused, but the result warns.
  The weekly load ramp, the low-readiness rule and heavy legs within 48 h of a key session are
  not in code yet: check them against the endurance training reference
  (`logeverylift://docs/endurance-training-reference`) and name the rule and its evidence label.
- **One workout slot per day** in a weekday cycle.
- **No seasons or races above cycles.** A cycle can hold a race date and distance.
- **Time:** "today", the cycle week, the weekly sync and the date a workout is logged on follow
  the user's time zone (`timeZone` in `get_profile`; `src/lib/periodization-sync.ts:52`). With
  no zone set, they follow the server's clock and the phone's day.
- **Units:** every value a tool takes or returns is metric (kg, metres, seconds). The user's
  `distanceUnit` (km or mi) and `swimUnit` (m or yd) only change what the app shows; weights
  are always kg.
- **Notes are private.** Session, set and exercise notes are the user's own words and can hold
  health details. Use them for coaching only.

## Access

A connection is either read only or read and change. The user picks it when they connect.
Under read only, write tools are listed but refuse with a message. The user can disconnect an
assistant at any time in More → Connected assistants; the next request then fails.
