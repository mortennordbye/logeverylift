# Bike ride logger

Status: approved by the owner on 2026-11-17. Not started.
Plan page with the pictures (before and after, version 5): https://claude.ai/artifact/LYBSeNnydrNp54KiLMDkYH.
A copy of the page is in the repo: `docs/design/bike-ride-logger.html` (open it in a browser).
This brief is the same plan in text, written to be built from start to end by an agent with no
conversation history and **no input from the owner**. Every decision is made (section 2). Names
marked *new* do not exist yet.

## 0. How to work on this brief

1. Read `CLAUDE.md` (repo) and the owner's global rules first. They apply in full: one PR per
   step, a live status page, screenshots of each step next to the mockup, no trailers on commits,
   STE-style prose, no colons or em dashes in UI copy, monochrome plus one accent.
2. Build the steps in section 6 in order, 0 to 8. Each step is one branch off `main`, one PR,
   green CI, squash merge, deploy check. Do not start a step before the one before it is live.
3. Do not ask the owner. When this brief does not settle a detail, pick the option closest to the
   rules in section 4 and the mockups, write it in section 9 ("Choices made during the build") in
   the same PR, and go on.
4. Stop only for the things the owner's global rules name: something that cannot be undone
   outside the plan (the step 1 data move is in the plan and approved), secret values, or prod
   data other than what step 1 says.
5. **Never deploy while the owner trains.** Before each merge, check prod for an open workout
   session of the owner with sets logged in the last 2 hours (see the memory note on deploys). If
   one is open, wait.
6. Ride mode is a critical flow (timers, set logging). Each of steps 3, 4 and 6 gets `make e2e`,
   the CLAUDE.md smoke pass and a `journey-review` at 390 and 320 px before merge.
7. Changes to stored health data (steps 0, 6, 7) go through the `privacy-compliance` skill and
   `docs/privacy/data-inventory.md`. Push keys go through the `secrets` skill.
8. When a step is done, set its row in section 6 to done with the PR number, and update
   `docs/plans/README.md`.

## 1. Goal and why

On 2026-11-17 the owner tried to ride the program "1 General · Bike tempo" on an indoor trainer.
Nothing worked:

- The bike sets were plain timed sets (no `stepKind`). The watts, cadence and heart rate existed
  only as note text.
- For a discipline exercise, `WorkoutSetsClient` sets `isRunning`, so play (`handlePlayClick` in
  `WorkoutSetsList`) only opens `LogRunModal`. No clock runs. Nothing saves until "Log Ride".
- `LogRunModal` starts at `defaultDistanceM` (40 km for a bike, `DISCIPLINE_CONFIG` in
  `src/lib/utils/discipline.ts`), which showed "160 km/h" for a 15 min set.
- The guided player (`GuidedPlayer`, `useGuidedPlayer`) opens only from
  `src/app/planned/[id]/play/page.tsx`, for a program with step rows that is planned for today
  (`programStepsView` in `src/lib/program-steps-view.ts`). The program had neither.

Goal: open the bike exercise inside a program and see the ride as a pro would (power profile,
zones, every step with its target). Tap Start ride. The phone runs the ride step by step, alerts
at each step with the screen off, and saves each step when it ends. After the ride, Garmin fills
the numbers and the app shows planned against done with the numbers a serious rider uses. The AI
assistant can write every part of a ride over MCP. The ride lives in the bike exercise of the
program: no new tab or page type beside it. The app guides and logs; Garmin records.

## 2. Decisions (all made)

| # | Decision |
|---|---|
| D1 | Bike only. Run and swim keep today's steps and player; they get these parts in a later change. |
| D2 | Everything in this build is for users with endurance features on (`enduranceEnabledFor`). Other users keep today's bike screen, with only the 40 km guess removed for the bike. |
| D3 | A bike exercise always holds steps. A one-time move converts plain bike sets of endurance users, keeping each zone as it is. |
| D4 | The AI rewrites the owner's bike programs' note targets into step targets after step 1 is live, through the MCP tools, so each change is a revision the owner can restore. |
| D5 | Two modes, Indoor and Outdoor, on every ride. The AI writes the indoor target; the app derives the outdoor target (section 4.2); the AI may write its own outdoor target. A step with no outdoor target is never refused. |
| D6 | Mode default: the planned session's mode, else the last ride of this program exercise, else the month (November to March Indoor, April to October Outdoor). After the ride, the Garmin activity type corrects it. The mode is fixed when the ride starts. |
| D7 | Push alerts at each step change and one minute before a step ends. No push for anything else. |
| D8 | Garmin fills the steps automatically, with undo. Numbers the user typed are never overwritten. |
| D9 | A running ride is frozen. AI changes to the program apply from the next ride. |
| D10 | All cycling numbers in this build: avg power, NP, IF, load, kJ, time in power and heart rate zones, heart rate drift (aerobic decoupling), time on target per step, FTP test rides. |
| D11 | No sending rides to a Garmin device. No live sensor data (Safari on iPhone has no Bluetooth). No smart trainer control. |
| D12 | Cut: max power per step, distance and climbing on indoor rides, gradient as a target (it is a note), speed as a target (it is a result). |
| D13 | Nothing to type during a ride. Each step saves its time when it ends. One results table after the ride; effort (RPE) once per ride. |
| D14 | The old player address `/planned/[id]/play` opens ride mode for a bike-only program. Run, swim and multi-sport (brick) programs keep the old player. |

## 3. The ground (read before step 0)

| Area | Where |
|---|---|
| Exercise screen in a workout | `src/app/programs/[id]/workout/exercises/[programExerciseId]/page.tsx`, `src/components/features/WorkoutSetsClient.tsx`, `src/components/features/WorkoutSetsList.tsx`, `src/components/features/LogRunModal.tsx` |
| Step model and checks | `src/lib/utils/workout-steps.ts` (`stepSchema`, `stepTargetsSchema`, `TARGET_METRICS`, `resolveTarget`, `estimateWorkout`, zone tables), `src/lib/utils/program-steps.ts` (`workoutToRows`, `buildWorkout`, `checkStepRows`, `plainSetsToWorkout`, `programPlay`), `src/lib/program-steps-db.ts` |
| Step views | `src/lib/program-steps-view.ts` (`programStepsView`), `src/lib/program-workouts.ts` (`programWorkouts`) |
| Guided player | `src/components/features/guided/useGuidedPlayer.ts`, `GuidedPlayer.tsx`, `StepResultsForm.tsx`, `src/lib/utils/workout-player.ts` (`restorePlayerState`), `src/lib/wake-lock.ts`, `src/lib/audio-cues.ts` |
| Saving | `src/lib/actions/workout-sets.ts` (`logWorkoutSet` writes the plan copy and `stepStatus` for a step set, keyed by session and program set), `src/contexts/pending-queue-context.tsx` (offline queue), `src/lib/utils/stale-bundle.ts` (`callAction`), `src/lib/program-step-results.ts` (`saveProgramStepResults`, whole-run save, do not use it per step), `src/lib/step-results.ts` |
| Schema | `src/db/schema/programs.ts` (`program_sets`), `src/db/schema/workout-sets.ts`, `src/db/schema/workout-sessions.ts`, `src/db/schema/garmin.ts`, `src/db/schema/athlete-profile.ts` (thresholds) |
| Readers of step targets (all must handle the new fields) | `src/lib/utils/workout-steps.ts`, `src/lib/utils/program-steps.ts`, `src/lib/utils/step-results.ts`, `src/lib/utils/plan-revisions.ts`, `src/lib/utils/training-limits.ts`, `src/lib/training-limits.ts`, `src/lib/periodization-sync.ts`, `src/lib/program-steps-view.ts`, `src/lib/mcp/tools/programs.ts`, `src/components/features/steps/StepsEditor.tsx`, `src/components/features/guided/PoolList.tsx`, `src/app/planned/[id]/pool/page.tsx` |
| Writers of plain bike sets | `src/lib/triathlon-plan.ts`, `src/lib/actions/program-shares.ts`, `src/lib/mcp/tools/programs.ts` (`setsFromWorkout` and plain `sets`) |
| Load | `src/lib/utils/training-load.ts` (`plannedLoad`, `stepIntensity`, `pairWithGarmin`), `src/lib/training-load.ts` (`appSessionLoads`), `src/lib/garmin/analytics/load.ts` (NP from streams) |
| Garmin | `src/lib/garmin/fit.ts` (streams, laps, events), `src/db/schema/garmin.ts` (`garmin_activity_streams`), `src/lib/session-compliance.ts` (`garminAllowedFor`, matching), `src/lib/mcp/tools/garmin.ts` |
| MCP | `src/lib/mcp/tools/programs.ts` (`edit_program_exercise`), `src/lib/mcp/tools/endurance-app.ts` (`log_step_results`, `get_step_results`), `docs/mcp/workout-steps.md`, `src/lib/mcp/resource-docs.ts` |
| Push | Not built. Brief `docs/plans/web-push-and-reminders.md` (3a: VAPID env, `push_subscriptions`). `src/app/sw.ts` has no push handler. Server loops live in `src/instrumentation.ts`. |
| Revisions | `src/lib/plan-revisions.ts` |

Facts the reviews found that the design depends on:

- `saveProgramStepResults` returns early when the run's client key already sits on a session and
  writes a completed session on its first save. Per-step saves must use `logWorkoutSet`.
- `stepSchema` and the repeat schema are strict objects: unknown keys are refused. A repeat is
  `{ type: "repeat", count, steps }`.
- The periodization sync changes a step's target only when it is a `zone` target. Keep zone
  targets as zones.
- `restorePlayerState` refuses a changed workout hash; a frozen ride snapshot (D9) avoids this.

## 4. Rules

### 4.1 Modes

| | Indoor (trainer) | Outdoor |
|---|---|---|
| Main target | Watts, from the indoor target and FTP | Derived or written outdoor target (4.2) |
| Second line | Cadence, heart rate | Watts, labelled "with a power meter" |
| Steps end on | Time (a distance end is shown as time from the plan's estimate; a lap end stays a lap) | Time, distance or a lap |
| Results per step | Avg power, cadence, avg and max heart rate | Time, distance, avg speed, avg and max heart rate, climbing, avg power if present |
| Controls | ±5 W, +1 min, hold to skip, pause | +1 min, hold to skip, pause, Lap; ±5 W only on a power step |

An outdoor target changes only the target, never how a step ends. Both modes have the same steps.

### 4.2 Outdoor target when the AI wrote none

Use the zone of the indoor target's low end (Coggan power zones from `workout-steps.ts`), then:

| Step | Outdoor target |
|---|---|
| Warm-up, cool-down, ramp | Heart rate cap at the top of Friel zone 1 (81% LTHR) |
| Recovery, power zone 1, free spin | Effort 2 ("easy spin") |
| Work of 5 min or more, power zone 2 to 4 | Heart rate range of the same Friel zone (Z2 81-89%, Z3 90-93%, Z4 94-99% of bike LTHR) |
| Work under 3 min, or power zone 5 and above | Effort: zone 5 is 8, zone 6 is 9, zone 7 is 10 |
| Work of 3 to 5 min, zone 2 to 4 | Heart rate range as above, plus effort shown as a second line |

Without a bike LTHR, heart rate targets become effort targets (Z2 4, Z3 6, Z4 7).

### 4.3 Ride life

- States: `ready`, `running`, `paused`, `finished`, `ended_early`. One active ride per user.
- The server keeps a ride (*new* table `rides`) and its events (*new* table `ride_events`):
  `start`, `pause`, `resume`, `skip`, `extend` (+60 s), `nudge` (±5 W), `lap`, `end`, `heartbeat`.
  Each event has a client id (for replays), a server sequence number and the server time.
- At start the ride stores a frozen plan snapshot: the expanded steps with watts resolved from
  the FTP of that moment, the outdoor targets and the mode. Later program edits or FTP changes do
  not touch it (D9).
- The clock, step boundaries, saved steps and pushes are all computed from the snapshot and the
  events by one pure function (*new* `rideTimeline` in `src/lib/utils/`). Server time is the
  clock; the client keeps an offset from each server reply.
- Finished: the last step ends, or End ride while paused. Ended early: End ride before the last
  step. Done steps stay saved; load counts the done steps; an ended-early ride does not make a key
  planned session done (*new* column `workout_sessions.ended_early`, read in
  `src/lib/session-compliance.ts`).
- When the app opens on a running ride, it shows Resume or "End at the last step". A ride still
  running 2 hours after its planned end ends on its own at its last completed step.
- Lap and distance steps have no end time: no "1 min left" push; the total shows "65 min + open".
- "Log by hand" is hidden while a ride runs. A second device opens the same ride and may send
  events; a stale client refetches on a sequence conflict.
- Offline: events apply locally and replay later with their client time (accepted if after the
  start and not in the future). Pushes are not moved by offline events.

### 4.4 Changes during a ride

- ±5 W and +1 min change this ride only. ±5 W moves both ends of a range or ramp of the current
  step instance, capped at ±50 W from the plan. Each step saves its offset (*new* column
  `workout_sets.target_offset_w`) and its extension (`extendedSeconds`, exists).
- Each change shows "Target 140-150 W · Undo" (or "+1 min · Undo") for 5 s. Undo sends the
  opposite event.
- Skip is press-and-hold (600 ms) and shows "Skipped · Undo" for 5 s. A skipped step saves with
  status skipped.
- In a repeat, the recovery after the last round is dropped. A recovery can take +1 min.

### 4.5 Saving

- When a step ends (by the timeline), the client logs it through `logWorkoutSet` for that step's
  program set, via `callAction` and the offline queue: duration, status, offset, extension.
- The workout session is the one the workout screen opened. It links the planned session of today
  when there is one; a ride without a planned session is allowed.
- Every result field keeps its source: typed, clock or Garmin (*new* column
  `workout_sets.sources`, JSON map field to source).

### 4.6 Numbers

- Avg power: time-weighted over steps (typed or Garmin), or from the 1 s stream.
- NP: 30 s rolling mean of 1 s power, fourth-power mean, fourth root. **Only from a Garmin
  stream** (reuse `src/lib/garmin/analytics/load.ts`).
- IF = NP / FTP. Load = hours × IF² × 100.
- Without a stream: an estimated power load from step averages (time-weighted fourth-power mean as
  NP) only when power covers at least 90% of timed duration and an FTP is set; marked "est.".
  Else the existing effort load (minutes × RPE × 0.22). Else no load, listed as missing.
- kJ = sum of 1 s power / 1000, or avg power × seconds / 1000.
- Time in zones: power (Coggan, FTP) and heart rate (Friel, bike LTHR) from 1 s streams; without
  a stream, each step's time goes to the zone of its average.
- Time on target per step: share of the step's seconds inside its target (power indoors, heart rate
  outdoors). Only with a stream.
- Heart rate drift (aerobic decoupling): rides of 60 min or more with power and heart rate streams.
  Leave out warm-up and cool-down steps, split the rest into two halves by time, efficiency =
  avg power / avg heart rate per half, drift = (first − second) / first × 100. Show under 5% as
  "steady".
- Planned load: `plannedLoad`, extended so a ramp counts at its midpoint intensity. Planned kJ from
  step midpoints. For the mockup ride (FTP 180): planned IF 0.71, load 55, 490 kJ.
- Unit tests use the mockup numbers: step averages 124, 141, 92, 131, 118 W over 15, 15, 5, 15,
  15 min give avg 126 W, estimated NP 127 W, estimated load 54.

### 4.7 Push

- Implements `docs/plans/web-push-and-reminders.md` 3a (VAPID env, `push_subscriptions`, service
  worker push and notification click), for ride alerts only. Keys via the `secrets` skill; with
  no keys, push is off and the app says "Step alerts are off" before start.
- *new* table `ride_pushes` (ride id, user id, send at, kind, title, body), one row per alert,
  rewritten from the timeline on every event. A loop in `src/instrumentation.ts` claims due rows
  every 5 s with `DELETE … RETURNING` and sends them.
- At send time, skip the push when the ride has a `heartbeat` in the last 15 s (the visible app
  sends one every 10 s and plays its own sound cue). All ride pushes use one notification tag per
  ride, so a new one replaces the old.
- Text, target first. Step change: title "Easy · under 100 W · 5 min", body "Step 3 of 5 ·
  Upper endurance done". One minute before: title "1 min left · next Easy under 100 W", body
  "Step 2 of 5 · Upper endurance". Outdoor uses the outdoor target. No colons, no em dashes.
- Tapping a push opens the bike exercise in ride mode.

### 4.8 Garmin fill

- Runs after a Garmin activity is stored, for users with Garmin access (`garminAllowedFor`),
  for bike activities only.
- Match: a finished or ended-early ride whose start to end overlaps the activity, with 5 min
  tolerance. Two matches: no fill; the summary shows "Two Garmin rides match · Pick".
- Split: by Garmin laps when the lap count equals the step count and each lap is within 10% of
  its step's time; else by the timeline's step windows, aligned on the activity start and its
  timer pause events (stream time is seconds from the start).
- Fill empty or clock-sourced fields only; mark them Garmin. Store what was there before
  (*new* table `ride_garmin_fills`: ride, activity, previous values, declined). Undo restores and
  marks declined; a re-sync never fills a declined pair again. A late activity fills empty fields.
- Mode correction: `indoor_cycling` or virtual ride is Indoor; road, gravel, mountain or cycling is
  Outdoor.

### 4.9 FTP test rides

- Two templates the AI tool and the step editor can insert: ramp test (warm-up 10 min, then 1 min
  steps from 100 W up by 20 W, ending on a lap tap) and 20 min test (warm-up 20 min with two 1 min
  hard efforts, 5 min easy, 20 min all-out, cool-down 10 min). The workout tree carries
  *new* `test: "ramp" | "20min"`.
- After the ride: ramp FTP = 75% of the best 1 min power; 20 min FTP = 95% of the 20 min average
  power (stream or typed). The summary shows "New FTP 186 W · Save", which adds a threshold row
  through the existing threshold path. All % FTP targets then show the new watts.

## 5. Screens (match the mockups)

- **Bike exercise** (ready): title, line "65 min · load about 55 · FTP 180 W", mode row ("Indoor
  trainer" with Change), planned power chart (zone bands Z1 to Z4, watt scale, FTP line, target
  range cap on each bar, ramp as a slope, cap dashed for "under"), planned IF, load, kJ and minutes
  in the main zone, a planned zone bar, the step list (name, round "1 of 2", zone chip, cadence,
  note in italics, target and time), bottom bar "Start ride" and "Log by hand".
- **Ride mode**: header "Indoor · step 2 of 5" and elapsed of total; mini profile with a position
  marker; step name 28 px; clock about 90 pt; target 48 pt; second line; undo toast; ±5 W, +1 min,
  +5 W row; Next card that turns accent in the last minute; hold to skip and Pause (56 pt). Paused:
  Resume and, at the bottom, End ride with "Steps 1 and 2 are saved". Landscape: clock left,
  target right, controls in one row. Outdoor: heart rate as the big number, Lap shown, "Saved on
  this phone" when offline. Screen kept on; beep in the last 3 s.
- **Ride results** (after the ride, before Garmin): "Waiting for your Garmin ride", one row per
  step with Avg W and Avg HR (typing optional), "More numbers" for max HR and cadence, effort
  once, Done. "Later" leaves it.
- **Summary** (finished): time, avg W, NP, IF, load, kJ tiles; plan-against-done chart (target
  bands, power line, heart rate dashed line, legend); zone bar with minutes; step table plan and
  done with ↓ for under target (no second colour); drift and time on target when known; "Steps
  filled from Garmin · Undo".
- **Empty states**: no FTP (targets in % FTP and "Set your FTP to see watts · Set FTP"); alerts
  off or app not on the home screen ("Step alerts are off · Turn on", before start only); offline;
  no Garmin ("Plan only · Add numbers", load from effort marked as an estimate).

## 6. Steps

| Step | Status |
|---|---|
| 0 Groundwork | todo |
| 1 One ride model | todo |
| 2 Bike exercise screen | todo |
| 3 Ride mode | todo |
| 4 Results and numbers | todo |
| 5 AI tools | todo |
| 6 Push | todo |
| 7 Garmin fill and stream numbers | todo |
| 8 FTP test rides | todo |

### Step 0. Groundwork

- Step model (`workout-steps.ts`): optional `ramp` (`anchor`, `from`, `to`), `free`, `outdoor`
  (a target), `test` on the workout. Keep strict objects; bump the schema version and the
  planned-step snapshot version. Store on `program_sets`: *new* columns `ramp`, `free`,
  `outdoor_target` (JSON). `program_sets.targets` stays 1 to 2 entries.
- Results: *new* `workout_sets` columns `avg_power`, `max_hr`, `avg_cadence`, `avg_speed`,
  `climb_m`, `target_offset_w`, `sources`; `avg_hr` exists and is now written. *new*
  `workout_sessions` columns `ended_early`, `ride_mode`.
- *new* tables `rides`, `ride_events` (section 4.3). Server actions *new* `startRide`,
  `sendRideEvent`, `getRide` (Server Action template from CLAUDE.md, `requireSession`, Zod, owner
  checks) and the pure `rideTimeline`.
- Update every reader in section 3 for ramp, free and outdoor (a ramp's low/high for readers that
  need one range is its from/to).
- `pnpm db:generate`, idempotent SQL, commit the SQL and snapshot. Privacy check and data
  inventory for the new fields.
- **Done when:** unit tests for `rideTimeline` (pause, resume, skip, extend, nudge, lap, offline
  replay, auto end); each reader has a test with a ramp and an outdoor target; integration tests
  for the three actions (ownership, sequence conflict, replayed client id is a no-op).

### Step 1. One ride model

- *new* `migrateBikeSetsToSteps` in `src/lib/`: for endurance users, bike program exercises with
  plain sets become step rows using `plainSetsToWorkout` and `workoutToRows` (zones kept as
  zones). One revision per program, writer `sync`, reason "Bike sets became steps". Idempotent.
  Called once at server start from `src/instrumentation.ts`.
- Bike writers write steps: `triathlon-plan.ts`, `program-shares.ts`, the MCP tool (plain bike
  `sets` are converted to steps on write).
- Bike only: remove the 40 km default (`defaultDistanceM` for the bike is unset; the sheet starts
  empty and shows speed only with a distance).
- After deploy (D4): with the `logeverylift` MCP tools, rewrite the owner's bike programs (list
  them with `list_programs`; on 2026-11-17 they were 92, 94, 96, 98, 101, 103, 105, 107): turn the
  note targets into step targets (power from % FTP or zone, cadence ranges), keep the note text,
  let the outdoor target derive (do not copy the note heart rates: on program 92 they do not match
  the watts). Use `expectedVersion` and a reason on each write.
- **Done when:** integration test: a program with plain bike sets becomes steps once, a second run
  changes nothing, the revision restores it; the cycle sync still moves a zone target; no writer
  can store a plain bike set for an endurance user.

### Step 2. Bike exercise screen

- For a bike exercise of an endurance user, the workout exercise route renders the new bike view
  (*new* `BikeExercise` in `src/components/features/bike/`) in place of the set list. Reuse the
  app's existing components and tokens.
- Planned chart, stats, zone bar, step list, mode row with D6 default and Change, empty states.
- "Log by hand" opens the results table of step 4 (until then, the existing per-set sheet).
- **Done when:** journey screenshots at 390 and 320 px match the mockup; strength and run screens
  unchanged; component tests for the mode default and the no-FTP state.

### Step 3. Ride mode

- Ride mode inside the bike exercise, built from the guided player engine (wake lock, audio cues,
  restore) but driven by `rideTimeline` and the server ride. Controls and toasts per 4.4,
  landscape, outdoor, paused and offline states per section 5.
- Each step saves per 4.5. Finish and end early per 4.3. D14 routing for `/planned/[id]/play`.
- **Done when:** e2e (fake clock installed before `goto`, see the note in
  `e2e/guided-program.spec.ts`): a 5-step ride saves 5 steps; skip, undo, +1 min, ±5 W, pause and
  end early save the right status, time and offset; a reload mid-ride resumes at the right second;
  offline steps send after reconnect; the week page counts a finished ride and not an ended-early
  key session. Journey review and smoke pass.

### Step 4. Results and numbers

- Ride results table and summary per section 5, effort once per ride, numbers per 4.6 that need
  no stream (avg power, estimated load, kJ, zone time by step, planned numbers).
- Load from these rides in `appSessionLoads`.
- **Done when:** unit tests with the mockup numbers (4.6); the summary marks estimates; no 40 km or
  speed on indoor rides; journey review.

### Step 5. AI tools

- `edit_program_exercise` accepts ramp, free, outdoor, notes for climbs and `test`; refuses bad
  input with the reason. `log_step_results` and `get_step_results` carry every result field and
  its source; a ride summary read (*new* `get_ride`) returns the numbers of 4.6. Update
  `docs/mcp/workout-steps.md` and the server instructions.
- **Done when:** integration tests write and read each new field through the tools.

### Step 6. Push

- Per 4.7. Subscription prompt from the "Turn on" row; iOS needs the app on the home screen.
- **Done when:** integration test: events rewrite `ride_pushes` correctly; a heartbeat suppresses
  a send. Manual check on the owner's phone (ask nothing; schedule a 3-step test ride in the dev
  environment and note the result in section 9).

### Step 7. Garmin fill and stream numbers

- Per 4.8, plus the stream numbers of 4.6: NP, IF, load from the stream, time in zones, time on
  target, heart rate drift. Mode correction.
- **Done when:** integration tests with a stored FIT fixture: lap split and time split fill each
  step within 1 W and 1 bpm of the stream average for that window; typed values stay; undo
  restores and blocks a refill; two matches do not fill.

### Step 8. FTP test rides

- Per 4.9: templates in the step editor and the MCP tool, the result line and Save.
- **Done when:** unit tests for both formulas; e2e saves a new FTP and the bike screen shows the
  new watts.

## 7. Out of scope (put in BACKLOG.md when this brief is done)

- Run and swim on the same parts (D1).
- GPS track and map from Garmin.
- W/kg and peak powers (5 s to 20 min).
- Sending rides to a Garmin device (D11).

## 8. Checks the owner will do

- After step 3: ride "1 General · Bike tempo" on the trainer from start to end; every step saves.
- After step 6: ride with the phone locked; a push comes at each step and one minute before.
- After step 7: after a Garmin ride, the steps fill and the totals match Garmin Connect.

## 9. Choices made during the build

(Add one line per choice: step, what was open, what you chose, why.)
