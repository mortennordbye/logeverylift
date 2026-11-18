# Bike ride logger

Status: approved by the owner on 2026-11-17. Step 0 built on `feat/bike-ride-logger`; all steps merge together at the end (owner, 2026-11-17).
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
  its step's time; else by the wall clock: each step from its start to its end in the ride's
  timeline, less the rider's pauses in the app (stream time is seconds from the first record,
  with Garmin's pauses as gaps). A watch started early, Garmin's auto-pause or a second ride in
  the same activity then shift nothing.
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
| 0 Groundwork | done on `feat/bike-ride-logger` (no PR of its own) |
| 1 One ride model | done on `feat/bike-ride-logger` (no PR of its own) |
| 2 Bike exercise screen | done on `feat/bike-ride-logger` (no PR of its own) |
| 3 Ride mode | done on `feat/bike-ride-logger` (no PR of its own) |
| 4 Results and numbers | done on `feat/bike-ride-logger` (no PR of its own) |
| 5 AI tools | done on `feat/bike-ride-logger` (no PR of its own) |
| 6 Push | done on `feat/bike-ride-logger` (no PR of its own); off in prod until the VAPID keys are set (BACKLOG) |
| 7 Garmin fill and stream numbers | done on `feat/bike-ride-logger` (no PR of its own) |
| 8 FTP test rides | done on `feat/bike-ride-logger` (no PR of its own) |

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

## 7. Out of scope (in BACKLOG.md: done)

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

- Step 0, version: the workout schema reads `v` 1 and 2 and always gives back 2; new planned-step snapshots are written as `v` 2. An older tree from the assistant or an export still reads.
- Step 0, a ramp with a cap: refused (a second target needs a `target`). `program_sets.targets` holds a target and its cap, and a ramp leaves no place for the cap.
- Step 0, `test` storage: `test` is in the model only. Its column on `program_exercises` and the copy paths come with the step that first writes it (5 or 8), so no copy path carries an unused column.
- Step 0, undo of a skip: the event list had none, so a new kind `unskip` cancels the latest skip and the step goes on as if never skipped. Undo of ±5 W and +1 min is the opposite event, as written.
- Step 0, heartbeat: not a `ride_events` row. It sets `rides.heartbeat_at`, so it takes no sequence number and never makes another device conflict.
- Step 0, step status: lap on a timed step saves it as partial; End ride saves the current step as partial, or leaves it out when no second was ridden.
- Step 0, auto end: 2 hours after the latest of the planned end, the last event and the last heartbeat, so a ride someone still uses never ends. The planned end is the start, plus each step's time or estimate (an open distance step at 25 km/h, a lap step 10 min) and the extensions, plus the pauses already over. An open pause counts, so a ride left paused also ends.
- Step 0, a client time outside the ride: the event is kept at the server's time, not refused, so a queued event is never lost. It never goes before the last stored event or heartbeat, so a late replay cannot rewrite what another device saw.
- Step 0, an event on an ended ride: accepted when it makes the ride live again (an unskip of the last step, an offline extend from before the end), else "The ride has ended". The auto end bounds how late that can be.
- Step 0, outdoor targets in the frozen plan: only a written outdoor target for now. The derived one (4.2) is added to the plan by the step that first shows it.
- Step 0, `workout_sessions.ended_early`: the column only. The finish flow (step 3) writes it; `startRide` writes `ride_mode`.
- Step 0, weekly sync: a ramp or free step keeps its target; the sync writes no zone on it.
- Step 0, ownership: `startRide` needs the bike exercise to be in the program of the open workout session.
- Step 1, rest on a plain set: a rest after a set becomes a `rest` step after it (the step model has no rest on a step, and the workout screen would run the row's rest too). A rest of 1 to 4 s rounds up to 5 s. The rest after the last set is dropped. The work row keeps its id, anchor and role; its own rest is set to 0.
- Step 1, a bike step keeps rest 0: a rest written on a bike step row (the rest editor, a drag on a screen still showing plain sets, an assistant's set list) moves to the rest step right after it, or a new one; inside a repeat it is dropped, so the rounds stay the same. The step editor's save writes rest 0 on bike rows. The weekly sync writes the phase rest into the rest step right after a bike work step and never onto the step; with no rest step there it writes none. Run and swim keep the rest on the row (D1). `syncOwnedSetFields` still lists the row rest of a step: on a bike step it is 0 in the restored revision and now, so a restore gives the same value.
- Step 1, anchor first: a plain set with both a time and a distance ends on the one its weekly-sync anchor scales, so the anchor and role stay.
- Step 1, sets no step can hold: a time under 5 s or a distance under 10 m is raised to it. Anything else the step check refuses (over 12 h, over 300 km) leaves the slot plain with a `[bikeSetsToSteps] left plain` log line; writes to that slot go on as plain.
- Step 1, warm-up: `plainSetsToWorkout` now keeps a warm-up set as a `warmup` step, also for "Edit as steps".
- Step 1, one place for all writers: `settleStepRows` (`src/lib/program-steps-db.ts`) ends every set write. It turns a bike slot whose sets are all plain into steps for an endurance user, then runs the step check. The app's slot writes, set add, update and delete, import, `edit_program_exercise`, the triathlon plan, a copied share and a one-day copy all call it. A plain set added to a slot that already holds steps is still refused by the check. Restore is the one writer that may bring plain sets back.
- Step 1, safe paths: the admin seed data (`src/lib/actions/admin.ts`) and `addWarmupSets` write only strength sets; the demo seed scripts run outside the app.
- Step 1, after a restore: the move never writes a program twice (it skips a program with a "Bike sets became steps" revision), so a restore of the old sets stays until the next edit of that slot.
- Step 1, restore across the move: a restore that turns a step back into a plain set takes the zone and rest from the restored revision; only the sync's scaled time or distance stays current (`restoredSetValues`).
- Step 1, open workout: one rule for the boot move and every write. While a workout started in the last 10 hours is open on the program, plain bike sets stay plain (the screen never changes under the rider); the next write or boot after it ends moves them. An open workout older than 10 hours is abandoned (the app's failsafe closes it after 10 hours too) and does not hold the move back. 10 h, not the 1 h start sweep, so a long ride is never moved under the rider. `updateProgramSet` returns the row as it is after a move.
- Step 1, revision purge: after a year, the purge removes the "Bike sets became steps" revision, and the next boot moves a restored plain program again. Accepted: by then D3 has applied for a year.
- Step 1, endurance turned on later: `setUserEndurance` runs the move for that user at once.
- Step 1, bike sheet with no distance: `LogRunModal` logs a ride on its time alone (no distance sent); the set editors open a new ride on Time.
- Step 2, planned load: `plannedLoad` counts a bike ride whose timed steps all have a power target as a whole: planned IF is the time-weighted fourth-power mean of the step midpoints (a ramp at its midpoint, a rest at 0), load is hours × IF² × 100 (4.6). The sum of each step's own load gave 53 for the mockup ride, not 55. A ride with a step that has no power target keeps the old per-step sum. This also changes the planned load the program, week and planned-session screens show for such rides.
- Step 2, the mockup ride: its numbers (IF 0.71, load 55, 490 kJ) hold for the targets the mockup shows: ramp 55 to 75% FTP, work 75-81% FTP, easy zone 1, steady 56-75% FTP. The AI example on the plan page (work 75-80%, steady zone 2) gives load 54. Planned kJ is rounded to 10, as an estimate.
- Step 2, zones: the zone chip, the time in zones and the derived outdoor targets use the Coggan zones (zone 1 up to 55% FTP, 2 up to 75, 3 up to 90, 4 up to 105, 5 up to 120, 6 up to 150, 7 above; `powerZone` in `src/lib/utils/bike-outdoor.ts`). A value on a zone's start belongs to the zone below, for the low and the high end of a range alike: 75-81% FTP reads Z2-3 and rides outdoors at the zone 2 heart rate, 56-75% reads Z2. A zone target keeps its own zone. Time in zones takes each step's midpoint; steps with no power target are left out.
- Step 2, total time: the summary line adds the steps with a time (indoors a distance step's estimate too) and says "+ open" when a lap or open distance step is left (4.3), not the auto-end guesses in `estSeconds`. The chart gives such a step its `estSeconds` width.
- Step 2, mode default: planned sessions hold no ride mode (no column, nothing writes one), so D6 starts at the last ride of the program exercise (`workout_sessions.ride_mode` of its session, else `rides.mode`), then the month in the user's time zone. `defaultRideMode` takes a planned mode, so a later change only passes it in. Change flips the mode on the screen only; Start ride stores it.
- Step 2, outdoor targets: `outdoorTarget` (`src/lib/utils/bike-outdoor.ts`) implements 4.2 and is used by the screen and by `buildRidePlan`, so the frozen plan holds the derived target (`outdoor`) and the effort second line (`outdoor2`). A written outdoor target wins when it resolves; a written heart rate target without a bike LTHR becomes the derived effort. Warm-up, cool-down and ramp without an LTHR get effort 2 (zone 1). A warm-up or cool-down whose target is already a heart rate keeps that target outdoors. A rest step, and a work step with no power target, get no outdoor target. A work ramp also gets the heart rate cap (4.2 puts every ramp there); step 8 must override this for the FTP ramp test, which is ridden to failure. Step titles have no names in the step model, so they are the step kind ("Work · 1 of 2", "Easy"); the round shows on work steps only.
- Step 2, empty states: no FTP shows targets in % FTP (a zone as its % range), the chart in % FTP, no kJ, and the row "Set your FTP to see watts · Set FTP" to `/more/account/training-numbers`. Outdoors without a bike LTHR shows effort targets and no extra row. The outdoor screen has no chart, as in the mockup. Text links (Edit, Change, Set FTP, Log by hand) use `text-primary`, as `BackLink` and the set list's Edit do; the accent fill (`brand`) is for the chart and Start ride. The chart grades the one accent by zone (opacity up to zone 5) and keeps the zone names in a gutter right of the plot. "Step alerts are off" waits for step 6.
- Step 2, Start ride and Log by hand: Start ride calls `startRide` with the workout session of the workout layout and opens `?ride=1`, which shows the bike screen until step 3 builds ride mode. While the user's ride of this exercise is running or paused (`getRide`, which settles it first), the bar shows "Ride running" and Resume to `?ride=1` in place of Start ride, and Log by hand is hidden (4.3). Log by hand opens `?hand=1`, today's set list, until step 4. The session id is read at the tap, so the server HTML and the first render agree; with no session yet the screen says "The workout is still starting. Try again in a moment."
- Step 2, demo accounts: `scripts/seed-steps-demo.ts` adds `steps-ride@demo.local` (FTP 180, bike LTHR 171) and `steps-noftp@demo.local` (no thresholds), each with the mockup ride as today's session.
- Step 3, the clock on the phone: each server reply sets the offset of the phone's clock. A tap is queued with a client id and its time in server time (localStorage `rideEventQueue`), applies on screen at once, and goes to `sendRideEvent` in order with that time. The client times a queued tap as the server will (`withQueued`: after the last event or heartbeat, never in the future), so the screen does not jump when it is stored. A tap the server refuses for good (the ride has ended) is dropped and the ride read again; a conflict reads the ride and sends again; offline, cut off or a stale bundle keeps it queued (retry on `online`, every 30 s, and on the next page).
- Step 3, saving steps: each ended step of the timeline is logged through `useWorkoutSetWriter().logWithRetry` (the pending queue, so offline and stale-bundle handling are the set list's own). The phone keeps a signature of what it saved per program set (localStorage `rideSavedSteps`); a step saves again only when its status, time, offset or extension changes (an undo, another device). The upsert on session and program set keeps one row. `logWorkoutSet` takes `stepStatus` (done, partial, skipped), `targetOffsetW` (±50), `extendedSeconds` and `sources`; a save without them (the set list) keeps them.
- Step 3, `ended_early`: written by the server when it settles a ride's status (`settle` in `src/lib/actions/rides.ts`), so an auto end also marks it; an unskip that makes the ride live again clears it.
- Step 3, finishing the workout: when the ride ends, a program with only this exercise finishes its workout through `completeWorkoutSession` (queued in the pending queue when it does not reach the server), with the ride's end as its end time, and the active workout is cleared. A program with more exercises keeps its workout open; the rider finishes it as before. The flush of set overrides that the finish page also does is left out: a bike exercise has none.
- Step 3, compliance: an ended-early workout does not match a key session (link or app match); the session stays planned (or unconfirmed on a later day). A support or optional session still counts it.
- Step 3, after the ride: the bike screen shows "Ride done" (or "Ride ended early") for the last ride of the exercise started in the last 12 hours, with Done (home for a one-exercise program, else the workout) and Log by hand; Start ride is hidden then. A ride that ended while the app was closed, with its one-exercise workout still open, shows "Save the ride", which opens ride mode to save its last steps and finish the workout. `?ride=1` shows the live ride, or such an ended ride; else the bike screen.
- Step 3, Resume prompt: ride mode opened on a running ride without a tap (a reload, the app reopened) shows "Ride running" with Resume and "End at the last step", because sound and the wake lock need a tap on iOS. Start ride and the bike screen's Resume unlock both inside their tap, so they open ride mode straight. "End at the last step" sends `end` at the current step's start; the server moves it to its last event or heartbeat if later, so a step with seconds ridden after that saves as partial.
- Step 3, controls: ±5 W and +1 min sit in one row on both modes (4.1 lists +1 min outdoors too; the outdoor mockup has no room shown for it, the row is kept for the same controls everywhere). ±5 W shows only on a step with watts and stops at ±50 W. Lap shows outdoors and on a lap step. Undo of ±5 W or +1 min applies only while the same step runs; Undo of a skip sends `unskip`. The undo toast is inline under the target, as in the mockup.
- Step 3, paused: the line under the clock is "Paused 2 min" without "alerts stopped", as there are no alerts before step 6. End ride is only on the paused screen, as in the mockup.
- Step 3, landscape: the app covers landscape with "Rotate your phone" on every screen; ride mode is left out of that cover (CSS `:has([data-ride-mode])`). The web manifest keeps `portrait-primary` (review decision): iOS ignores it, the owner rides with iOS, and an Android home-screen app stays portrait. Landscape is a phone on its side (height up to 600 px): header with the step name, clock left, target and Next right, all controls in one row.
- Step 3, outdoor screen: no mini profile, as in the mockup. The big number is the outdoor target (heart rate in bpm, or the effort); the second line is "Power meter" watts and the effort of a 3 to 5 min step.
- Step 3, D14: a planned session whose program is all bike (`sport` bike) redirects from `/planned/[id]/play` to its first bike exercise with `?ride=1&planned=<id>`, so a new workout links the planned session. The e2e specs of the old player (`guided-program`, `guided-workout`) now ride a run program.
- Step 3, e2e clock: the server's clock cannot be faked, so `e2e/bike-ride.spec.ts` pauses the page clock once the ride runs and moves the stored ride and its events back by as much as it runs the page clock forward.
- Step 3 review, queued taps first: a heartbeat waits while taps are queued (the server never places an event before its last heartbeat); the tick sends the queue instead. A tap leaves the queue only on "The ride has ended", "Not found" or "Invalid input"; a server error or conflicts that go on keep it queued and show "Saved on this phone". The queue is written read-modify-write by client id, so two tabs of one ride keep each other's taps, and the sign-out warning counts it.
- Step 3 review, clock: the offset comes from the reply with the quickest round trip (half the round trip after the request left), and moves again only when the clocks differ by more than 500 ms or the round trip. A step back under 2 s holds the clock until it catches up; a larger one is a real correction and applies. Each count beep plays once per step and second.
- Step 3 review, Undo of a skip that ends the ride: the done screen shows "Skipped · Undo" for 5 s and the workout is finished only after it; Undo sends `unskip` and the ride goes on. A skipped row whose step runs again (an undo here or on another phone) is removed with `unlogWorkoutSet`, and the step saves when it ends.
- Step 3 review, `sources` takes the result field names only (`RESULT_FIELDS` in `src/lib/validators/workout.ts`). Start ride that fails lets go of the wake lock asked for in the tap.
- Step 4, where the screens live: the bike exercise route. A ride of the exercise that ended in the last 12 hours turns the bike screen into its summary (`RideSummary`); `?results=1` is its results table (`RideResults`), which ride mode opens when the ride ends. The summary's Edit and Add numbers open the table. "Ride done" and its Log by hand link are gone from the bike screen. The summary's Done goes home (a one-exercise program) or to the workout, or reads "Save the ride" as before.
- Step 4, Later: leaves the table without a save, to the same place as the summary's Done. Opening the exercise again shows the summary with "Plan only · no ride numbers · Add numbers" (no line in the table itself without Garmin; the mockup puts that row in the empty states).
- Step 4, what a step shows: its `workout_sets` row; a step the timeline ended whose save has not arrived shows the timeline's status and time, so the table and summary never wait on the queue. The table's time column is the clock's time (read only), "Skipped" or "Not ridden"; only ridden steps take numbers.
- Step 4, saves: Done sends `logWorkoutSet` per ridden step through `logWithRetry` (the offline queue), only for steps whose numbers or effort changed, with the clock's time, status, offset and extension as stored. Only the fields the rider changed are sent, each with source `typed` (a Garmin value the rider types over becomes typed; one left alone stays Garmin). An emptied field is sent as null and loses its source. `logWorkoutSet` takes `avgPower`, `avgHr`, `maxHr`, `avgCadence`, `avgSpeed` (m/s) and `climbM` and writes each only when sent; a write with `sources` (ride mode, the table) also keeps the stored distance and RPE when it sends none, and merges its sources into the stored map. So the clock's later save of a step never wipes what was typed.
- Step 4, effort once per ride: stored as `rpe` on every ridden step (no new column), so `weightedRpe` gives the ride's effort and the existing effort load reads it. Skipped steps get none.
- Step 4, outdoor More numbers: max HR, distance, average speed and climbing (4.1 lists max HR outdoors too). Distance and speed follow the user's units; climbing is always metres.
- Step 4, numbers (`doneRideNumbers` in `src/lib/utils/ride-numbers.ts`): the ridden steps are done and partial ones with time; skipped and not ridden steps are left out, so an ended-early ride counts only what was ridden. kJ shows only when power covers 90% of the ridden time (avg power x all ridden seconds would guess the rest). The effort load is marked "est." too, as the No Garmin mockup says. Time in zones uses the plan's frozen FTP; steps without power are left out. NP and IF stay null until step 7 fills them from a stream.
- Step 4, plan against done: the plan column is the step's planned watts without "W" ("135-146", "under 97"), or the target as written with no FTP; outdoors the outdoor target, and done is the avg HR against a heart rate target. ↓ when done is under the low end of the plan (not the rider's ±5 W offset: the table compares with the plan). An "under" target never shows ↓; there is no ↑.
- Step 4, the load in `appSessionLoads`: a bike session whose step rows have power on 90% of the ridden time, with the FTP of the step snapshot (else today's), gets method `bike_power` with the estimated power load; else the existing effort or no load. The Garmin series takes it as method `power` and pairs it with a Garmin ride of the same day as before, so it is never added twice.
- Step 4, Log by hand (`?hand=1&mode=`): the same table in the mode the bike screen showed, with a time per step that starts at the plan's (empty on a lap step). Done saves each step with a time as done, time source typed, into the phone's workout session (else the user's open workout of the program from the last 8 hours, which also fills the table on a second visit) and goes back to the workout. No ride is made, so no summary follows. Hidden and refused while a ride runs.
- Step 4, a revisit after the workout finished: the workout layout starts a new, empty workout session when the exercise is opened again (the app does this on any workout page). The summary reads the ride's own session, so it is not affected.
- Step 4, demo accounts: `steps-hand@demo.local` (FTP 180, LTHR 171, the mockup ride) for the Log by hand journey.
- Step 4 review, typed step times: 1 or 2 digits are minutes, 3 or 4 digits are minutes and seconds ("1530" is 15:30), and a dot or comma reads as a colon. A time over 4 x the planned time (at least 10 h) is marked and blocks Done; the server refuses a step write over 12 h (the step model's limit). The empty field says "Minutes".
- Step 4 review, the step as planned: a ride write (one with `sources`) on an existing row keeps its stored `plannedStep`, so results typed after an FTP change keep the ride's targets and load.
- Step 4 review, the workout list: when a ride ends, the server logs the step sets the ride never runs (the recovery after a repeat's last round) as `not_done` (`logDroppedSteps` in `src/lib/actions/rides.ts`), and `getActiveSessionCompletedProgramSetIds` counts every step row with a status, so a finished ride reads as done; an ended-early ride stays partly done. Ride mode marks the same sets on the phone at the end. For an endurance user's bike exercise with steps, the ring opens the exercise. The ring of any other exercise logs and un-logs with `bulk`, and the server then leaves a row with a step status or sources as it is.
- Step 4 review, small points: a load that rounds to 0 shows no tile; by hand, a cleared time un-logs that step through the queue; a field typed back as it shows (a speed at one decimal) is no change; by hand, the rows go to the workout the table read, and the phone's active workout moves to it.
- Step 4 review, effort per step: the ride's effort is `rpe` on each ridden step, so readers of per-set RPE (history, the set list, `get_step_results`) show the ride's effort on every step.
- Step 5, `test` storage: a column `program_exercises.ride_test` ("ramp" or "20min"), migration `0099_program_exercise_ride_test.sql`. A tree with `test` sets it, a tree without clears it, a set list leaves it. The step editor keeps it (its tree is built with it), and the copy paths (share, export and import, one-day copy, restore) carry it. `get_program` shows it as `rideTest` on the slot.
- Step 5, refusals: the step check stays the one rule set. Before it, the tool says plainly the mistakes the brief names: a gradient (or a `gradient`, `grade` or `climb` key) is "never a target: write the climb in the step's note", speed "is a result, not a target", and an outdoor target with an `end` "changes only the target, never how the step ends". A ramp with `target2` now reads "a ramp takes no cap". These hints are on the `workout` tree; a set list is checked by the tool's input schema first, whose message names the unknown metric or key.
- Step 5, the assistant's results: a source `assistant` (`RESULT_SOURCES`). On a logged step it writes each field it sends with that source, over an empty, clock or assistant value, never over a typed or Garmin one (`assistantStepWrite`). A value with no source (the run player, the old results form) is replaced, as today. Effort and notes are only filled where empty (they carry no source, and the rider types them). A step logged as done or partial stays so. The reply lists each kept field with `typed`, `garmin` or `logged`. Steps the call does not name keep their row; it keeps its plan copy.
- Step 5, `log_step_results` by session: it also takes `workoutSessionId` (attach only), so a ride with no planned session takes results; `get_step_results` by `workoutSessionId` reads such a session too. The plannedSessionId path for run and swim works as before, except that an assistant write over a logged step now keeps the fields it does not send.
- Step 5, D9 for results: `log_step_results` refuses while a ride runs or is paused (by its timeline, so a ride that ran out is not held back) on the session it would write: the session given, the one linked to the planned session, or any open workout of the planned session's program (a ride started from the program has no planned session). The check is in the save path (`saveProgramStepResults`, `saveSessionStepResults`), so the app's own result saves obey it too. No tool writes ride events.
- Step 5 review, the frozen plan on every save: a step save to a session with a ride takes its plan copy from the ride's plan and its FTP (`rideStepSnapshot` in `src/lib/ride-plan-db.ts`), not from the program as edited since; the plan now also freezes its dropped steps (`RidePlan.dropped`), and the end of the ride logs only those as not done, so a set added during the ride is not this ride's. A plan frozen before that field logs the program's live sets as before.
- Step 5 review, keys by session: for a session with a ride, `log_step_results` and `get_step_results` key its steps by the ride's frozen plan (the keys `get_ride` lists, without the `e2:` prefix of a multi-exercise program). For another session by `workoutSessionId`, a call is refused when a logged step no longer matches the program's step on its program set.
- Step 5 review, only named steps: an assistant write by session adds no row for a step it does not name. A sent value equal to a typed or Garmin one keeps that source. A done step sent as partial stays done.
- Step 5 review, the guided player's save: it leaves the ride numbers it does not send (avg power, max HR, cadence, speed, climbing, avg HR), and a field it writes loses the source another writer gave it.
- Step 5 review, an unknown target metric (a gradient, a speed) is refused with the plain reason by the target schema itself, so a set list says it too.
- Step 5 review, restore across migration 0099: a revision stored before `ride_test` existed has no `rideTest` in its snapshot, so a restore of it keeps the exercise's current FTP test (the restore writes only the keys the snapshot holds).
- Step 5, `get_ride`: read only. It takes the status from the timeline and does not store it, so a read changes nothing. Load methods use the `get_training_load` names (`bike_power` for the estimate from step averages, `srpe` for effort). `np`, `intensityFactor`, heart rate zone minutes, drift and time on target are present and null until step 7, with `stream: false`.
- Step 5, endurance gate: as the other endurance tools, the route registers `get_ride` only with endurance features on; `get_ride` and `log_step_results` also check the switch, as the app's actions do, so a user turned off in the middle of a connection is refused.
- Step 5, privacy: no new data class. The record and the policy now name rides and the sources among what a connected assistant reads, and the assistant's ride numbers among what it writes. `LEGAL_VERSION` stays at the branch's `2026-11-17.1`, which is not released yet and covers this.
- Step 5, the resource doc example uses `v` 2 and names the mockup ride "Tempo 2 x 15": the doc test reads every ride with "endurance" in its name as an easy ride. The plan page's recovery `{ "high": 55 }` is not a valid target (a range needs both ends), so the doc uses zone 1.
- Step 6, push off in prod: the owner chose not to wire VAPID keys in this build. `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are optional in `src/lib/env.ts` and checked only when set; one or two set without the rest refuses to boot. With none, no send loop runs, no alert rows are written, and the bike screen shows "Step alerts are off" with no Turn on (the cleanest honest state: there is nothing the rider can do). The keys, the ExternalSecret and the owner's locked-phone check are a BACKLOG entry. There is no committed `.env.example` (`.env*` is gitignored), so the vars are documented in `docs/OPERATIONS.md`.
- Step 6, the service worker: `src/app/sw.ts` (Serwist) is never built, because `next build` runs Turbopack and `@serwist/next` hooks only into webpack (no `sw.js` in the build, BACKLOG). Step alerts use their own push-only worker, `public/push-sw.js`, plain JavaScript served as it is, registered with the scope `/push/` on the Turn on tap: it has no fetch handler and controls no page, so it changes nothing about how the app loads. `src/app/sw.ts` is left as it was. The middleware lets `/push-sw.js` through without a session, as the browser fetches it for updates on its own.
- Step 6, the Turn on row: below the step list, before the start only (as in the mockup). States: push off on the server ("Step alerts are off", no action); an iPhone or iPad outside the home-screen app (the whole row links to `/more/install` with "Add the app to your home screen first"); a browser with no push ("This browser cannot show them"); notifications denied ("Notifications are blocked in your phone's settings"); else Turn on. The row goes once alerts are on. No Turn off in this build (the mockup has none); sign-out turns them off for that device.
- Step 6, when alerts are written: every event (start, pause, resume, skip, unskip, extend, nudge, lap, end) deletes the ride's `ride_pushes` rows and, while push is on and the user has at least one device, writes them again from `rideTimeline` at the server's now (`ridePushSchedule` in `src/lib/utils/ride-pushes.ts`). A heartbeat writes none (it does not change the timeline). The rewrite runs in a savepoint of the event's transaction, so a failure loses the alerts, never the event. Each alert goes to all of the user's devices.
- Step 6, what is scheduled: a step change at each step's end and "1 min left" a minute before it, only while the ride runs, from the current step on until a step with no end time (lap or open distance), whose start is the last alert. A step of 60 s or less gets no minute alert. The last step's end sends "Ride done" with "Step 5 of 5 · Cool-down done": it is the last step change, and a rider with a locked phone needs to know the ride is over. The "next" in a minute alert is the step word without its round ("next Work 152-170 W"); a step change's title keeps the round ("Work · 1 of 2 · 152-170 W · 15 min"). Times in alerts never use a colon ("1 min 30 s"), unlike the screen's "1:30".
- Step 6, sending: the loop claims due rows with DELETE … RETURNING every 5 s, one run at a time per pod. Of several due alerts of one ride only the latest is sent (one tag per ride would replace the others at once). An alert more than 60 s late (a pod was down) is dropped, as is one whose ride had a heartbeat in the last 15 s. Pushes go with `TTL` 60 s and urgency high, and with no web push `Topic` header (step 6 review: it would show the push service the ride id). A device answering 404 or 410 is deleted; other errors are logged as `[ridePush] send failed` with the ride id, the device id and the status only. The notification uses the tag `ride-<id>` with `renotify`, so a replacing alert still sounds; a push without a usable payload still shows a notification (Safari).
- Step 6, devices: `savePushSubscription` is an upsert by endpoint, so a phone signed in as another user moves to that user; `deletePushSubscription` deletes only the caller's row. Sign-out deletes the device's row on the server and unsubscribes in the browser (`forgetStepAlerts`), and `clearLocalUserData` also unsubscribes, so a shared phone does not get the last user's alerts. Turn on refuses while push is off on the server.
- Step 6, `web-push` 3.6.7, pinned: 4.0.0 came out on 2026-11-06, 12 days before this build; 3.6.7 is the long-stable line with `@types/web-push` 3.6.4. The library is maintained (the 4.0.0 release).
- Step 6, privacy: new data classes (push subscriptions, alerts waiting to send) and a new recipient (the browser's push service) are in the record and the policy. `LEGAL_VERSION` stays at the branch's unreleased `2026-11-17.1`, which covers it. The transfer basis for the push services is added to the open lawyer-review entry in BACKLOG.
- Step 6, the manual check on the owner's phone: not done. Prod has no keys, and the dev environment runs over plain HTTP on the laptop, which an iPhone home-screen app cannot use for push. It is part of the BACKLOG entry that turns the keys on.
- Step 6 review, device addresses: our server posts to each device's push address, so `savePushSubscription` accepts only the push services' hosts (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, any host ending in `.push.apple.com` or `.notify.windows.com`), over https on the default port, with no IP address and no user name in the URL. A user keeps at most 10 devices; saving an eleventh deletes the oldest (by when it was saved for this user).
- Step 6 review, a push service that hangs: each send has a 10 s timeout, and one loop run that throws or times out is logged as `[ridePush] loop failed` and lets the next run go (`ridePushTick`), so one bad host never stops alerts for everyone.
- Step 6 review, empty env values: an empty `VAPID_*` value counts as unset, so an ExternalSecret with an empty field leaves push off and the pod boots. One or two real values without the rest still refuse to boot.
- Step 6 review, links in the service worker: a payload or notification link is used only when it starts with "/" and resolves to the app's own origin; "//host", "/\\host" and full URLs open the app's home.
- Step 6 review, sign-out during a stale bundle: if removing the device row hits a stale bundle, the reload can race the move to /login. Left as is: the browser still unsubscribes, the next send gets 410 and the server deletes the row.
- Step 6 review, an alert after a new event: the loop sends rows it already claimed, so an event in the same moment can still let one old alert out. Left as is: at most one stale alert.
- Step 7, where the fill runs: `fillRidesFromGarmin` (`src/lib/ride-garmin.ts`) runs at the end of every Garmin worker tick, after the activity files and streams of that tick are stored, for users with Garmin access. It looks at the user's rides of the last 7 days that have ended by their timeline and have no fill yet, so the order of ride end and Garmin upload does not matter (an activity stored before the ride ended fills on the next tick).
- Step 7, the activity's times: `garmin_activities.start_time_local` is local time stored as UTC, so the match reads the real start from the FIT session (`startTime`, else `startTimeGMT`) and the end from its elapsed time. Stream time 0 is the first record's time, which the FIT parser now keeps as `session.firstRecordTime` (no parser version bump: a file stored before falls back to the session start, the same second in Garmin's files), used for laps, timer events and the time split.
- Step 7, match and Pick: a declined pair still counts as a match, so after an Undo with two matching rides nothing fills on its own. Pick lists every match with its start and length ("16:30 · 30 min") and fills from the one tapped; a declined pair can be picked again (the rider asked for it). With 3 or more the row says "Three Garmin rides match".
- Step 7, the split: the steps are the timeline's ended steps with ridden time (a step skipped at once has no window). Laps split when there is one lap per such step and each lap's timer time is within 10% of the step's ridden time; else each step is its own start to end on the wall clock from the ride's timeline, less the rider's pauses in the app (`RideTimeline.pauses`, gaps in the step's window), on stream time (`splitRide` in `src/lib/utils/ride-stream.ts`). Step 7 review: the first build laid the steps one after the other on Garmin's timer time from the activity start, which shifted every step when the watch started before the app, shifted later steps on Garmin's auto-pause, and gave a second ride in the same activity the first ride's data.
- Step 7, step averages: time-weighted by sample duration (`sampleDurations`, gaps over 10 s count 0). Power counts its zeros (coasting is riding), heart rate and cadence leave zeros out, as Garmin's own averages do. Max HR is the window's highest sample. Outdoors speed is the window's distance over its moving time, climbing uses the altitude deadband of the decoupling code (now `climbMeters`). Indoors no distance, speed or climbing (D12). Cadence fills in both modes.
- Step 7, what fills: only rows of done or partial steps, and per field only an empty value or one with source `clock`. A value with no source (an older writer) is not empty and stays. The fill row stores per program set each field's old value and source, the split method and the mode it corrected.
- Step 7, Undo: restores a field only while Garmin still holds it (a value the rider typed over after the fill stays), restores the mode when it is still the corrected one, and marks the pair declined. The results table no longer says "Waiting for your Garmin ride" after an Undo.
- Step 7, mode correction: `isIndoor` of the activity type (indoor or virtual) is Indoor, every other bike type Outdoor. It sets `rides.mode`, the frozen plan's `mode` (the summary, the table and get_ride read the plan) and `workout_sessions.ride_mode`; the steps and targets are not changed (both modes are in the plan). The fill then writes the fields of the corrected mode.
- Step 7, stream numbers: worked out when shown from the filled activity's stream cut to the ride's own part (its first step's start to its last step's end; step 7 review, so a second ride in the same activity or minutes on the watch before Start ride do not count), never stored, and only while the fill stands (an undone fill shows the step-average numbers again). NP and the load reuse `normalizedPower` and `powerLoad` (`src/lib/garmin/analytics/load.ts`) with the frozen plan's FTP; load = moving hours x IF^2 x 100. Avg power and kJ come from the stream too (Garmin's totals, check 8); the time tile stays the ridden time of the steps.
- Step 7, drift: efficiency is avg power / avg HR as 4.6 says, not NP / HR as the Garmin page's decoupling (`decoupling.ts`) uses, so the two pages can differ on an interval ride. Halves split the samples of the steps left after warm-up and cool-down by their time. "steady" is under 5% (a negative drift is steady too). Rides of 60 min of moving time or more.
- Step 7, time on target: against the plan's watts (not the rider's ±5 W offset, as the table's ↓ compares with the plan); a ramp counts between its start and end watts, an "under" step at or below its cap. Outdoors a heart rate outdoor target; a step with an effort target or none has no value. Shown as "82% on target" under each step's done value (the mockup has no column; a fourth column does not fit 320 px).
- Step 7, zones: the zone bar shows power zones; heart rate zones (Friel, `bikeHrZone`: zone 2 from 81% bike LTHR, 3 from 90, 4 from 94, 5 from 100) show only when there are no power zones (an outdoor ride without a power meter). get_ride lists both.
- Step 7, the chart: x is the ridden time of the steps (the rider's app pauses left out; Garmin's timer pauses for a lap split), 30 s means (at most 120 points), target bands from the plan's watts (a ramp as its range, an "under" step from 0 to its cap), heart rate dashed on its own scale with its average as the label "HR 142". Without power the chart shows heart rate only, with no bands.
- Step 7, get_ride: `stream` true with a standing fill; the load method is `power` from the stream (`bike_power` stays the estimate); a new `garmin` field gives the state (filled, pick, none), the activity id, whether a fill was undone, the split and the matches; each step gets `timeOnTargetPct`.
- Step 7, training load: nothing changed. The Garmin series counts the Garmin activity's own load and pairs the app ride with it by sport and day (`pairWithGarmin`), as the step 4 test shows; the app's own load of a filled ride is used only by a user without Garmin days.
- Step 7, privacy: `ride_garmin_fills` holds the user's own ride numbers and a Garmin activity id: no new data class or recipient, so `LEGAL_VERSION` stays at the unreleased `2026-11-17.1`. It is in the export, goes with the ride or the account, and with "Disconnect and delete Garmin data" (`deleteGarminData`); the numbers already filled stay in the training log, as the assistant's or typed numbers do.
- Step 7, demo account: `steps-garmin@demo.local` (admin, as Garmin is Premium only; FTP 180, LTHR 171) has the mockup ride ridden 10 min before the seed and a synthetic Garmin activity made in the seed, filled by `fillRidesFromGarmin`. Journey J4 of `scripts/journeys/ride.journeys.ts` captures its summary and Undo. The home's "Do Again" link logs a Next.js prefetch warning in dev; it is not from this step.
- Step 7, the owner's check (section 8, totals match Garmin Connect): not done, it needs a real ride. NP here is from the stored stream with Coggan's 30 s rule; Garmin Connect's NP can differ by a watt or two.
- Step 8, the ramp template: warm-up 10 min as a ramp from 60 to 100 W (absolute, so it works with no FTP set), then 21 steps of 1 min at 100, 120 ... 500 W (absolute watts, each its own step: a repeat cannot hold rising targets). 22 sets fit the tool's 50-set limit and the 100-node tree limit. The first 1 min step's note says "Tap Lap when you cannot hold the watts. That ends the test."
- Step 8, how a ramp test ends: in a ride whose plan has `test: "ramp"`, Lap or End ride on a work step finishes the ride (status finished, not ended early, so a key session counts it); the step it ends is partial, or left out with no second ridden. Lap on the warm-up works as on any timed step. Ride mode shows Lap indoors on the 1 min steps, with the line "Tap Lap when you cannot hold the watts". The ride ends when all 21 steps are done too.
- Step 8, the 20 min template: warm-up 13 min in power zone 2, 1 min hard (effort 9), 5 min easy (zone 1), 1 min hard, 5 min easy before the test (zone 1), 20 min all-out (effort 9-10, an effort so an old FTP does not pace it), cool-down 10 min (zone 1): 55 min. The warm-up part is 20 min, as 4.9 says; the "5 min easy" is the last recovery. The all-out step is the longest work step on time (`allOutStep`).
- Step 8, outdoor targets of a test ride (overrides the step 2 line on work ramps): no heart rate cap or range. Each step gets the effort of its zone as without a bike LTHR; a step whose own target is an effort keeps it; a work ramp takes the effort of the zone of its top end. A written outdoor target still wins. `outdoorTarget` takes the test, and the frozen plan stores `test`.
- Step 8, the power a test reads: the Garmin stream while a fill stands (ramp: the best rolling 60 s of the whole activity, held 1 s values, gaps over 10 s count nothing, `bestRollingPower`; 20 min: the all-out step's window average, `stepPower`), else the step's average power in the results table (typed, filled or written by the assistant). A ramp needs at least one 1 min step done; with no number on the highest done step its planned watts count (basis "target"). A 20 min test needs its all-out step done (a partial one is not 20 min). An FTP out of the threshold range (50-600 W) gives no proposal.
- Step 8, Save: `saveRideFtp` takes only the ride id and works out the FTP again on the server from the ride (`rideReport`), so the client never sends a value. It adds the row through `addThreshold` as the training numbers page does: source `test`, protocol `ftp_20min` (input `avgPower20`) or the new `ftp_ramp` (input `best1MinPower`, FTP = 0.75 x it, `RAMP_FTP_FACTOR`), measured on the ride's date in the user's zone. `ftp_ramp` is now also a field test on the training numbers page and in `manage_thresholds` (no DB constraint on the text column, so no migration). Endurance features only, as rides are.
- Step 8, Saved: the line reads "New FTP 186 W · Saved" with no button when the current FTP is the one the test gives, so a second Save adds no row. Without a result there is no line (a 20 min test with no watts already shows "Plan only · Add numbers").
- Step 8, the editor: "Insert FTP test" (bike only) opens a sheet with Ramp test and 20 min test; the choice takes the place of the steps and the tree carries `test`, saved with Save steps as any edit. Editing the steps after keeps the test; there is no control to clear it except a new tree (the assistant) or a new insert. A program's name stays.
- Step 8, the assistant: `edit_program_exercise` takes `ftpTest: "ramp" | "20min"` in place of `sets` or `workout` and writes the app's template (sending two of them is refused). `get_ride` gives `ftpTest`: test, power, its basis, `proposedFtp`, `currentFtp`, `saved`, `measuredOn`, and the protocol and testData for `manage_thresholds`.
- Step 8, demo account: `steps-ftp@demo.local` (FTP 180) has the 20 min test ridden 10 min before the seed, the all-out step typed at 196 W. Journey J5 of `scripts/journeys/ride.journeys.ts` captures the line and Save at 390 and 320 px.
- Step 7 review, one ride that fails: each ride in `fillRidesFromGarmin` runs in its own try/catch, logged as `[fillRidesFromGarmin] failed` with the ride id, and the other rides still fill.
- Step 7 review, cost: matching (`rideMatches`) reads only bike activity types (filtered in SQL as `sportOf` reads them) and their summary and session times, never streams; the streams, laps and events are read (`loadActivity`) only for the one activity that fills, or that the summary and get_ride show for a standing fill. A ride with a standing fill is skipped before any query; a pick-pending or undone ride reads no streams.
- Step 7 review, Undo is not for good: Undo first asks "Remove the Garmin numbers?" with Keep and Remove (a question, not a 5 s toast, as the summary has no toast). After an Undo with one matching ride the summary shows "Garmin numbers removed · Fill from Garmin" (state `refill`), which fills that pair again through `pickRideActivity`. The worker still never fills a declined pair on its own.
- Step 7 review, Pick in one transaction: `pickRideActivity` locks the ride row, checks for a standing fill, removes the declined marker of the picked pair and fills in one transaction, so a failure keeps the marker; `fillRide` locks the ride row too, so a worker fill and a Pick wait for each other. A partial unique index (`uniq_ride_garmin_fills_standing`, migration `0102_ride_garmin_fills_standing.sql`) allows one standing fill per ride.
- Step 7 review, samples more than 10 s apart: they count no time (`MAX_GAP_S` in `src/lib/garmin/analytics/load.ts`, as the Garmin pages do), so a gap in the recording is left out of the step averages, NP and the zones, not filled in.
- Step 7 review, power dropouts: NP holds a missing power sample as 0 W (`normalizedPower`, the existing helper the Garmin pages use). Left as it is, so the ride and the Garmin page agree; a sensor dropout lowers NP a little.
- Step 7 review, losing Garmin access: Undo, Pick and Fill from Garmin need Garmin access (`garminAllowedFor`), so a user who loses it (no longer Premium) cannot undo a fill. The numbers stay as filled, marked Garmin, and the user can type over them.
- Step 8 review, a ramp that ran out on the clock (hub): when every 1 min step ended on the clock with no Lap or End ride, the planned watts give no FTP (the test never reached failure). Watts from the stream or the results table still give one. An FTP from planned watts (basis "target") shows as "New FTP 195 W est." and can still be saved; get_ride says `powerBasis` "target" and `estimate` true.
- Step 8 review, Saved: it means a live FTP row with source test, the test's protocol, measured on the ride's date and with this value (`testThresholdSaved`), not a current FTP that happens to match. A newer FTP after the save keeps the test Saved. `saveRideFtp` passes `once` to `addThreshold`, which now takes the `athlete_threshold:` advisory lock for every add and, with `once`, keeps such a row instead of adding one, so two saves at once add one row.
- Step 8 review, a ramp ended early (hub): Lap or End ride before any 1 min step is done ends the ride as ended early, as on a plain ride. The warm-up being done does not count, as it gives no FTP.
- Step 8 review, outdoors with no FTP: the ramp's 1 min steps have no zone, so `buildRidePlan` gives those with no outdoor target a rising effort, 5 on the first step to 10 on the last (`rampEffort`).
- Step 8 review, the best minute from the stream: only the samples inside the windows of the ridden work steps (the step 7 wall-clock windows, the rider's pauses left out), so a sprint in the warm-up does not count.
- Final review, finishing the workout ends its ride: `completeWorkoutSession` ends a running or paused ride on the session with an `end` event at the server's time (seq + 1, client id `workout-finished-<ride id>`), so the timeline ends it there: done steps stay, the step that ran saves as partial, the steps not ridden are not done, the alerts go. `settle` (now `src/lib/ride-settle.ts`, shared by the ride actions and the finish) does the same for any live ride whose workout is completed (the stale sweep too), so `startRide` and `getRide` never see it as live and a later tap gets "The ride has ended". A ride over an hour old ends this way when the user opens another program's workout (the sweep closes sessions older than 1 h); accepted, as that workout was already closed.
- Final review, Save the ride in any program: the summary offers "Save the ride" while the workout is open and either the program has only this exercise (it finishes the workout, as before) or a step the timeline ended has no `workout_sets` row yet (`unsaved` in `rideAfterView`, `offersSaveTheRide`). In a program with more exercises it opens ride mode, which saves the steps and goes to the results table; the workout stays open for the other exercises.
- Final review, Ride again (owner's decision): the summary of a ride that ended early offers "Ride again" above Done. It starts a new ride of the same exercise on the same workout session, in the ride's mode, through `startRide` with `again: true`; only then may `startRide` take a finished workout, and only when the session's latest ride is this exercise's and ended early. It opens the workout again (`is_completed` false, no end time) in the transaction that stores the ride. The earlier ride's saved steps stay until the new ride saves the same steps over them (one row per session and program set). It is hidden while "Save the ride" shows, so the earlier ride's last steps are saved first. A finished ride keeps its 12 h summary with no restart.
- Final review, sources from a client: `logWorkoutSet` takes only `typed` and `clock` as a field's source (`CLIENT_RESULT_SOURCES` in `src/lib/validators/workout.ts`). `garmin` is set only by the Garmin fill (`src/lib/ride-garmin.ts`) and `assistant` only by the assistant's step results (`assistantStepWrite`), which write the rows on the server and do not go through that validator.
- Final review, journey review: after Ride again, the second ride's results table and summary read the session's step rows, so a step only the earlier ride reached shows that ride's time and numbers (and the effort stays on those rows). Accepted with the decision that the earlier saved steps stay. The home's "Do Again" and Start links log a Next.js dev message, "encountered dynamic data during prefetching", for the workout route: it comes from `prefetch={true}` on those links (home widgets, on `main` before this branch) to a route that reads the session, so it is not from this build and is left as it is.
- Final review, the undo toast in portrait: it now takes the Next card's place below the ±5 W row (as in landscape), not a row between the target and the controls. Inline under the target it pushed the controls down by a row, so a second quick tap on +5 W landed on Undo. At 320 px the Next card and "Hold to skip" use 14 px text so each stays on one line.
- Final review, a full log by hand: a ride write (`logWorkoutSet` with `sources`) on a session with no ride of that exercise checks whether every step the ride would run has a row; then the server logs the steps a repeat drops as not done (`logDroppedStepsByHand` in `src/lib/ride-settle.ts`, the same rows `logDroppedSteps` writes when a ride ends), so the workout list reads the exercise as done. Clients still cannot send not done. Save the ride goes through ride mode, whose ended ride already logs them.
- Final review, one source for the planned numbers: the workout screen's totals for a bike exercise come from `plannedRideNumbers`, as the bike screen's do, so both say "65 min · load about 55" (the dropped recovery is not counted, the load is the ride's as a whole). The header reads the indoor plan, which differs from an outdoor default only on a distance step. A program with other exercises adds the ride's numbers to theirs.
- Final review, toasts and pinned bars: a screen's pinned bottom bar carries `data-pinned-bar` (the bike screen, the results table, the summary), and a toast sits 8 px above its top (`usePinnedBarBottom` in `src/contexts/toast-context.tsx`), so "Synced 1 pending set" no longer covers Done. Screens without such a bar keep the toast above the bottom nav.
