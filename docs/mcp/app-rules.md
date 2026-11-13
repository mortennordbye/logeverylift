# LogEveryLift rules for assistants

Version: 2026-11-13

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
- **Dated session.** A weekday cycle makes one dated session per program or workout slot for the
  whole block, when it starts or is scheduled (`list_planned_sessions`). Each can be moved (from
  today to the block's last day), skipped, changed (program, label, notes, order) or added by hand
  (`manage_planned_session`); a day holds at most three. A slot change rewrites the sessions nobody
  changed from this week's Monday on; done ones, changed ones and earlier weeks stay. Done is never
  stored: a session is done when a workout is logged for it, or, failing that, a workout of its
  program that day, or any workout that day. With the endurance features on, the rules in
  "Planned vs done" below apply instead. A rotation cycle has no fixed dates, since a missed
  session repeats the next day: its sessions are worked out from the walk, and one still to come
  can only be skipped, unskipped or given another program, by `rotationPosition`.
- **Structured workout** (endurance features only). A swim, bike or run workout as steps and
  repeats, each step with an end (time, distance or lap) and an optional target as a percent of
  the user's thresholds. The syntax and every rule are in `logeverylift://docs/workout-steps`:
  read it before your first workout write. A workout that breaks a rule is refused with every
  problem and its path, and no override exists. The library holds reusable workouts
  (`list_workouts`, `get_workout`, `manage_workout`). A dated session runs a program or a
  workout, never both. A session holds its own copy of a workout, not a reference, so a past
  session keeps what was planned. A library edit or delete reaches only the untouched sessions
  from this week's Monday on, of the active or scheduled cycles whose slots use it; `update_from_library`
  copies it again onto one session. A workout goes on a day with `manage_planned_session`
  `set_workout` (or `add` with `workout` or `workoutId`), and on a weekday slot with
  `edit_cycle_slot` `workoutId`. A brick is two sessions on one day, the run linked to the ride
  before it (`link_brick`, or `add` with `brickParentId`; a slot with `brickWithNext`). Moving the
  ride moves the run; the run cannot move alone. Rotation cycles get no workouts and no bricks.
- **Planned vs done.** Each dated session has a state, first match wins (`sessionState` in
  `src/lib/utils/session-compliance.ts:378`): `done` (a workout is logged for it, an activity was
  picked for it, or a match below), `skipped`, `missed` (the user or you confirmed a miss),
  `illness` (a past day in a sick period) or `sick` (today or later in one), `unconfirmed` (an
  endurance session from the last 7 days with no match and no answer), `missed` (any other past
  session) and `planned`. With the endurance features on, an endurance session that no workout is
  logged for is matched only to a logged workout with a set of its sport, or, for admins, a Garmin activity of its sport that
  day, paired by the closest duration or distance. Lifters keep the rules in "Dated session".
  `confirm_planned_session` answers for the user: `done` with the time (and distance, RPE, notes;
  this logs a session, shown as logged by the assistant), `done` with a `garminActivityId`
  (admins), `missed` with a reason, or `unmiss`. `confirm_session` refuses a session with a sport
  when the endurance features are on, so a miss is never hidden behind an auto-completed day.
- **Missed sessions** (D11, D19). A missed easy session (priority `support` or `optional`) is
  skipped: the plan goes on, and you do not stack it on another day. A missed key session gets
  `suggestedMoveTo` (`suggestMoveDay`, `src/lib/utils/session-compliance.ts:253`): the earliest
  day after the miss, today or later, in the same Monday-to-Sunday week, on an available day,
  not in a sick period, with no key or hard session on it or the day before or after. With no
  such day there is no suggestion: skip it. You may move the session to that day with
  `manage_planned_session` `move` when the user agrees. With no priority set, a session is key
  when it is hard, or when it is the longest bike or run of its week at 90 minutes or more.
- **Compliance.** For each done session, done over planned by duration, else by distance
  (`complianceBand`, `src/lib/utils/session-compliance.ts:42`): `green` 80-120%, `yellow` 50-79%
  or 121-150%, `orange` under 50% or over 150%, `red` missed, `done` when there is nothing to
  compare, `illness` in a sick period. `get_compliance` gives, per Monday-to-Sunday week, the
  counted and done sessions; a week is complete at 80% or more. A skip before the day is a plan
  change and leaves the count; a miss, a later skip and illness count as not done
  (`countsInWeek`, `src/lib/utils/session-compliance.ts:87`). Consistency is the share of
  complete weeks over the last 12 full weeks, with this week shown apart. `get_compliance` is
  for every user.
- **Sick period** (endurance features only). One entry per period: a first day, a last day or
  none while still sick, an optional IOC severity (mild, moderate, severe) and the user's notes
  (`manage_illness`; `get_athlete_profile` lists the open one and those of the last 90 days).
  Periods never overlap. Sessions inside read as `illness`; nothing is stored on them. After a
  period, `get_athlete_profile` gives the return rule (`returnInfo`,
  `src/lib/utils/session-compliance.ts:199`): before moderate or hard training, a 10-20 minute
  test at 60-70% of normal intensity; stop and see a doctor on symptoms during it or within 24
  hours; then 2-3 easy days. Severe, or longer than 7 days: see a doctor first. Do not plan
  intensity until the athlete reports a normal test. The app never changes the plan by itself,
  and you change it only when the user asks. Sick periods are health data: use them for
  coaching only.
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
| Distance and duration on sets with a peak anchor | The weekly sync of the active cycle, scaled from the peak by the week's phase (`src/lib/periodization-sync.ts:331-332`) | A set replace stores the new value as the new peak, so the edit changes the peak, not only this week. |
| Heart rate zone and rest on `work` sets with a peak anchor | The weekly sync, by phase (`src/lib/periodization-sync.ts:335-337`) | A different value is refused. An omitted value keeps the sync's. Send `sessionRole: null` on the set to take zone and rest over; the sync still scales its distance or duration. |
| The cycle's volume factor (`adaptationPct`) | The weekly sync, from adherence, readiness and effort; a Garmin suggestion the user applies | `manage_training_cycle` `set_volume` (50-110) sets it for this week and rewrites this week's targets. The next weekly sync computes its own. |
| A session the assistant logged (`log_session`, `confirm_planned_session` `done`) | The assistant at the time, then the user | You cannot edit or delete it; the user can. |
| Structured workouts, in the library and on dated sessions | The user and the assistant. The weekly sync never changes a workout | To change a structured session's volume, edit the session; `set_volume` does not scale it. |
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
- **Deletes can be undone.** Deleted programs, cycles, seasons, library workouts and sick periods
  stay restorable for 90 days.
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
  dated session moved, changed, added, given a workout or planned again (counted in each
  Monday-to-Sunday week it touches, with moved sessions where they land and skipped ones left
  out), and a library workout edit, on the weeks of the sessions it rewrites.

  A limit blocks only a write that makes things worse. A refused write changes nothing; send it
  again with `overrideLimits` and `overrideReason` if it still fits, and the revision stores the
  override for the user to see. A restore you make is never refused, but the result warns.
  The weekly load ramp, the low-readiness rule and heavy legs within 48 h of a key session are
  not in code yet: check them against the endurance training reference
  (`logeverylift://docs/endurance-training-reference`) and name the rule and its evidence label.
- **Time:** "today", the cycle week, the weekly sync and the date a workout is logged on follow
  the user's time zone (`timeZone` in `get_profile`; `src/lib/periodization-sync.ts:54`). With
  no zone set, they follow the server's clock and the phone's day.
- **Units:** every value a tool takes or returns is metric (kg, metres, seconds). The user's
  `distanceUnit` (km or mi) and `swimUnit` (m or yd) only change what the app shows; weights
  are always kg.
- **Notes are private.** Session, set and exercise notes are the user's own words and can hold
  health details. Use them for coaching only.

## Not in the app yet

- The step editor for structured workouts. You create and change workouts; the app's library
  screen only lists, duplicates, renames, deletes and restores them, and puts one on a day.
- The guided player that runs a workout step by step on the phone.
- A dated session that runs a workout, not a program, does not show on the home screen's
  today card or week strip yet.

## Access

A connection is either read only or read and change. The user picks it when they connect.
Under read only, write tools are listed but refuse with a message. The user can disconnect an
assistant at any time in More → Connected assistants; the next request then fails.
