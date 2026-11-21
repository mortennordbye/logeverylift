# Run logger

Status: built. Steps 0 to 8 are built on `feat/run-logger` (2026-11-21). Push alerts stay off until the VAPID keys are set.
Plan page with the pictures: https://claude.ai/artifact/A8QRyLwG2PviN3WBauvDtu.
A copy of the page is in the repo: `docs/design/run-logger.html` (open it in a browser).
This brief is the same plan in text. It is written so that an agent with no conversation history
can build it from start to end with **no input from the owner**. Every decision is made (section 2).
Four reviews (code, running coach, screens, logic) checked version 1 of the plan on 2026-11-20.
Their findings are in this brief. Names marked *new* do not exist yet.

This is the run version of [`bike-ride-logger.md`](bike-ride-logger.md), which shipped in PR #256.
Read that brief first (sections 2 to 5 and 9). This brief uses its words (ride, event, timeline,
fill) and changes only what a run needs.

## 0. How to work on this brief

1. Read `CLAUDE.md` (repo) and the owner's global rules first. They apply in full: a live status
   page, screenshots of each step next to the mockup, no trailers on commits, STE-style prose, no
   colons or em dashes in UI copy, monochrome plus one accent.
2. Build the steps in section 6 in order, 0 to 8, on one branch `feat/run-logger`, the same way
   as the bike build. One PR at the end, green CI, squash merge, deploy check. If the owner asks for
   one PR per step at the start of the build, do that.
3. Do not ask the owner. When this brief does not settle a detail, pick the option closest to the
   rules in section 4 and the mockups, write it in section 10 ("Choices made during the build") in
   the same commit, and go on.
4. Stop only for the things the owner's global rules name: something that cannot be undone outside
   the plan (the step 1 data move is in the plan and approved), secret values, or prod data other
   than what step 1 says.
5. **Never deploy while the owner trains.** Before the merge, check prod for an open workout
   session of the owner with sets logged in the last 2 hours. If one is open, wait.
6. Run mode is a critical flow (timers, set logging). Steps 3, 4 and 6 each get `make e2e`, the
   CLAUDE.md smoke pass and a `journey-review` at 390 and 320 px.
7. Changes to stored health data (steps 0, 4, 7, 8) go through the `privacy-compliance` skill and
   `docs/privacy/data-inventory.md`.
8. **Keep the bike the same.** Every change to a shared file keeps bike behaviour bit for bit. Step
   0 starts with a golden test that fixes today's bike timeline output (section 7).
9. When a step is done, set its row in section 6 to done, and update `docs/plans/README.md`.

## 1. Goal and why

The owner trains for a half-distance triathlon (2027-08-29). In winter, most runs are on a
treadmill: 8 of the last 10 Garmin runs up to 2026-11-18 were "Treadmill Running". Today:

- The owner's run programs (93, 97, 102, 106, 95, 104) hold plain sets. "2 Base · Run" is one set,
  4500 s, heart rate zone 2, rest 0. The strides ("6 x 20 s strides") are only in the exercise
  note. "Brick run · 40 min" is two plain sets (600 s zone 2, 1800 s zone 3).
- For a run, play only opens `LogRunModal`, which starts at `defaultDistanceM` (5000 m for a run,
  in `DISCIPLINE_CONFIG`). For the 75 min set that shows 15:00 /km. No clock runs.
- The guided player (`GuidedPlayer`) opens only from `/planned/[id]/play` for a planned session of
  today. It keeps its state in the phone's browser storage, saves nothing per step, sends no alert
  and gets no Garmin fill.
- Garmin says "Treadmill pace is not measured" for a treadmill run, so the watch's distance is a
  guess. The belt speed that the runner sets on the machine is the best pace there is.
- Wrist running power reads about 295 W on the treadmill (HR 135) and about 375 W outdoors
  (HR 153). It does not compare between modes.

Goal: open the run exercise in a program and see the run as a coach would plan it: pace and heart
rate profile, every step with its target, the belt speed to set on a treadmill. Tap Start run. The
phone runs the run step by step, cues each step, records belt changes with one tap, and saves each
step when it ends. After the run, Garmin fills heart rate and cadence (and the outdoor distance), and
the app shows planned against done with the numbers a runner uses. A 30 min test sets the threshold
pace and LTHR. The AI assistant can write every part of a run over MCP. The run lives in the run
exercise of the program. The app guides and logs, and Garmin records.

## 2. Decisions (all made)

| # | Decision |
|---|---|
| R1 | Run only. Swim keeps today's steps and player and gets this in a later change. |
| R2 | Everything here is for users with endurance features on (`enduranceEnabledFor`). Other users keep today's run screen, with only the 5 km guess removed. |
| R3 | Two modes, Treadmill and Outdoor. Stored as the existing `indoor` and `outdoor` values (no data move); a run shows `indoor` as "Treadmill". The mode is fixed when the run starts. |
| R4 | Mode default: the mode of the last run of this program exercise, else the mode of most of the user's runs in the last 4 weeks (from `rides` of sport run, then Garmin run types for users with Garmin access), else Treadmill from November to March and Outdoor from April to October. After the run, Garmin corrects it only as section 4.8 says. |
| R5 | On a treadmill the belt is the pace. Each step starts at its frozen belt speed; a tap on belt or incline stores an event with the new absolute value. Distance and pace come from the events. Garmin distance is a backup. |
| R6 | Km only: km/h, min/km, km. mph and min/mi go to the backlog. (Owner, 2026-11-20.) |
| R7 | Push stays off in prod: the VAPID keys are not set in this build. Run alert code ships and works where keys exist. Outdoor run mode says so before the start (section 5). (Owner, 2026-11-20.) |
| R8 | The 30 min run threshold test is in this build (step 8). (Owner, 2026-11-20.) |
| R9 | An outdoor distance step ends on the time that its target pace gives. Lap ends it early, +1 min extends it. (Owner, 2026-11-20.) |
| R10 | One table: `rides` gets a `sport` column. No rename, no second table. |
| R11 | No run power as a target or as a number. No live sensors (Safari has no Bluetooth; GPS stops when the screen locks). No sending workouts to the watch. |
| R12 | Nothing to type during a run. One results table after it, filled from the belt, with effort once. |
| R13 | Easy, long, warm-up and cool-down heart rate targets are caps. Under the cap is a pass. |
| R14 | Outdoor mode has a surface choice before start: Road (default) or Trail or snow. On trail or snow, pace targets show as heart rate or effort, and the load does not use pace. |
| R15 | End run asks for an optional reason (Tired, Pain, Time, Other). Pain links to the injury log. |
| R16 | The old player address `/planned/[id]/play` opens run mode for a run-only program. Swim and programs with more than one sport keep the old player. A brick is two sessions, so each half opens its own mode. |
| R17 | After step 1 is live, the AI rewrites the owner's run programs through the MCP tools (section 6, step 1), so each change is a revision the owner can restore. |

## 3. The ground (read before step 0)

The four reviews of 2026-11-20 opened each of these files. Line numbers are as of commit `1c3598f6`.

| Area | Where |
|---|---|
| Exercise screen | `src/app/programs/[id]/workout/exercises/[programExerciseId]/page.tsx` (the bike branch is the `discipline === "bike"` check), `src/components/features/WorkoutSetsClient.tsx`, `src/components/features/WorkoutSetsList.tsx` (`handlePlayClick`), `src/components/features/LogRunModal.tsx`, `src/components/features/WorkoutExerciseList.tsx` (the run ring), `src/app/programs/[id]/workout/page.tsx` (`opensExercise` is bike only) |
| Bike parts to reuse | `src/components/features/bike/` (`RideMode`, `BikeExercise`, `RideResults`, `RideSummary`, `StepAlerts`, `useRide`) |
| Ride server | `src/db/schema/rides.ts`, `src/lib/actions/rides.ts` (`startRide` refuses a non-bike slot), `src/lib/ride-settle.ts`, `src/lib/ride-plan-db.ts` (`sessionRide`, `rideStepSnapshot`) |
| Timeline | `src/lib/utils/ride-timeline.ts` (`buildRidePlan`, `rideTimeline`, `OPEN_STEP_SPEED_MS`) |
| Step model | `src/lib/utils/workout-steps.ts` (`TARGET_RANGE`, `SPORTS_FOR`, `RUN_HR_ZONES`, `estimateWorkout`), `src/lib/utils/program-steps.ts` (`plainSetsToWorkout`, `workoutToRows`, `buildWorkout`), `src/lib/program-steps-db.ts` (`replaceExerciseSteps`, `plainSetsToStepRows`, `bikeSlot`, `bikeRestsToSteps`, `settleStepRows`) |
| One-time move | `src/lib/bike-sets-to-steps.ts` (`migrateBikeSetsToSteps`), called from `src/instrumentation.ts` and `src/lib/actions/admin.ts` |
| Cycle sync | `src/lib/periodization-sync.ts` (rest steps for bike only) |
| Load | `src/lib/utils/training-load.ts` (`runPaceLoad`, `plannedLoad`, `pairWithGarmin`), `src/lib/training-load.ts` (`appSessionLoads`) |
| Garmin | `src/lib/ride-garmin.ts` (`fillRidesFromGarmin`, `rideMatches`, `modeOfActivity`), `src/lib/garmin/fit.ts` (`parseFit`), `src/lib/garmin/analytics/sport.ts` (`sportOf`, `isIndoor`), `src/lib/garmin/charts/activity.ts` (run cadence doubled for display) |
| Push | `src/lib/utils/ride-pushes.ts`, `src/lib/push.ts` |
| Thresholds | `src/db/schema/athlete-profile.ts` (`THRESHOLD_KINDS`, protocol `run_30min`), `src/lib/utils/thresholds.ts` |
| Brick | `src/db/schema/planned-sessions.ts` (`brickParentId`) |
| MCP | `src/lib/mcp/tools/programs.ts` (`edit_program_exercise`), `src/lib/mcp/tools/endurance-app.ts` (`get_ride`), `docs/mcp/workout-steps.md` |
| Set editing (5 km default) | `src/lib/utils/discipline.ts`, `src/components/features/NewSetView.tsx`, `src/components/features/SetEditView.tsx` |
| Privacy | `docs/privacy/data-inventory.md` (rides and the event queue are described as bike only) |

Facts the reviews found that the design depends on (each was checked at the line):

- `program_sets.incline_percent` and `workout_sets.incline_percent` are integers
  (`src/db/schema/programs.ts:202`, `src/db/schema/workout-sets.ts:109`). A 0.5% step does not fit.
- Every step write sets incline to null (`src/lib/program-steps-db.ts:112` and `:217`), and the step
  schema has no incline key. A treadmill incline is lost today when a set becomes a step.
- `rideStepSnapshot` writes `sport: "bike"` (`src/lib/ride-plan-db.ts:45`), and so does the
  assistant's step result save (`src/lib/program-step-results.ts:210`). A run step would get a bike
  snapshot.
- `sessionRide` takes the latest ride of a session without checking the exercise
  (`src/lib/ride-plan-db.ts:19`). A program with a bike and a run exercise would mix them.
- `ride_events.value` is an integer (`src/db/schema/rides.ts:71`), and one active ride per user is a
  unique index (`src/db/schema/rides.ts:50`).
- `runPaceLoad` returns null on any incline (`src/lib/utils/training-load.ts:62`), so every 1%
  treadmill run falls back to effort load today.
- `parseFit` keeps only the first sport message (`src/lib/garmin/fit.ts:125`), so a multisport file
  is read as one activity.
- Garmin's FIT cadence for a run is per foot. The Garmin charts double it
  (`src/lib/garmin/charts/activity.ts:196`). The fill must double it too.
- `plainSetsToWorkout` ends a set that has both time and distance on the distance
  (`src/lib/utils/program-steps.ts:384`), and makes a zone 2 set a `work` step.
- The cycle sync puts the phase rest on a rest step only for bike
  (`src/lib/periodization-sync.ts:352`).
- Pace targets are already stored as % of threshold *speed*, 50 to 130, higher is faster
  (`src/lib/utils/workout-steps.ts:57`). Keep that. Run heart rate zones are Friel's
  (`src/lib/utils/workout-steps.ts:371`): Z1 under 85%, Z2 85-89%, Z3 90-94%, Z4 95-99%, Z5 100% of
  run LTHR and more.

## 4. Rules

### 4.1 Modes

| | Treadmill | Outdoor |
|---|---|---|
| Main target | Belt speed (km/h) and incline | Pace, heart rate or effort (4.2) |
| Second line | Heart rate, pace in min/km | Heart rate or pace, whichever is not the main one |
| Steps end on | Time, or distance from the belt | Time, distance as an estimated time (R9), or a lap |
| Controls | Belt −/+ 0.5 km/h, incline −/+ 0.5%, +1 min, hold to skip, pause | +1 min, hold to skip, pause, Lap |
| Results per step | Belt speed, incline, distance and pace from the belt, avg and max HR, cadence | Time, distance, pace, avg and max HR, cadence, climbing |

Both modes have the same steps. A mode changes the target shown and how a distance step ends, never
the steps.

### 4.2 Targets

**Belt speed from a pace target:** km/h = 3.6 × threshold speed (m/s) × pct / 100, at the midpoint
of the range, rounded to 0.5 km/h. For the owner, threshold pace 5:39 /km is 10.62 km/h.

**Run pace zones** (*new* table next to `RUN_HR_ZONES`, Friel, as % of threshold pace *time*; a
higher number is slower):

| Zone | % of threshold pace time | Owner (5:39 /km) |
|---|---|---|
| Z1 | over 129% | slower than 7:17 |
| Z2 | 114-129% | 6:26-7:17 |
| Z3 | 106-113% | 5:59-6:26 |
| Z4 | 99-105% | 5:35-5:59 |
| Z5a | 97-100% | 5:28-5:35 |
| Z5b | 90-96% | 5:05-5:28 |
| Z5c | under 90% | faster than 5:05 |

**Frozen belt of each treadmill step**, the first that exists:

1. A belt speed written on the step (*new* step field, treadmill only).
2. The pace target's midpoint.
3. For a heart rate target: the median belt of the user's done treadmill steps in the last 6 weeks
   whose Garmin average heart rate was in that zone, when there are 2 or more of 10 min or longer.
4. For a heart rate target: the slow end of the Friel pace zone of the same number (Z2 gives
   7:17 /km, 8.2 km/h). The cue says "Adjust after 6 min to hold HR 153-160".
5. Effort: effort 1 to 2 is 5.5 km/h ("walk or easy jog"), effort 3 to 4 is the Z1 pace, effort 5 to 6
   the Z2 pace, effort 7 the Z3 pace, effort 8 the Z4 pace, effort 9 to 10 the Z5b pace.
6. None (no threshold pace and no history): the step shows "Set the belt by feel" and its belt is
   null.

The belt never carries over from a work step into a recovery. Incline carries over unless the step
has its own incline.

**Outdoor target when the AI wrote none** (rules key on the target zone, not on the step type,
because `plainSetsToWorkout` makes a zone 2 set a work step):

| Step | Outdoor target |
|---|---|
| Warm-up, cool-down, heart rate zone 1 or 2, any step of 20 min or more at zone 3 or less | Heart rate cap at the top of the zone (R13) |
| Pace or zone 3 to 5 work of 8 min or more | Pace range, heart rate as information |
| Pace or zone 3 to 5 work of 3 to 8 min | Pace range. Heart rate shows but is judged only on the last half of the step (cardiac lag) |
| Under 3 min, strides, hill repeats | Effort ("Fast and relaxed" for strides, "Hard" for hill repeats), with the climb in the note |
| Walk breaks, recovery | Effort 2, "Easy jog or walk" |
| Surface Trail or snow (R14) | Every pace target becomes the heart rate range of the same zone, else effort |

Without a run LTHR, heart rate targets become effort targets (Z1 2, Z2 3, Z3 5, Z4 7, Z5 9).
Without a threshold pace, pace targets show in % and "Set your threshold pace".

**Brick run (the run of a linked brick):** for its first 10 min, the main target is effort 4 to 5
with the cue "Short quick steps", and the second line is a cap at the top of Z2. After that the
written target applies. Heart rate is 5 to 10 bpm higher off the bike; this is normal.

**Judging a step (summary arrows):** a cap passes when the step is at or under it; it shows ↑ when
the step is more than 10% of its time over the cap. A range shows ↓ or ↑ when the step's value is
outside it. A heart rate on a step under 8 min is not judged.

### 4.3 Run life

The bike rules of `bike-ride-logger.md` 4.3 apply, with these changes:

- `rides.sport` (*new*, `text NOT NULL DEFAULT 'bike'`). Every reader of `rides` filters or branches
  by sport: `getRide`, the fill loop, `rideMatches`, `appSessionLoads`, `get_ride`, the ride
  numbers, push text, the `log_step_results` ride check, the summary routes.
- A ride is keyed by session **and** program exercise (fix `sessionRide`).
- The frozen plan (*new* plan version with `sport`) gives each step an end rule: `time`, `belt_distance`
  (treadmill distance step), `estimate` (outdoor distance step, R9) or `lap`, with its seconds and
  meters, and for a treadmill step its belt and incline. `rideTimeline` reads only these. A later
  Garmin mode correction changes labels and fill fields, never the timeline.
- Auto end uses run speeds: a `belt_distance` step with a null belt and an `estimate` step with no
  pace count at 6 km/h. Add run constants; do not use `OPEN_STEP_SPEED_MS` (25 km/h, a bike speed).
- An `estimate` step: its seconds come from its pace target, else from the user's recent easy pace
  (median pace of done Z1 to Z2 outdoor steps in 6 weeks) for a heart rate step, else the Z2 pace,
  else it becomes a `lap` step. The screen shows "1 km · about 4:50".
- Start on a treadmill shows a 5 s "Step on · Set belt 7.5 km/h" count before the clock runs.
- Only one session runs per user (bike or run). "End ride and start run" is one action (*new*
  `startRide` option to end the active one): it settles the ride, sends its end, and starts the run
  in one transaction. The client sends its queued ride events first; when it cannot, Start run waits.
- Once a later session of the user has started, the server refuses any event that would make an
  earlier session live again ("The ride has ended"), and the queue drops it.
- End run while paused or before the last step asks for an optional reason (R15). The run is
  `ended_early` as for the bike; a reason Pain shows "Log an injury" which opens the existing
  injury entry.

### 4.4 Belt and incline events

- *new* event kinds `belt` and `incline` with **absolute** values in tenths: belt is km/h × 10
  (80 is 8.0 km/h), incline is % × 10 (10 is 1.0%). Clamp belt to 0 to 250, incline to −30 to 150.
  `nudge` stays bike only.
- Each event carries the step key the client saw. When the timeline places it in another step (an
  offline replay clamped to a later time), it is ignored.
- Taps in a burst (within 2 s) send one event with the last value. The toast says "Belt 9.5 km/h ·
  Undo" for 5 s; Undo sends the value from before the burst, and shows only while the same step runs.
- Distance builds from the belt over active time only. While paused, no distance builds. A belt
  event while paused stores the value, which counts from resume. Resume on a treadmill shows "Set
  belt 8.0 km/h".
- A `belt_distance` step ends when its distance is reached; each belt event moves its end and
  rewrites the push rows. +1 min is hidden on it.
- A cue card "Speed up to 13.0 km/h" (or "Slow down to 8.0 km/h") shows 10 s before any step whose
  frozen belt differs from the current belt by 1 km/h or more.
- When a run has no belt events, the summary says "Distance from the plan · no belt changes".

### 4.5 Short-step blocks (strides)

- A block is a repeat whose work step is under 60 s.
- Screen: "Stride 3 of 6", the step clock, a row of dots, the belt target. Recovery: "Easy · 1:40 ·
  Set belt 8.0 km/h". Belt events in a block come from the frozen plan without a tap.
- With the screen on: a beep at each rep start and end, plus the last 3 s beep.
- Push: one alert at block start (the whole block as the title) and one at the end of the last work
  round. No "1 min left" inside a block.
- Hold to skip in a block skips the rest of the block (*new* `skip` with value 1). The toast says
  "Strides skipped · Undo"; one `unskip` cancels it.
- Results and summary show the block as one row: "Strides 6 × 20 s · 5 of 6".
- On a treadmill a belt takes 5 to 15 s to speed up. The AI writes treadmill strides as 30 s steps
  (`docs/mcp/workout-steps.md` says so), and the cue comes 10 s before.

### 4.6 Outdoor without alerts

Push is off in prod (R7). So outdoor run mode:

- Before start: "Step alerts are off · Keep the screen on for beeps, or follow your watch".
- With the screen on (armband): the wake lock, a beep at each step start and the last 3 s beep.
- A controls lock: 10 s after the last tap, "Controls locked · Hold to unlock" (600 ms, the hold
  component of skip) covers the controls, so a pocket or armband cannot tap them.
- With the phone locked: steps still end and save on server time.

### 4.7 Saving

- The bike rule `bike-ride-logger.md` 4.5 applies: each step logs through `logWorkoutSet` via
  `callAction` and the offline queue.
- The server works out each treadmill step's distance, average speed and incline from the timeline
  when it settles, so late offline belt events recompute them.
- *new* result source `belt`. Priority per field: treadmill distance and pace are typed, then belt,
  then Garmin; outdoor distance and pace are typed, then Garmin, then clock. A typed distance never
  changes the events.
- Run results columns use the existing `workout_sets` fields (`avg_hr`, `max_hr`, `avg_cadence`,
  `avg_speed`, `climb_m`, `incline_percent`, distance, `sources`). Incline becomes a real number
  (step 0).
- Totals of a run count the active seconds and distance of skipped steps too (a skipped step was
  still run). Say so in the summary helper.
- The step snapshot takes its sport from the plan (fix `rideStepSnapshot` and the assistant save).
- Brick: *new* `rides.brick_ride_id` links the run to the ride, set from the planned brick pair
  (`brickParentId`), never from "the last ride today". T2 = run start minus ride end, shown only when
  60 min or less and the ride did not auto end.

### 4.8 Garmin fill

The bike rules of `bike-ride-logger.md` 4.8 apply, with these changes:

- Match a ride's sport: run types (`running`, `treadmill_running`, `indoor_running`, trail, track)
  for a run session, bike types for a ride. The fill loop never gives a run a bike fill or the
  reverse.
- Treadmill fill fields: avg and max HR, cadence (doubled from the FIT per-foot value). Distance only
  for a step with no belt value. Never power (R11).
- Outdoor fill fields: time, distance, pace, avg and max HR, cadence (doubled), climbing. Garmin lap
  time and distance replace the clock values of `estimate` steps.
- A re-sync of the same activity (Garmin's treadmill calibration changes distance after the run)
  rewrites only fields still marked Garmin, never a declined pair. Undo restores belt values with
  their source.
- Mode correction: a treadmill or indoor run type means Treadmill. Outdoor only when the stream has
  GPS positions. When belt events exist and the run becomes Outdoor, GPS distance wins and the belt
  values stay stored.
- Multisport files: `parseFit` reads every session in the file, each with its own time window and
  sport (bump the parser version). The fill matches by segment, keyed by activity id plus segment.
  Garmin's transition segment gives T2 when present.
- A late lap: a lap within 30 s after an `estimate` step ended on its time moves that step's end to
  the lap; the step is done there, and the next step starts there. A lap on a distance step is
  always done; only a lap on a time step is partial.

### 4.9 Numbers

- Distance and avg pace: from the belt (treadmill) or Garmin (outdoor), with the source shown.
  Pace is moving pace.
- Grade-adjusted pace (GAP): treadmill from belt and incline; outdoor from the `distance` and
  `altitude` streams smoothed over 30 s. The Garmin stream has no GAP field. Use Minetti 2002 for
  the cost of grade. Treadmill incline of 0 to 1% counts as flat (Jones and Doust 1996); only the
  part above 1% is adjusted. Belt under 7 km/h uses Minetti's walking curve.
- IF = GAP speed / threshold speed. Load = hours × IF² × 100, per step, summed (*new* run step
  load next to the bike's power load in `appSessionLoads`, its own method name). Marked "est.".
  Garmin load still wins in pairing for Garmin users.
- No pace load (fall back to today's order, which ends in effort load) when: surface is Trail or
  snow, a treadmill run has no belt at all, or no threshold pace is set.
- Time in heart rate zones (Friel, run LTHR): from the 1 s stream; without it, each step's time goes
  to the zone of its average.
- Time on target per step: share of the step's seconds inside its target (pace outdoors, heart rate
  for heart rate steps). Only with a stream.
- Decoupling (Friel Pa:HR): only on steady steps that together run 45 min or more. Leave out the
  first 10 min, strides, intervals, cool-down and Garmin pauses. Split by time into two halves,
  efficiency = GAP speed / avg HR per half, drift = (first − second) / first × 100. Under 5% shows as
  "steady". On a treadmill, weight by belt segment.
- Cadence (steps per minute): information only, never a target.
- Cut: run power, ground contact, stride length, VO2 max.
- Mockup numbers for unit tests: warm-up 10 min at 7.5 km/h, steady 50 min at 8.0 km/h, strides
  6 × (20 s at 13 km/h + 100 s at 7 km/h), cool-down 3 min at 5.5 km/h give 9.8 km and 7:39 /km.

### 4.10 Run threshold test

- Two templates the AI tool and the step editor can insert, treadmill and outdoor: warm-up 15 min
  with 3 × 1 min pickups, then the test as two steps with the same target: 10 min and 20 min,
  "Run as hard as you can hold for 30 min". Treadmill: "Start at 10.0 km/h, raise it if you can".
  Stored as the existing protocol `run_30min`.
- Before start: "No hard session in the last 48 hours". When an illness entry is open or ended in
  the last 7 days, the test does not start ("Wait 7 days after being sick").
- Results: LTHR = avg HR of the 20 min step (Friel). Threshold pace = avg pace of the whole 30 min.
  Verify these two against Friel's own text in step 8 and write the source in section 10.
- No result when the 20 min step is not done or has more than 60 s of pause. On a treadmill with
  no belt event during the test: LTHR only.
- Checks: no stops, the 20 min pace within 5% of the first 10 min, the 20 min HR at 80% of max HR or
  more, effort 8 or more. A failed check shows "Test may be invalid" and Save is not the default
  button.
- Sane range: LTHR 120 to 210 bpm, pace 2:30 to 10:00 /km. Against the current value: within 5 bpm
  and 3% shows Save; 6 to 10 bpm or 3 to 8% shows both side by side to choose; further off says
  "Run the test again in 4 weeks" and keeps Save as the second button.
- "Stop test" saves nothing to thresholds. One line on the start screen: "Stop for chest pain,
  dizziness or unusual breathlessness".
- Save adds a threshold row through the existing threshold path. Frozen plans of running sessions
  keep their thresholds; every other % target reads the new value.

## 5. Screens (match the mockups)

Reuse the bike parts in `src/components/features/bike/`: wake lock, last 3 s beep, the undo toast in
the Next card's place, hold to skip (600 ms), the paused screen with End at the bottom, the landscape
grid, "Saved on this phone", `StepAlertsRow`. Touch targets for controls used while running are
64 px or more.

- **Run exercise, ready.** Title, line "75 min · load about 60 · threshold 5:39 /km", mode row
  ("Treadmill" with Change; Outdoor adds the surface choice), planned profile chart (heart rate or
  pace zones as bands), step list (name, round, zone chip, target and time; on a treadmill the belt),
  bottom bar "Start run" and "Log by hand". Change opens a two-option sheet before start only.
  Outdoor shows the alerts-off row (4.6).
- **Run mode, treadmill.** Header "Treadmill · step 2 of 4" and elapsed of total; step name; clock;
  the belt card with a big − and + on each side of "8.0 km/h" (label "Belt"), and "Plan 8.0" muted
  under it when the recorded belt differs; an incline row "−" · "Incline 1%" · "+" under it; Next
  card ("Next · Strides 6 × 20 s · 13.0 km/h"), which turns into the cue card and the undo toast;
  bottom row +1 min, Hold to skip, Pause. No Lap unless the step ends on a lap. Nothing critical in
  the last 40 px (a console ledge covers it). Big numbers stay white; the accent is only for the cue.
- **Landscape on a console.** Clock left; belt card with − and + right; incline under it; bottom row
  +1 min, Hold to skip, Pause.
- **Run mode, outdoor.** Main target (pace, heart rate cap or effort) big; second line; Lap; the
  controls lock (4.6); "Saved on this phone" when offline; a distance step shows "1 km · about
  4:50".
- **Strides block** (4.5).
- **Run done / Run ended early.** As the bike. Ended early: "Steps 1 and 2 are saved" and the reason
  chips (R15).
- **Brick.** The ride's done screen in a brick shows "Start run" as the pinned primary and "Ride
  numbers later"; the ride results move to after the run. The run ready screen shows a live "T2
  1:12" with its mode chosen. "End ride and start run" when the ride is still running.
- **Run results.** One row per step, belt with a stepper (0.1 km/h) on a treadmill, avg HR optional,
  "More numbers" for max HR and cadence, effort once, Done. "Waiting for your Garmin run". "Later"
  leaves it. An outdoor run with no Garmin asks for one optional total distance.
- **Summary.** Tiles time, distance (with its source line), pace "7:39 /km", avg HR, load ("est."),
  drift ("3% · steady"). Plan against done chart. Zone bar. Step table with plan and done in the same
  units per row (4.2 judging). "Steps filled from Garmin · Undo". Brick: "Brick · ride 60:00 · T2
  1:12 · run 40:00". No Share button.
- **Empty states.** No threshold pace ("Set your threshold pace to see belt speeds · Set pace"); no
  LTHR (effort targets, no zone bar); no Garmin ("Plan only · Add numbers"); two Garmin matches
  ("Two Garmin runs match · Pick", a sheet with start time, time and distance of each); a run
  already running (Resume or End at the last step); no belt events (4.4).
- **Planned day card.** "Run · Treadmill · 75 min".
- **Log by hand.** Today's sheet without the 5 km guess.
- **Threshold test result.** "New threshold pace 5:30 /km · LTHR 176 · Save", with the checks of
  4.10.

Each of these states gets a mockup on the plan page before step 2 starts. The plan page (version 4) shows the
main ones. The builder adds the rest to the plan page in the same style and shows them to nobody
before building (rule 3 of section 0).

## 6. Steps

| Step | Status |
|---|---|
| 0 Groundwork | done |
| 1 One run model | done |
| 2 Run exercise screen | done |
| 3 Run mode | done |
| 4 Results and numbers | done |
| 5 AI tools | done |
| 6 Alerts | done |
| 7 Garmin fill and stream numbers | done |
| 8 Run threshold test | done |

### Step 0. Groundwork

- Golden test first: for a set of stored bike plans and random event lists, the output of
  `rideTimeline` equals a frozen copy of today's output. It must pass before and after every step.
- Schema (one migration, idempotent SQL, committed with its snapshot): `rides.sport`,
  `rides.brick_ride_id`, `rides.surface`, `rides.end_reason`; `program_sets.incline_percent` and `workout_sets.incline_percent` to
  `real`; widen their validators to −3 to 30 with one decimal.
- Step model: *new* step fields `incline` and `belt` (treadmill), `outdoor` allowed for run, `test`
  allowed for run. Keep strict objects. Map them in `workoutToRows` and `buildWorkout`. Stop setting
  incline to null in `replaceExerciseSteps` and `plainSetsToStepRows`.
- Run pace zones (4.2). Belt resolution (4.2) as a pure function.
- Events: kinds `belt` and `incline`, the block skip, the step key, the schema refine ranges, the
  client queue.
- *new* run plan builder and the timeline changes (4.3 to 4.5) behind `plan.sport`. Fix
  `sessionRide`, `rideStepSnapshot` and the assistant snapshot sport.
- Every reader of `rides` filters by sport (4.3).
- Privacy check and `docs/privacy/data-inventory.md` for belt, incline, sport, brick link, surface
  and end reason.
- **Done when:** the golden test passes; the timeline tests of section 7 pass; integration tests for
  `startRide` on a run, the end-and-start option, and a refused event on an earlier session.

### Step 1. One run model

- *new* one-time move for run (own revision reason "Run sets became steps", so a program with bike
  and run moves both). Generalize `bikeSlot` to bike and run. Rest moves to rest steps for run, as
  for the bike, also in `settleStepRows` and the cycle sync (this changes the bike brief's D1 note
  that run keeps rest on the row). A plain set's incline becomes the step's incline. A set with both
  time and distance becomes a time end with a pace target (distance / time). A distance-only set gets
  a distance end. Hook it where `migrateBikeSetsToSteps` is called.
- Run writers write steps: `triathlon-plan.ts`, program shares, the MCP tool.
- Remove the 5 km guess for run (`defaultDistanceM`), and check `NewSetView` and `SetEditView`
  (set editing is a critical flow: add a component test).
- A share to a non-endurance user keeps the steps; test what today's run screen shows for a step row.
- After deploy (R17): with the `logeverylift` MCP tools, rewrite the owner's run programs (list them
  with `list_programs`; on 2026-11-20 they were 93, 97, 102, 106, 95, 104). Turn the notes into steps:
  for "2 Base · Run", warm-up 10 min Z1, steady 50 min Z2, strides 6 × 30 s fast with 1:30 easy (the
  treadmill rule of 4.5), cool-down 3 min walk. For the brick runs, the first 10 min at Z2 and the rest
  at Z3. Keep the note text. Use `expectedVersion` and a reason on each write.
- **Done when:** integration tests: distance only, time plus distance, rest, incline; a second run
  of the move changes nothing; the revision restores it; the cycle sync still moves a zone target.

### Step 2. Run exercise screen

- For a run exercise of an endurance user, the exercise route renders *new* `RunExercise` (in
  `src/components/features/run/`, reusing the bike parts). The run ring in the workout list opens it.
- Chart, stats, step list with belts, mode row with R4 default and the surface choice, empty states,
  planned day card.
- **Done when:** journey screenshots at 390 and 320 px match the mockups; bike, swim and strength
  screens unchanged; component tests for the mode default and the no-threshold state.

### Step 3. Run mode

- Run mode per 4.3 to 4.6 and section 5: belt and incline controls, the start count, cue cards,
  strides block, outdoor view, controls lock, paused and offline states, landscape.
- Each step saves per 4.7. Finish, end early with reason, brick hand-off. R16 routing.
- **Done when:** the e2e tests of section 7 pass; journey review and smoke pass.

### Step 4. Results and numbers

- Results table and summary per section 5. Numbers of 4.9 that need no stream: distance and pace from
  the belt, GAP on a treadmill, per-step load, zone time by step, planned numbers.
- **Done when:** unit tests with the mockup numbers (9.8 km, 7:39 /km); the summary marks estimates;
  journey review.

### Step 5. AI tools

- `edit_program_exercise` accepts run belt, incline, outdoor, test and the treadmill stride rule in
  its docs; `get_ride` returns run sessions with the numbers of 4.9; `log_step_results` and
  `get_step_results` carry belt values and sources. Update `docs/mcp/workout-steps.md` and the server
  instructions.
- **Done when:** integration tests write and read each new field through the tools.

### Step 6. Alerts

- Run alert text (target first, no colons, no em dashes), one alert per block (4.5), the tap opens the
  run exercise in run mode. Push stays off in prod (R7); the app shows the alerts-off row.
- **Done when:** integration test: events rewrite the push rows for a run with a block; a belt event
  moves the alert of a belt distance step. Check on a dev setup with keys and note it in section 10.

### Step 7. Garmin fill and stream numbers

- Per 4.8, plus the stream numbers of 4.9: outdoor GAP, IF and load from the stream, time in zones,
  time on target, decoupling. Mode correction. Multisport files.
- **Done when:** the Garmin integration tests of section 7 pass with a stored treadmill FIT file, an
  outdoor FIT file and a multisport FIT file.

### Step 8. Run threshold test

- Per 4.10: templates in the step editor and the MCP tool, the start checks, the result line, Save.
- **Done when:** unit tests for the results and checks; e2e saves a new threshold pace and the run
  screen shows the new belt speeds.

## 7. Tests the build must have

**Unit (timeline and numbers)**

1. Golden bike test (step 0).
2. A belt distance step ends at the distance built from 2 belt changes.
3. The same with a pause, and a belt event during the pause.
4. A belt event whose step key belongs to the step before is ignored.
5. Undo of a belt burst restores the value from before it.
6. A recovery after a 13 km/h stride counts its own frozen belt.
7. A heart rate step with no history uses the zone pace; with no threshold pace the belt is null.
8. An outdoor distance step: end on the estimate, Lap early (done), +1 min, a lap 25 s late (moves
   the end), a lap 31 s late (ends the next step as partial).
9. Auto end with a null-belt distance step.
10. A Garmin mode correction does not change the timeline output.
11. Block: alert rows for 6 × 20 s strides, a skip inside the block, a skip of the rest with its
    unskip.
12. Threshold result: done, ended early, paused 90 s, treadmill with no belt events, out of range,
    each band of the comparison.
13. Mockup numbers 9.8 km and 7:39 /km. GAP at 0%, 1%, 5% and a walk at 6 km/h and 5%.
14. Decoupling leaves out the strides and the first 10 min.

**Integration (`pnpm test:int`)**

1. The fill loop ignores run sessions for bike activities and the reverse.
2. Garmin does not overwrite a belt distance; it fills distance when there are no belt events.
3. A re-sync after calibration, Undo, then a re-sync of the declined pair.
4. A multisport file fills the ride and the run, and gives T2.
5. "End ride and start run" with a ride whose stored status is stale.
6. A queued unskip on the ride after the run started is refused.
7. T2: a linked brick, a run the next day, two bricks on one day.
8. The run move: distance only, time plus distance, rest, incline, a second pass, restore.
9. A share to a non-endurance user.
10. A threshold save during a running session leaves its frozen plan unchanged.

**e2e (`make e2e`)**

1. A treadmill run with belt taps, one taken back with Undo; a reload resumes at the right second;
   each step saves with the right belt.
2. Offline belt taps replay and land in the right steps.
3. An outdoor 400 m rep ended by Lap.
4. The brick prompt opens the run from a ride that ended early.
5. The bike specs `e2e/bike-ride.spec.ts` and `e2e/bike-exercise.spec.ts` still pass unchanged.

## 8. Out of scope (goes to BACKLOG.md with this brief)

- Swim on the same parts (R1).
- mph and min/mi (R6).
- Push keys in prod (R7, existing backlog entry).
- A fuel prompt at the end of runs of 75 min or more and bricks.
- Run dynamics (ground contact, stride length) and run power numbers.
- Sending runs to the watch.
- A race or stroller flag that leaves a run out of the drift and pace models.

## 9. Checks the owner will do

- After step 3: run "2 Base · Run" on the treadmill from start to end; every step saves with its
  belt speed.
- After step 7: after the Garmin sync, heart rate and cadence fill, and the distance is the belt's.
- After step 8: run the 30 min test on the treadmill and save the result.

## 10. Choices made during the build

(Add one line per choice: step, what was open, what you chose, why.)

- Step 0, belt storage: a step's written belt is a new column `program_sets.belt_kmh` (real), next to `incline_percent`, so `workoutToRows` and `buildWorkout` map both like the other step fields.
- Step 0, step key storage: a new column `ride_events.step_key` (text, null on bike events), so the server and every device read the same key the client sent.
- Step 0, run test: `test` on a run is `"30min"` (`RUN_TESTS`), stored in `program_exercises.ride_test`; a bike keeps `ramp` and `20min`.
- Step 0, incline and belt on a non-run row: `buildWorkout` reads incline and belt only for a run, so a bike row's incline never makes its step fail the check.
- Step 0, zone pace: a pace zone stands for its slow end (Z2 is 7:17 /km, 8.2 km/h, as 4.2 says). Z1 has no slow end, so it stands at 140% of threshold pace time (7:55 /km, 7.6 km/h), slower than Z2.
- Step 0, rounding: a pace target's belt rounds to 0.5 km/h (4.2); a belt from a zone, an effort or history rounds to 0.1 km/h, as the 8.2 km/h example of 4.2 shows.
- Step 0, effort belt: the effort is the midpoint of the step's RPE range, rounded.
- Step 0, last recovery: a run keeps the recovery after a repeat's last round (a ride drops it), because the mockup numbers (9.8 km in 75 min) count all six stride recoveries.
- Step 0, belt with no history: `startRide` passes no belt history and no easy pace yet; the query comes in step 4, when results store belt values with source `belt`. Until then rule 3 of 4.2 and the easy pace of 4.3 fall through to the zone pace.
- Step 0, outdoor targets: the run plan keeps a written `outdoor` target only; the derived outdoor targets of 4.2 (caps, effort for strides, trail rules, the brick run's first 10 min) come with the run mode screen in step 3.
- Step 0, brick link: `rides.brick_ride_id` exists, but `startRide` sets it from the planned brick pair in step 3, with the brick hand-off.
- Step 0, step key check: belt, incline, extend, skip and lap are ignored when their step key is another step's; pause, resume and end always apply. A lap whose key is the step that just ran out still counts as a late lap.
- Step 0, session ride mode: a run does not write `workout_sessions.ride_mode` (the bike screen's default); a run keeps its mode on its ride.
- Step 0, readers by sport: the Garmin fill loop and Pick, the ride report (`get_ride`), the push alerts and the bike exercise view read bike rides only until steps 5 to 7 give runs their own; `log_step_results` on a session with a ride and a run still takes the latest one, which step 5 settles.
- Step 0, privacy page: the inventory lists the new columns now; the policy text and the `LEGAL_VERSION` bump go with step 3, the first step whose screen stores a run. The end reason Pain is covered by the injuries already named as health data, so `CONSENT_VERSION` stays.
- Step 1, time and distance on a run set: the pace target is `pace` with anchor `absolute` (m/s), 2% each side of distance over time, so the step can be judged against a range (4.2) and needs no threshold pace. When the set has a zone, the zone stays the main target and the pace is the second, so the weekly sync still moves the zone and the limits judge the step by it (a zone 4 tempo stays hard with no threshold pace); a treadmill belt then comes from the zone (4.2). With no zone the pace is the main target.
- Step 1, distance anchor: a run set with time and distance whose weekly-sync anchor is its distance alone keeps a distance end (with the pace target), so the sync still grows it. Every other set with both ends on its time, as this brief says.
- Step 1, the move: one function `migrateSetsToSteps` in `src/lib/bike-sets-to-steps.ts` (file name kept) moves bike and run, each with its own reason. The run move runs after the bike move at boot and when an admin turns the endurance features on, so the two never write one program at once.
- Step 1, row rests on stepped runs: the run move also reads a run slot that already holds steps with a rest on a row, and moves that rest to a rest step (inside a repeat it is dropped, as for the bike), so the weekly sync finds the rest step. The bike move is unchanged.
- Step 1, slots left plain: a program whose slots no step can hold (a set over 12 h) is not counted as moved and writes no revision, so the move reads it again at each boot and leaves it plain with a log line.
- Step 1, hard sessions: a plain run set marked `work` with no zone becomes a work step with no target, which the limits read as steady (the step rule of `isHardSession`), as for the bike. A zone 4 or 5 set stays hard.
- Step 1, log by hand: with no 5 km guess, a run logs on its time alone, as a ride does.
- Step 2, mode default (R4): the last run of the exercise, else the mode of most runs in 28 days from `rides` of sport run, and only when there are none Garmin run types (for a user with Garmin access); a tie falls to the month. The shared helper is `defaultRunModeFor` in `src/lib/run-exercise-view.ts`.
- Step 2, Start run before step 3: it starts the server run and opens `?ride=1`; until run mode exists that address shows the run screen with "Run running" and Resume. Step 3 puts run mode there.
- Step 2, "a run already running": the screen shows Resume in place of Start run, hides Change, the surface choice and Log by hand; a ride or another run of the user shows "A ride is running" (or "Another run is running") with Resume to it. End, with its reason, is in run mode (step 3), and "End ride and start run" comes with the brick hand-off in step 3.
- Step 2, Log by hand: `?hand=1` opens today's set list for the run (the sheet without the 5 km guess), not a results table; step 4 owns the run results table.
- Step 2, step rows: a strides block (4.5) is one row "Strides 6 ×"; a work step in zone 1 or 2 is called "Steady"; time shows as m:ss as in the mockup. On a treadmill a heart rate step shows its cap or range with "start 8.2 km/h", or "set the belt by feel" with no belt; outdoors the target follows the 4.2 table for display (frozen into the plan in step 3). A cap is the top of the zone as `resolveTarget` gives it (Z1 under 151, Z2 under 160 at LTHR 180).
- Step 2 review, caps outdoors: the first row of the 4.2 table wins over a written pace. With a run LTHR, a warm-up, a cool-down, a zone 1 or 2 step and a step of 20 min or more at zone 3 or less show a heart rate cap on Road and on Trail or snow, also when the step holds a pace. Without an LTHR, Road keeps the written pace and Trail or snow shows the effort of the zone. A written effort stays as written. The chart label shows the same text as the step row.
- Step 2 review, "Set your threshold pace" outdoors: only when a step's pace is a share of the threshold pace; a pace in m/s (as step 1 writes from time and distance) needs none.
- Step 2, Friel Z5 as a pace range: 90 to 100% of threshold pace time (Z5a and Z5b).
- Step 2, planned numbers: load is `plannedLoad` with each heart rate or effort step at its type's default IF, said "about"; "at least" only when a step's time is not known. Distance shows only when every step's distance is known (belts on a treadmill, distances and pace targets outdoors). The zone bar needs a run LTHR. The mockup numbers were set to what the code gives (load 70, 10.1 km).
- Step 2, alerts row: outdoors only, before the start, with the 4.6 hint after "Step alerts are off"; the treadmill phone sits on the console with the screen on.
- Step 2, planned day card: the home Today card on a day whose program is one run exercise with steps says "Run · Treadmill · 75 min" (endurance users only), in place of the counts.
- Step 1, step editor save over plain run sets: the rest of each plain set stays with its place as a rest step after it (also after the last set), and the sets keep their ids; the bike keeps its own rule (its save drops the row rest).
- Step 3, the count: `startRide` takes `countIn` on a treadmill and puts the run's start 5 s after the tap, so the timeline needs no new state; run mode shows "Step on · Set belt 7.5 km/h" until then. Outdoors there is no count.
- Step 3, belt bursts: each tap stores the time of that tap, and the burst sends the last value at the time of its last tap. A burst still open when its step ends is not sent (the belt never carries over); Pause sends open bursts first. The first tap on a step with no belt (by feel) gives 8.0 km/h; an unknown incline shows and starts at 0%.
- Step 3, the end reason: chosen on the ended-early screen after the end (section 5), with `setRideEndReason`; a second tap on a chip clears it. Pain shows "Log an injury", which opens Account, Body and health, where Injuries and limits is.
- Step 3, after the run: until step 4 builds the results table and the summary, the run exercise shows "Run done" or "Run ended early" with the steps saved for 12 hours after the start, as the bike does, and no Start run.
- Step 3, short outdoor work: a work step under 3 min shows effort ("Hard") outdoors also when it holds a pace, as the 4.2 table says; e2e 3 runs its 400 m rep that way.
- Step 3, brick run: outdoors the first 10 min show "Effort 4-5" big with "Short quick steps" and the Z2 cap as the second line; on a treadmill the belt stays the main target and "Effort 4-5" and "Short quick steps" go first on the second line.
- Step 3, brick link: a run links to the user's latest bike ride of the last 12 hours on today's planned brick parent (the workout opened from it, else a workout of its program).
- Step 3, End ride and start run: offered whenever a ride runs, not only in a brick, with "Back to the ride"; the run's mode and surface can still be chosen. The ride's taps on this phone are sent first; when they cannot be, the run does not start and the screen says so.
- Step 3, brick ride done: "Ride numbers later" is a line under Start run, not a button; the ride's results table and summary show once the run has started.
- Step 3, late belts on the server: `sendRideEvent` writes the belt fields of the ended steps again after each belt or incline event, only where the field's source is still `belt`; `settle` does not.
- Step 3, step numbers: the header, Hold to skip and the saved-steps line count a strides block as one step, as the step list does.
- Step 3, controls: outdoors with Lap, +1 min gets its own row above the Next card, so the bottom row holds Hold to skip, Pause and Lap at 320 px. The controls lock covers them all. "Saved on this phone" is a line under the header.
- Step 3, R16 and the guided player specs: the guided player e2e runs got a short spin after the run, so they stay two-sport programs and keep the player.
- Step 3, push: the run's alert text is step 6; the alerts row shows before an outdoor start as in step 2.
- Step 4, pace shown: a pace is cut to the whole second, as a watch shows it (`paceText`), so the mockup run reads 7:39 /km (459.7 s per km).
- Step 4, a run's pace load: per step hours x IF^2 x 100 with IF = GAP speed / threshold speed, summed, only when steps with a distance cover 90% of the run's time (as power does for a ride, `DISTANCE_COVERAGE_MIN`) and the run passes the existing floors (400 m, 5 min); steps without a distance count at the mean IF^2 of the others. An IF outside 0.3 to 1.5 falls back to effort, as `runPaceLoad` does.
- Step 4, GAP on a treadmill: per step, from its average belt speed and its time-weighted incline (`gapSpeed` in `src/lib/utils/run-gap.ts`). A negative incline counts as it is; only 0 to 1% is flat. `runPaceLoad` grade-adjusts its incline the same way, so a 1% treadmill run gets a pace load (section 3 fact).
- Step 4, after a run: run mode opens the results table (`?results=1`) when the run ends, as ride mode does; its Done opens the summary. The done screen of step 3 is now the summary's head, and its reason chips are `RunEndReason`. Log by hand stays today's set list (step 2 choice).
- Step 4, results table: a strides block is one row with its reps run and takes no numbers; the effort still saves on its steps. The belt stepper shows under each run step on a treadmill and starts from the saved belt, else the plan's, else 8.0 km/h; a belt stepped back to the saved one sends nothing.
- Step 4, one total distance outdoors: shown while no step holds a Garmin distance; it is typed distance on each step run, by its share of the time (the last step takes the rest, so the sum is exact). Clearing it clears only the steps that hold a distance.
- Step 4, plan against done: on a treadmill the plan column is the frozen belt and the heart rate target (a cap as "HR 160", the footnote says under a cap passes) or the zone; outdoors the target of 4.2. Done is the belt (treadmill) or the pace (outdoors) and the avg HR. Without a stream a heart rate judges by the step's average: over the cap or the range is ↑, under a range ↓. A treadmill pace target judges the belt with 0.25 km/h each side (a pace belt rounds to 0.5 km/h). Outdoors only heart rate is judged until step 7 brings the stream.
- Step 4, tiles: Time, Distance, Pace (with "GAP 7:20" under it only when GAP differs), Avg HR, Load est., Effort. Drift waits for the stream (step 7). The distance line names its sources: "Distance from the belt", "from the plan · no belt changes" with no belt or incline tap, or a list such as "the belt and typed numbers".
- Step 4, belt history (4.2 rule 3): done treadmill steps of 6 weeks whose belt is from the belt or typed and whose average heart rate is Garmin's. Recent easy pace (4.3): done outdoor Road steps of 6 weeks, 10 min or more, with a distance and an average heart rate in zone 1 or 2 (any source), median speed of 2 or more, as the belt history needs 2. The run screen reads the same history, so it shows the run startRide freezes.
- Step 4, run load in appSessionLoads: method `run_gap` (the Garmin series takes it as `run_pace`). A run from run mode with no pace load (Trail or snow, too little distance) takes the effort load, not the plain session pace.
- Step 4, planned numbers: step 2 already gives them (`plannedRunNumbers`); step 4 adds none.
- Step 4, demo accounts: `steps-rundone`, `steps-runearly` and `steps-runbrick` (`scripts/seed-steps-demo.ts`), with journeys in `scripts/journeys/runresults.journeys.ts`.
- Step 4 review, incline of a plain run: `appSessionLoads` grade-adjusts a run's pace with the time-weighted incline of its sets, not the steepest one.
- Step 4 review, a typed total outdoors: it spreads over every step that ran, a skipped one too (4.7); the table then saves the skipped step's distance with its status and time unchanged.
- Step 4 review, easy pace (overrides the step 4 line on its sources): only outdoor steps whose distance is their own (Garmin's or the assistant's) count; a typed distance outdoors is one total spread by time.
- Step 4 review, Ride again and Run again (changes the bike final review line on the summary): the results table and the summary read only the steps the latest ride or run ended (`rideStepLogs`), and a clock-timed row whose time or status differs from its timeline is the earlier one's, so the step shows as not saved yet. The earlier rows stay in the session.
- Step 4 review, plan against done chart: the bike's chart (`RideDoneChart`) draws from a Garmin 1 s stream only, so the run summary gets it with step 7's stream.
- Step 5, belt numbers and the assistant: a belt value (source `belt`) is kept like a typed or Garmin one (`ASSISTANT_KEEPS`), so the reply lists it under `kept` with `by: "belt"` and the runner corrects a belt in the results table. A treadmill step's stored incline is the belt's whoever wrote its distance; the assistant fills an empty incline and changes only its own (`sources.inclinePercent` `assistant`).
- Step 5, belt from the assistant: `log_step_results` takes `beltKmh` (the step's speed, and with no `distanceMeters` its distance over the step's time, as the results table writes a belt) and `inclinePercent`, written with source `assistant`, only on the steps of a treadmill run by its `workoutSessionId`. An outdoor run, a ride and the `plannedSessionId` path refuse them with the reason; `beltKmh` with `avgSpeed` is refused.
- Step 5, reads: `get_step_results` gives a treadmill run's frozen belt per step (`planned.belt`) and the result's `beltKmh` and `inclinePercent`. `get_ride` reads a run as `runReport` (`src/lib/run-report.ts`) with `sport` `run`; a ride's report gains `sport` `bike` and is otherwise unchanged.
- Step 5, which ride: `get_ride` takes `workoutSessionId`, `programExerciseId` or both (that exercise in that session), so the ride of a brick in one program can be read beside its run; the session alone gives the later one.
- Step 5, room for step 7: `numbers.stream` is false, `drift`, `timeOnTarget` and each step's `timeOnTargetPct` are null, `gapSPerKm` is null outdoors, heart rate zones are by step average (`zonesFrom: "steps"`) and `garmin` is null. Step 7 fills them.
- Step 5, the brick in `get_ride`: read from the brick ride's timeline without settling it (`brickTimes`, `src/lib/run-brick.ts`), so a read never writes a ride (D9).
- Step 5, a bug found: `edit_program_exercise` dropped a step's belt (`beltKmh`) on every write, in a set list and a tree. Fixed with a test first.
- Step 5, privacy: no new data class. The record and the policy now name runs among what `get_ride` reads, and belt and incline among what `log_step_results` writes. `LEGAL_VERSION` stays at the branch's `2026-11-20.1`, which is not released yet and covers this.
- Step 6, alert text (target first): a step change reads target, step, time ("8.0 km/h · Steady · 50 min", outdoors "HR under 160 · Steady · 50 min"); a minute alert reads "1 min left · next 8.0 km/h · Steady". On a treadmill the target is the step's frozen belt (with its own incline), else its heart rate, else "Belt by feel"; outdoors the target of 4.2 (`runOutdoorText`). A distance step shows its distance ("1 km"), not a time. Times have no colon ("1 min 30 s"), as for the bike. The last step's end says "Run done". Km only (R6), so a run's alerts ignore the units setting.
- Step 6, strides block (4.5): the block's start alert has the whole block as its title ("13.0 km/h · Strides 6 × 30 s · 1 min 30 s easy between"); the end of its last work round sends the recovery after it ("7.0 km/h · Easy · 1 min 30 s", body "Step 3 of 4 · Strides done"); the step after the block gets its own alert, as every step does. Steps are numbered as the step list numbers them (a block is one step).
- Step 6, later belt distance steps: the walk counts a treadmill distance step at its frozen belt, so the alerts after it have times; a belt event rewrites them. A distance step with no belt (by feel) has no end time, so its start is the last alert, as a lap step is for the bike.
- Step 6, brick run: an alert whose step starts in the first 10 min of a brick run outdoors names "Effort 4-5" (4.2); on a treadmill the belt stays first, as on the screen.
- Step 6, both modes get alerts when push is on; a treadmill run with the screen on sends heartbeats, so the server holds them back (bike 4.7). The alerts row stays outdoors only, before the start (step 2 choice), and says "Step alerts are off" while prod has no keys (R7).
- Step 6, the check on a dev setup with keys: not done in a browser. Headless Chromium has no push service (`pushManager.subscribe` never answers), and the bike step could not check it on the owner's phone for the same reasons (plain HTTP on the laptop). The integration tests run the schedule and the sender with throwaway VAPID keys made in the test (`webpush.generateVAPIDKeys`), with only the network call faked. The locked-phone check is in the BACKLOG entry that turns the keys on.
- Step 6, privacy: no new data class. `ride_pushes` now holds a run's alerts too (a run's title can name a heart rate target, never a reading); the record and the policy say "ride or run". `LEGAL_VERSION` stays at the branch's unreleased `2026-11-20.1`.
- Step 5 review, steps the assistant logs: a row counts as an earlier ride's (Ride again) only when the clock saved its time and that time is not this ride's; a row with no clock time is this ride's and takes the ride's time, and a status the assistant changed stays.
- Step 6 review, colons: a colon inside a time or pace value ("5:36-5:56 /km") is a number, not punctuation, and stays in alerts as the app shows paces everywhere; "no colons" means no punctuation colon. The alert test checks for a colon not between two digits, with an outdoor pace plan.
- Step 6 review, the step after a block: its alert names the step that just ended ("Step 4 of 4 · Easy done" after the last stride's recovery); only the end of the last stride says "Strides done".
- Step 7, treadmill distance (integration 2, "fills distance when there are no belt events"): read as "a step with no belt value". A step whose distance the belt gave (from its frozen belt, also with no tap) keeps it; Garmin fills distance and speed only on a step the belt never knew (by feel, no tap), as 4.8 says. R5 makes the belt the pace, and the owner's check after step 7 expects the belt's distance.
- Step 7, outdoor time: Garmin replaces a step's time only on an `estimate` step split by laps (its lap's moving time, source `garmin`); a time step keeps its clock time, so "time" in the 4.8 field list is the lap time of 4.8's second sentence.
- Step 7, GPS wins: a run Garmin moves from the treadmill outdoors (a run type with GPS positions in the run's part of the stream) takes Garmin's distance and speed over the belt's; the belt events and the old values stay (the fill's `previous`), and Undo puts back the belt values with source `belt` and the mode. A run type with no GPS keeps the run's mode.
- Step 7, multisport storage: the parser (version 4) keeps every session of a file as `session.segments` in `garmin_activity_streams` (sport, sub sport, start, times, distance), so no new table; the streams stay one series for the file and a part keeps the laps that start inside it. A fill row has a new column `segment` (0 for a one-sport activity), and the pair index is ride, activity and segment. A part that Garmin also lists as an activity of its own (start and end within 60 s) is one match, not two.
- Step 7, T2 from Garmin: the transition part right before the run, after a bike part, gives T2 for a run linked as a brick (it wins over the app's T2 in the summary and `get_ride`). The transition's own time is T2, without the 60 min rule (Garmin measured it).
- Step 7, re-sync: a run's fill stores when the activity's file was parsed (`previous.syncedAt`); the fill loop reads a run whose file was parsed again since and rewrites only the fields still marked `garmin`. For the file to come again, the activity list sync now clears `files_fetched_at` when a run's distance changes in Garmin's list (`fetchActivities`). Rides keep the bike rule (no re-sync).
- Step 7, stream speed: outdoor speed and grade come from the `distance` and `altitude` streams over 30 s (15 s each side); under 5 m in the span the grade counts as flat. A step's Garmin distance is from the last record before the step to its last record, so the steps add up to the run.
- Step 7, time on target: a heart rate cap or range that is the step's main target (on a treadmill its written heart rate, outdoors the 4.2 target shown) on steps of 8 min or more, as 4.2 judges heart rate; outdoors a pace that is the main target by the 30 s speed. A strides block, an effort and a treadmill pace (the belt is the pace) have none. Outdoors a pace step with Garmin's speed now also gets ↓ or ↑ in the summary.
- Step 7, decoupling steps: a steady step is a work step in no repeat and no strides block; warm-up, recovery and cool-down are left out, as the bike's drift leaves out warm-up and cool-down. The 45 min are the steady steps' seconds in the stream, counted before the first 10 min are left out. On a treadmill each second's speed is the belt then (frozen belt and the belt events the timeline counts in that step), with its incline, so each belt span weighs by its time.
- Step 7, run load: the stream's outdoor load and IF show in the summary and `get_ride`; `appSessionLoads` keeps the step load of step 4, because a user with a stream is a Garmin user and Garmin's load wins in pairing (4.9).
- Step 7, the chart: the bike's `RideDoneChart` with a line name. On a treadmill the line is the belt (km/h scale) and the bands the frozen belt ±0.25 km/h; outdoors the line is Garmin's 30 s speed on a pace scale (whole minutes) and the bands the pace ranges; heart rate dashed. No threshold line.
- Step 7, the summary: a Drift tile ("3%", "steady" under it) after Load, zones from the 1 s stream, "N% on target" under a step's done value, and the bike's Garmin row (Undo, Fill from Garmin, Pick) shared as `GarminFill`; a run's Pick lists start, time and distance ("16:01 · 29 min · 5.1 km").
- Step 7, fixtures: `src/__tests__/fixtures/fit/make-fit-fixtures.ts` writes three synthetic FIT files with the Garmin FIT SDK's encoder (treadmill, outdoor with GPS and laps, multisport with a ride, a 72 s transition and a run); no owner data.
- Step 7, privacy: no new data class. The record names a run's fill, the fill's multisport part and file time, and the multisport parts kept from the FIT file; the policy names a Garmin run filling a run. `LEGAL_VERSION` stays at the branch's unreleased `2026-11-20.1`.
- Step 8, Friel checked: his quick guide to setting zones (TrainingPeaks, "Joe Friel's Quick Guide to Setting Zones") gives LTHR as the average heart rate of the last 20 minutes and threshold pace as "your average pace for the entire 30 minutes (not the last 20 minutes)". The training numbers page took the pace from the last 20 minutes (`distanceLast20Meters` / 1200 s); the `run_30min` pace input is now `distance30Meters` / 1800 s, with a test first. Stored rows keep their test data, and a row with the old `distanceLast20Meters` keeps its formula (`OLD_INPUTS` in `src/lib/utils/thresholds.ts`), so a later update of it does not fail (step 8 review).
- Step 8, the templates: warm-up 9 min at heart rate zone 2, then 3 x (1 min pickup at effort 8, 1 min easy at effort 3), 15 min in all; the test as a 10 min and a 20 min work step, both effort 9-10 with the note "Run as hard as you can hold for 30 min" (an effort, so an old threshold does not pace the test, as the bike's 20 min test does); then a 10 min cool-down in zone 1 (4.10 names no cool-down; after an all-out 30 min the runner needs one, as the bike test has). 55 min. The treadmill one writes belt 10.0 on the 10 min step with "Start at 10.0 km/h, raise it if you can" in its note; the outdoor one has no belt. Outdoors the test steps show "Effort 9-10", never a heart rate cap.
- Step 8, the belt in the 20 min (overrides "the belt is the step's own" of 4.3 for this one step): on a treadmill test the 20 min step has no frozen belt and `run.carry`, so it starts at the belt the 10 min step ended on. Otherwise a runner who raised the belt would fall back to 10.0 at minute 10 and the pace would be wrong. The step list, the next card and the alert say "Keep the belt", the summary's plan column says "Same", and no belt cue fires before it.
- Step 8, which steps are the test: the longest work step on time (the 20 min) and the work step right before it (the first 10 min), as the bike's `allOutStep` picks its all-out step, so an edited test still reads.
- Step 8, the result: LTHR is the 20 min step's average heart rate (Garmin's, typed or the assistant's); threshold pace is the meters of both test steps over their seconds, stored as `distance30Meters` (that speed x 1800 s, so the field test gives back the same value). On a treadmill the pace counts when the runner tapped the belt during a test step, or when both test steps hold a typed, Garmin or assistant distance; belt meters with no tap are the plan's, so they give LTHR only (4.10, as the summary's "no belt changes"; step 8 review). Outdoors it needs both steps' distance. A value out of the sane range is left out; with neither there is no result.
- Step 8, the checks: "no stops" fails on a pause of more than 5 s in a test step (the clock rounds to the second); the pace check compares seconds per km of the 20 min with the first 10; the heart rate check uses the plan's frozen max HR; effort reads the run's effort. A check with nothing to read (no max HR, no effort, no distance) is not run and fails nothing.
- Step 8, the bands: each value is banded against the current one (5 bpm and 3% of the pace time; 10 bpm and 8%), and the line takes the worse band; with no current value it is Save. "Choose" shows the current and new values side by side above Save; leaving it unsaved keeps the current values, so there is no Keep button. "Retest" says "Far from your numbers now · Run the test again in 4 weeks" with Save in muted text, as a failed check does ("Test may be invalid" and the failed checks).
- Step 8, Save: `saveRunThreshold` takes only the run id, works the values out again from the stored run and adds one row per value through `addThreshold` with `once` (source test, protocol `run_30min`, measured on the run's date in the user's zone). Saved means every value the test gives has such a row. A manual value dated after the run stays the current one, as for any threshold.
- Step 8, the start checks: "No hard session in the last 48 hours" is a line on the run screen, not worked out from the log (4.10 gives no rule for a hard session). A sick period that is open, or whose last day is less than 7 days ago, keeps Start run off with "Wait 7 days after being sick", and `startRide` refuses the test with the same words. "Stop for chest pain, dizziness or unusual breathlessness" is always shown. On the paused screen of a test End run reads "Stop test". Stop test itself saves nothing to the thresholds: stopped before the 20 min step is done, the test gives no result; stopped in the cool-down, the 20 min step is done and the summary offers the result with Save as usual (step 8 review).
- Step 8, the assistant: `edit_program_exercise` takes `runTest: "treadmill" | "outdoor"` in place of `sets`, `workout` or `ftpTest`; `get_ride` gives a run's `thresholdTest` with the proposed and current values, band, checks, saved and the rows for `manage_thresholds`.
- Step 8, demo account: `steps-runtest@demo.local` (pace 5:39 and LTHR 180 dated a week back) has the treadmill test run 10 min before the seed at 10.9 km/h, the 20 min typed at HR 176: the summary offers "New threshold pace 5:30 /km · LTHR 176". Journey J7 of `scripts/journeys/runresults.journeys.ts` captures the line, Saved and "Run · Tempo" after Save at 390 and 320 px.
- Step 8, privacy: no new data class. The record names a run threshold test's LTHR and pace among the field tests a user saves; `LEGAL_VERSION` stays at the branch's unreleased `2026-11-20.1`.
- Step 8 review, the planned km of a treadmill test: the 20 min step has no belt of its own (it keeps the runner's), so the estimate before the start counts it at the belt of the step before (10.0 km/h); the run itself still carries the real belt.
- Final QA, a treadmill recovery with no target: its belt is effort 2, 5.5 km/h (4.2 rule 5), as it shows "Easy jog or walk" outdoors; "Set the belt by feel" stays for a step with no target that is not a recovery, and for no threshold and no history.
- Final QA, the Next card at 320 px (ride and run): a title with a round and a target ("Next Work · 1 of 2 · 15 min" and "135-146 W") does not fit one line even at 14 px, so it wraps between its parts, each dot kept with the part before it as on the Plan screens. This replaces "each stays on one line" of the bike brief's final review for the Next card.
- Final review, ended early with a ride and a run: `workout_sessions.ended_early` is true when the latest ride of any exercise of the workout ended early (the latest, so a finished Ride again or Run again clears it), not only the ride that settled last.
- Final review, a late belt after Run again: a late belt or incline event of an ended run is refused ("The ride has ended") once a later run of the same exercise started on the same workout, because both runs write the same step rows.
- Final review, incline of a plain bike set: the step moves of step 1 no longer write a null incline (`plainSetsToStepRows`), so a plain bike set with an incline keeps it on its step row. `buildWorkout` reads incline only for a run, so the bike's steps, targets and timeline do not change.
- Final review, an outdoor test with a typed total: a distance spread from the one typed total (source `typed` outdoors) gives LTHR only, because its pace is the whole run's average, warm-up and cool-down included. A Garmin, assistant or set-list distance still gives the pace.
- Final review, belts in zone order: in one plan a belt from a heart rate zone (history or the zone's slow end) is never faster than the slowest such belt of a higher zone, so a Z1 history of 8.5 km/h runs at Z2's 8.2 km/h. A belt written on the step, a pace belt and an effort belt stay as 4.2 gives them.
- Final review, heart rate edges (changes the step 2 line on caps): a zone's numbers are its whole heart rates as `runHrZoneOf` counts them (`runHrZoneBpm`), so the text, the arrow, time on target and time in zones agree. At LTHR 180 a cap reads "HR under 153" (Z1) and "HR under 162" (Z2), the first bpm of the next zone, and passes up to 161; a range reads "HR 153-161". The mockups' "under 151" and "under 160" were 1 bpm under the zone edge. A cap of the runner's own bpm ("HR under 150") passes up to 149.
- Final review, the 6 min cue (4.2 rule 4): on a treadmill a heart rate step over 6 min whose belt is its zone's slow end (`beltFrom` `zone`) shows "Adjust after 6 min to hold HR 153-161" in the Next card's place from its start until 7 min in, so it is there when the minute comes; a belt cue for the next step wins. A belt from history, the step or a pace needs no cue. Without an LTHR there is no cue.
- Final review, one pace rule (extends the step 4 line on `paceText`): every run pace, in run mode, the step list, the pace ranges, the summary, the alerts, `get_ride` (`paceSPerKm`, `gapSPerKm` and the threshold texts) and the threshold reads of `get_athlete_profile`, is cut to the whole second by `paceSeconds`, with a tenth of a millisecond of slack so a threshold stored as a real number keeps its second (5:45 stays 5:45). The mockup run still reads 7:39 /km. Pace ranges now cut too, so the owner's Z4 reads 5:35-5:55 /km as the 4.2 table's 5:35 does.
- Final review, carry in `get_ride`: a treadmill step's plan gives `carry` (true on the 20 min of a run test), so its null `beltKmh` does not read as by feel.
- Final QA, summary tiles with Drift: the tiles are the mockup's six (Time, Distance, Pace, Avg HR, Load, Drift). The Effort tile of step 4 shows only while there is no Drift, so a seventh tile never sits alone on a third row.
