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
  either by weekday (1 = Monday to 7 = Sunday, up to three slots a day in order, `daySlot` 1-3)
  or a rotation (slots in order, one per workout). A slot points at a program, or at nothing for
  a rest day, which is then the only slot of its day. A slot marked
  `autoComplete` is a day the user tracks outside the app; it completes itself. A cycle is a
  draft, active or completed, and only one is active at a time. With the endurance features on,
  a cycle in no season holds a race date and distance, a goal (`build` or `maintain`) and an
  athlete level. A cycle in a season holds no race: it reads the season's A race.
  `manage_training_cycle` `start` with a later `startDate` keeps the cycle a draft scheduled to
  start that day; on that day it becomes active and the old block completes
  (`startDueScheduledCycle` in `src/lib/plan-revisions.ts`). One cycle is scheduled at a time.
  The app starts a due cycle when the active cycle is read: on page render, and over MCP in
  `list_training_cycles`, `get_training_cycle`, `confirm_session` and `set_volume`, also on a
  read-only connection. That start is the app's own write (writer `sync`), not yours.
- **Season.** A long goal above cycles, for every user: name, goal, start, end and the next
  goal (`list_seasons`, `get_season`, `manage_season`). With the endurance features on, a season
  holds races (`manage_race`): date, discipline, distance and priority A, B or C. Its phases
  are training cycles in order, each with an optional phase type and a length in weeks or days
  (`add_phase`, `move_phase`, `set_phase`, `remove_phase`). A phase type picks the cycle's
  curve: general, base and build ramp from 0.80 to 1.00 of each set's peak with recovery weeks;
  peak holds 1.00; taper falls from 0.60 to 0.35; transition holds 0.50 and leaves zone and
  rest alone. A phase with no type runs the cycle's whole block curve. When a phase starts, the
  next phase is scheduled for the day after it ends (writer `sync`). If the user starts a cycle
  outside the season, the chain pauses until `resume`. The taper must end on the A race day:
  `get_season` shows the fit, and `fit_taper` changes the length of the phase before it. A
  date change of any race, or an A race added, removed or changed in priority, flags the season
  for a re-plan; the app never moves phases itself. Re-plan, then `clear_replan`. Deleting a
  season keeps its cycles; they act as cycles with no season until it is restored.
- **Dated session.** A weekday cycle makes one dated session per program slot for the whole
  block, when it starts or is scheduled (`list_planned_sessions`). Each can be moved (from today
  to the block's last day), skipped, changed (program, label, notes, order) or added by hand
  (`manage_planned_session`); a day holds at most three. A slot change rewrites only the sessions
  from today on that nobody changed; changed ones and past ones stay. Done and missed are never
  stored: a session is done when a workout is logged for it, or, failing that, a workout of its
  program that day, or any workout that day. A rotation cycle has no fixed dates, since a missed
  session repeats the next day: its sessions are worked out from the walk, and one can only be
  skipped or given another program, by `rotationPosition`.
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
  Every change is a revision. Injuries, availability and the strength goal go in the athlete
  profile, thresholds in their own list, a race on the cycle; not here.
- **Thresholds.** For every user: FTP (W), threshold heart rate for bike and run and max HR
  (bpm), threshold run pace and swim CSS (stored as m/s; tools also give and take seconds per km
  or per 100 m). One row per value with its date and source (`manual`, `test`, `garmin`), so the
  rows are the history; the latest date is current, and a value older than 8 weeks is stale.
  A field test (`run_30min`, `bike_30min`, `ftp_20min`, `css_400_200`, `swim_t1000`) sends its inputs, and the
  app computes the value. Garmin estimates show as suggestions for accounts with Garmin; they
  are stored only when taken. `get_athlete_profile`, `manage_thresholds`.
- **Athlete profile** (endurance features only). Endurance experience, available days, hours
  per week, the longest day, the strength goal, injuries and limits (area, side, what to avoid,
  status active, managed or past), and whether the intake interview is done. The interview (the
  `intake_interview` prompt, or the steps in the app) writes these, not coach memory, and offers
  each `limit` or `observation` memory entry so its fact can move here; the entry is then made
  inactive. `get_athlete_profile`, `manage_athlete_profile`, `manage_injuries`. Every change is a
  revision.
- **Strength in an endurance plan.** The strength goal sets a default: keep muscle and get
  stronger 2 sessions a week in general prep and base, 1 in build and peak, 1 light in the taper
  (last heavy session 7-10 days out), none in transition; minimal 1 a week. It is a default: plan
  another count only with the reason in the write's `reason`. No code refuses another count yet.
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
  history. `expectedVersion` is the program's, cycle's or dated session's `version` from
  `get_program`, `get_training_cycle`, `list_planned_sessions` or your last write's result. If the user (or another assistant) changed
  it since, the write is refused with what changed; read it again and redo the change.
- **Deletes can be undone.** Deleted programs, cycles and seasons stay restorable for 90 days.
- **Two training limits in code** (`src/lib/utils/training-limits.ts`), for users with
  endurance features on, on assistant plan writes only (the user's own edits are never checked):
  - `long_run_cap`: no planned run more than 1.10x the longest run in the last 30 days (Study,
    large cohort). Needs Garmin data; without it the cap is not checked, and the result says so.
  - `hard_sessions_per_week`: at most 3 interval sessions (a `work` set or zone 4-5 on an
    endurance set) in a weekday cycle's week (Coach convention; what counts as hard is
    Inference): the active cycle and a draft scheduled to start. Rotation cycles have no fixed
    week and are not counted.

  Checked writes: program set edits, slot changes, starting or scheduling a cycle, `set_volume`,
  a change to the active cycle's length, goal or level (they rescale this week's targets), and a
  dated session moved, changed, added or planned again (counted in each Monday-to-Sunday week
  it touches, with moved sessions where they land and skipped ones left out).

  A limit blocks only a write that makes things worse. A refused write changes nothing; send it
  again with `overrideLimits` and `overrideReason` if it still fits, and the revision stores the
  override for the user to see. A restore you make is never refused, but the result warns.
  The weekly load ramp, the low-readiness rule and heavy legs within 48 h of a key session are
  not in code yet: check them against the endurance training reference
  (`logeverylift://docs/endurance-training-reference`) and name the rule and its evidence label.
- **Time:** "today", the cycle week, the weekly sync and the date a workout is logged on follow
  the user's time zone (`timeZone` in `get_profile`; `src/lib/periodization-sync.ts:53`). With
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
