# Bike sessions: the full plan

Status: plan, no build yet. Scope: the indoor trainer bike session, from plan to result. Run,
swim and brick follow later, by the same pattern ([endurance journeys](endurance-journeys.md)).
Screens: [`docs/design/endurance/bike-flow.html`](../design/endurance/bike-flow.html).

The plan uses the owner's two real bike sessions as examples: "Bike tempo" (Tuesday) and "Long
ride" (Sunday) in the cycle "General: aerobic base + strength". The data was read from the
production database, read only, on 2026-11-15.

## 1. What the owner wants

Open the app on a bike day and know, with no guessing and no notes:

- total time, hard time and distance;
- the warm-up, main set and cool-down;
- for every step: duration, watts (and % FTP), heart rate in bpm with the Garmin zone, cadence,
  and gradient where it matters;
- how to record it on the Garmin watch;
- after the ride: what was done against what was planned, per step, with no typing.

## 2. The real sessions today

| Session | Stored as | Sets | The real instructions live in |
|---|---|---|---|
| Bike tempo, Tue, priority support | program 92, path A | 15 min Z2 (warm-up), 15 min Z3, 5 min rest, 15 min Z3, 15 min Z2 | exercise note: "Indoor trainer. Zone 3 = about 135-145 W (75-80 % FTP), HR 158-163. Cadence 85-95. Not a hard session: you must be able to talk in short sentences." |
| Long ride, Sun | program 94, path A | 135 min Z2 | exercise note: "Zone 2 = about 110-130 W, HR 142-155. Steady, no surges. Practise eating: 40-60 g carbs per hour from 60 min." |

The app shows "Bike 15 min" rows and "Z3". Watts, bpm, cadence and the fuel rule are only in the
note, and the note shows on no screen before the ride.

## 3. The numbers disagree

This is the first problem to solve. A clear screen with wrong numbers is worse than a vague one.

| Number | App | Garmin | Evidence |
|---|---|---|---|
| FTP | 180 W (`athlete_thresholds`, source garmin, 2026-11-14) | 266 W (`functionalThresholdPower` in each ride's summary) | Recent 60 min rides: 186 W, 159 W, 167 W average power. Best 20 min power in a ride: 189 W. |
| Bike LTHR | 175 bpm (manual) | 171 bpm (`lactateThresholdHeartRateUsed`, CYCLING) | |
| Bike HR zones | Friel % of LTHR 175: Z2 142-155, Z3 158-163 (the notes use these) | HR max method, max 201: Z1 101-120, Z2 121-140, Z3 141-160, Z4 161-180, Z5 181-201 | `hr_zones` snapshot 2026-11-15 |

Consequences on the watch today:

- Long ride "HR 142-155" is Garmin Z3, not Z2. The watch says Z3 for the whole ride.
- Tempo "HR 158-163" crosses from Garmin Z3 into Z4.
- Watch power zones use FTP 266. "135-145 W" is about 51-55 % of 266, power Z1 on the watch.
- A 60 min ride at 186 W average with average HR 143 is above an FTP of 180. FTP 180 is too
  low, and 266 is far above the best 20 min power. The true FTP is unknown.

Rules the plan sets (D1 and D2, decided 2026-11-15: automatic from Garmin data, with override):

1. FTP is estimated automatically from the Garmin rides of the last 90 days. Today the estimate
   is 95 % of the best 20 min power (`thresholdHistory`, `src/lib/garmin/analytics/trends.ts`,
   `FTP_FACTOR`). That gives 180 W and misses rides with no hard 20 min. The new estimate takes
   the highest of: 95 % of the best 20 min power, the best 60 min average power, and critical
   power (`criticalFit`, same file). With the real data: max(180, 186, CP). The estimate shows
   its basis: "186 W, best 60 min on 10 Nov".
2. The estimate updates itself after each sync when it moves by 3 % or more. Each update is a
   threshold revision with source `garmin`, so it shows in the plan history and has Undo. The
   session page says "FTP changed from 180 to 186 W" once.
3. Override: on the session page and on Thresholds the user sets an FTP by hand. A manual or
   test value pins the FTP until the user removes it, or until a newer test. The override sheet
   holds a short "How to test" note: 20 min warm-up, 5 min hard, 10 min easy, 20 min steady all
   out, take 95 % of the average; or the in-app FTP test workout (7.3).
4. The watch FTP (266 W, `functionalThresholdPower`) is shown next to it. When it differs by
   more than 5 %, the page says so and tells the user to set the watch FTP to the app value, so
   the watch power zones match.
5. HR targets resolve from the Garmin CYCLING zones of the last sync, in bpm, labelled "Garmin
   Z2". They follow Garmin automatically. Override: the user can set custom bike HR zones on
   Thresholds; the label then says "Your Z2". The Friel tables are the fallback when no Garmin
   zones exist, labelled "estimate".

## 4. The bike sessions as structured workouts

Both sessions move to structured workouts (path B). Numbers below use FTP 180 and the Garmin
CYCLING zones. The new FTP estimate (section 3) is about 186 W with the real data, so every watt
target rises about 3 % when phase 0 ships. HR follows the Garmin zones.

### 4.1 Bike tempo, 65 min, hard 30 min

| # | Step | Duration | Power | HR | Cadence | Note |
|---|---|---|---|---|---|---|
| 1 | Warm-up | 15 min | 108-130 W (60-72 % FTP) | under 140 (Garmin Z2) | 85-95 | Build up in the last 5 min |
| 2 | Work | 15 min | 135-144 W (75-80 % FTP) | 141-160 (Garmin Z3) | 85-95 | Talk in short sentences |
| 3 | Recovery | 5 min | 90-108 W (50-60 % FTP) | under 140 | free | |
| 4 | Work | 15 min | 135-144 W | 141-160 (Garmin Z3) | 85-95 | Same as block 1 |
| 5 | Cool-down | 15 min | 108-130 W | under 140 | free | |

Laps on the watch: 5 steps, so press Lap 4 times.

### 4.2 Long ride, 135 min

The fuel rule becomes steps, so the watch beeps and the player shows "Eat now".

| # | Step | Duration | Power | HR | Note |
|---|---|---|---|---|---|
| 1 | Warm-up | 15 min | 90-120 W | under 140 | |
| 2 | Steady | 45 min | 110-130 W (61-72 % FTP) | 121-140 (Garmin Z2) | No surges |
| 3-5 | Steady, repeat 3 times | 20 min | 110-130 W | 121-140 | "Eat 15-20 g carbs now" |
| 6 | Steady | 10 min | 110-130 W | 121-140 | "Eat 15-20 g carbs now" |
| 7 | Cool-down | 5 min | under 110 W | under 120 | |

Total 135 min. Fuel: cues at 60, 80, 100 and 120 min = 40-60 g per hour. Laps: 7 steps, press
Lap 6 times.

D2 decided: the long ride uses Garmin Z2 (121-140 bpm today) and follows Garmin when the zones
change. The old note said 142-155, which is Garmin Z3.

## 5. Screens

Each screen is drawn in `bike-flow.html` with the real sessions. The table lists every element,
what it shows, its data source, and the state of the code.

### 5.1 Home, Today card (bike day)

| Element | Shows | Source | State |
|---|---|---|---|
| Kicker | "Today · Bike · Indoor" and priority | session, `priority` | CHANGE |
| Title | "Tempo 2 x 15 min" | `workout.name` | CHANGE (path B on the Today card) |
| Totals | "65 min · 30 min at 135-144 W" | `estimateWorkout`, new `hardSeconds` | NEW |
| Block chart | 5 blocks, height = % FTP, colour = power zone | steps, FTP | NEW |
| Lines | Warm-up 15 min 108-130 W; Main 2 x 15 min 135-144 W, HR 141-160; Cool-down 15 min | new `groupWorkout` | NEW |
| FTP chip | "FTP 186 W · from your rides"; "Watch FTP differs" when the watch is more than 5 % off | FTP estimate, ride `functionalThresholdPower` | NEW |
| Details | opens the session page | | EXISTS (row link) |
| Start guided | opens the player | | EXISTS |

On a day with only this session, the card must replace the "Rest Day" hero. Today it reads "Rest
Day" (audit 2.12 #8).

### 5.2 Session page, before the ride `/planned/[id]`

| Element | Shows | Source | State |
|---|---|---|---|
| Header | Date, "Bike · Indoor trainer", priority | session | CHANGE |
| Totals tiles | 65 min, 30 min hard, load about 55 | estimate, planned load | CHANGE |
| Profile chart | blocks over time, FTP line dashed, axis in minutes | steps | NEW |
| Coach note | "Not a hard session: you must be able to talk in short sentences." | `workout.description` | CHANGE (not shown today) |
| Step cards | grouped: Warm-up / Main set / Cool-down. Each card: big duration, big watts, % FTP and power zone, HR chip "141-160 bpm · Garmin Z3", cadence chip, gradient chip when set, step note | resolver | CHANGE |
| Your numbers | FTP 180 W (app, 14 Nov) · Garmin CYCLING HR zones Z1-Z5 in bpm · power zones in W | thresholds, `hr_zones` snapshot | NEW |
| FTP line | "FTP 186 W, from your rides (best 60 min, 10 Nov)" with "Change". Once after an update: "FTP changed from 180 to 186 W". When the watch differs: "Your watch uses 266 W. Set it to 186 W so the watch power zones match." | FTP estimate, threshold revisions, ride `functionalThresholdPower` | NEW |
| Change FTP sheet | Automatic (from your rides) or Set by hand; "How to test" note; "Plan an FTP test" adds the test workout (7.3) | `manage_thresholds` path in the app | NEW |
| Record on Garmin | "Indoor Bike. Trainer paired. Auto Lap off (it is on: your rides have 5 km laps). Auto Pause off. Start with the warm-up. Press Lap 4 times, at each step change. Do not pause in the easy step." | built from the steps; Auto Lap hint from `lapTrigger: distance` in the last ride | NEW |
| Actions | Start guided · Edit · Move · Skip | | Start EXISTS; Edit NEW; Move, Skip on this page NEW |

### 5.3 Edit: the full workout editor

Decision D3 (2026-11-15): a full editor in the app. Rule for the whole app: everything the
assistant can do over MCP, the user can do in the app without AI. The assistant stays a helper.

Both paths write the same thing: the workout JSON, checked by the same `parseWorkout`, saved as a
revision with Undo. The assistant path is unchanged (`manage_planned_session set_workout`,
`manage_workout`).

Where the editor opens:

| From | Opens with | State |
|---|---|---|
| Session page "Edit" | this session's workout | NEW |
| Workouts library row "Edit" | the library workout | NEW (library has rename, duplicate, delete only) |
| Workouts library "New workout" | an empty bike workout | NEW (no create in the app today) |
| Template builder slot "Use a workout" | pick a library workout for the slot | NEW (app slot schema has no `workoutId`) |
| Calendar day "Add session" | pick a library workout or "New" | NEW (app `add` needs a `programId`) |

Editor screen, top to bottom:

| Element | Does |
|---|---|
| Name | text field, required |
| Sport and place | Bike · Indoor or Outdoor |
| Coach note | the workout description, max 1000 characters |
| Live summary | total time, hard time, planned load, profile chart; updates on each change |
| Step list | one card per step, in order; a repeat shows as a block with its count |
| Drag handle | reorders steps, and moves a step into or out of a repeat |
| Step menu | Duplicate, Delete |
| "Add" | Step, Repeat, or a block from a template |
| "Easier 5 %" / "Harder 5 %" | scales every work and steady target |
| Save | opens the save sheet |
| Cancel | asks before it drops unsaved changes |

Step sheet:

| Field | Values |
|---|---|
| Type | Warm-up, Work, Recovery, Steady, Cool-down, Rest |
| Ends by | Time (minutes and seconds), Distance (km), or Lap button |
| Main target | Power: W, % FTP or power zone; or HR: bpm or Garmin zone. A range, or one side only ("under 140") |
| Second target | the same choices; for example HR under 140 on a power step |
| Cadence | rpm range, or none |
| Gradient | %, or none (sim trainers and outdoor climbs) |
| Note | max 140 characters, shown in the player |

Every number shows its other forms as you type: "140 W = 78 % FTP, power Z3".

Repeat block: count stepper (2-50), "Add step to repeat", "Ungroup". One level, as the schema
allows.

Templates for "Add": Warm-up 15 min, Tempo 2 x 15 min, Sweet spot 3 x 12 min, Threshold
2 x 20 min, VO2 5 x 4 min, Over-unders 3 x (2 + 1) min, Fuel cue (20 min steady with "Eat
15-20 g carbs now"), Cool-down 10 min, FTP test (7.3). A template inserts normal steps the user
can change.

Save sheet:

| Choice | Writes |
|---|---|
| This session | the session's workout copy (`set_workout`) |
| This and later sessions | the library workout (`manage_workout update`); untouched later sessions follow. Sessions changed by hand keep their version, and the sheet lists them: "Tue 1 Dec keeps its own version" |
| Save as a new library workout | `manage_workout create` |

Rules:

- A done or started session cannot change.
- Errors show at the field, with the text `parseWorkout` returns.
- The training limits run in warn mode. A broken rule shows in the save sheet before Save.
- Every save is a revision with writer `user`. Undo is in Plan history.

In-app parity for the bike scope (MCP only today, audit 1.9 #1-#4):

| Capability | In-app control |
|---|---|
| Create and edit workout steps | the editor |
| Workout on a template slot | template builder "Use a workout" |
| Add a dated workout session | calendar "Add session" |
| Priority on a dated session | session page menu: Key, Support, Optional |
| Pull the newest library copy (`update_from_library`) | session page menu "Update from library" |
| Pair and unpair a Garmin ride (`pick`, new `unpick`) | "Not this activity" (5.5) |
| Undo a missed mark (`unmiss`) | session page "Not missed" |

### 5.4 Start: guided player `/planned/[id]/play`

Ready screen:

| Element | State |
|---|---|
| The record box in short form (Indoor Bike, Auto Lap off, press Lap 4 times) | NEW |
| Test sound, Start | EXISTS |

Running screen, top to bottom:

| Element | Shows | State |
|---|---|---|
| Step label | "WORK · 1 of 2" | EXISTS |
| Clock | time left in the step | EXISTS |
| Main target | "135-144 W" large | EXISTS |
| Second line | "75-80 % FTP · HR 141-160 · 85-95 rpm" | NEW (one target only today) |
| Note | "Talk in short sentences" | EXISTS |
| Progress bar | the profile chart with a marker at "now" | NEW |
| Next | "Next: Easy 5 min · 90-108 W" | EXISTS |
| Cue at step change | tone, and "Press Lap" in the step label for 3 s | CHANGE (tone EXISTS) |
| Buttons | Pause, +30 s, Skip, Finish | EXISTS |

The player has no live watts or HR. The watch shows them. The player is a step clock that keeps
the phone and the watch in step.

### 5.5 After the ride, session page

The watch syncs. The worker fetches the activity and its FIT file (laps and streams). The
production data proves this path works: every indoor ride has laps with `avgPower`,
`normalizedPower`, `avgHeartRate`, `maxHeartRate`, `avgCadence`, `totalTimerTime`,
`totalDistance` and `lapTrigger`.

| Element | Shows | Source | State |
|---|---|---|---|
| Band | "On plan" and "65 of 65 min" | `complianceBand`, ratio | CHANGE (ratio not printed) |
| Recorded on Garmin | "Indoor Cycling · 65:12 · 27.1 km · NP 141 W · avg HR 147", link to the activity page | paired activity | NEW |
| Not this activity | sheet with the day's rides; pick one or "None of these" | op `pick`, new `unpick` | NEW |
| Profile chart, after | planned blocks with the real power line on top | streams | NEW |
| Step table | per step: planned watts and HR; done avg W, NP, avg and max HR, cadence; a mark "in range", "under", "over" | laps or time cuts | NEW |
| Match note | "Matched by laps: 5 of 5" or "Matched by time: 7 laps did not fit 5 steps" | matcher | NEW |
| Time in Garmin zone | for the work steps, time in the target HR zone | streams, Garmin zones | NEW |
| Effort | RPE 1-10, one tap, or the watch RPE when set | `directWorkoutRpe` (0-100, shown on the activity page today) | CHANGE |
| Fuel (long ride) | "Carbs taken?" with the 40-60 g/h target | `fuel_logs` | EXISTS on the activity page; NEW here |

How a step is matched:

1. Laps that Garmin made by distance (`lapTrigger: distance`) are dropped first.
2. When the remaining lap count equals the step count, lap N is step N.
3. Else, cut the stream by the planned step times from the start of the activity.
4. A step is "in range" when its average power is inside the target range, and "over" or
   "under" by more than 5 % else. HR is checked against the cap only.

Where the results are stored: decision D4. Facts: `workout_step_results.workoutSessionId` is NOT
NULL, and a Garmin-paired session has no `workout_sessions` row (review, audit 4.13 #9).
Recommended: when the worker pairs an activity with a planned session, it writes a
`workout_sessions` row with a new source `garmin`, linked to the planned session and the
activity, plus the step results. This also puts the ride in history, in the done marks and in
metrics. Pairing moves from "computed on every read" to "stored once by the worker"; a pick or
unpick in the app replaces it.

### 5.6 Week `/week`, bike rows

| Element | State |
|---|---|
| Row: "Tue · Tempo 2 x 15 min · 65 min · 135-144 W" with a link to the session page | CHANGE |
| Done row: band and "NP 141 W" | NEW |
| Bike total: done against planned time and load | EXISTS |

## 6. Data model changes

| Change | Where | Why |
|---|---|---|
| Step gets `secondary` (one more target: HR cap on a power step) | `src/lib/utils/workout-steps.ts` schema, `docs/mcp/workout-steps.md` | "135-144 W and HR 141-160" on one step |
| One-sided range: `high` without `low` and `low` without `high` | same | "HR under 140" |
| `gradePercent` on a step, optional | same | climbs on a sim trainer; shown only when set |
| HR zone targets resolve from the Garmin snapshot | resolver, `snapshotZones` | bpm matches the watch |
| Resolver returns all forms: W, % FTP, power zone; bpm, Garmin zone | resolver | no arithmetic for the user |
| `workout_sessions.source` gains `garmin`; row links `garminActivityId` | `src/db/schema/workout-sessions.ts`, migration | stored pairing, history, step results (D4) |
| New op `unpick` | `src/lib/planned-sessions.ts` | correct a wrong pair |

No change to `program_sets`. Strength is untouched.

## 7. Build order (bike only)

The phases are built in parallel by spokes and merged by the hub into one branch (section 10).
The table gives the order of value and the "done when" check for each phase.

| Phase | Content | Done when |
|---|---|---|
| 0 Numbers | new FTP estimate and its auto update, override with "How to test", Garmin CYCLING zones in the resolver, custom zone override, watch FTP note | the session page shows the same HR zone the watch shows, and an FTP with its basis |
| 1 Before | Today card with path B (and the Rest Day fix), session page before (5.2), record box, links from `/week`, the cycle sheet and the calendar | the owner can read Tuesday's tempo on one screen with no note |
| 2 Step model | `secondary`, one-sided range, `gradePercent`; player second line and progress bar (5.4) | tempo steps show watts and HR together |
| 3a Editor | the editor and step sheet on a session (5.3), save sheet, Undo | the tempo becomes 3 x 12 min in the app, with Undo |
| 3b Library and templates | create, edit and templates in the library; "Use a workout" on a slot; "Add session" on the calendar | a new bike workout is built and planned with no AI |
| 3c Parity | priority, update from library, not missed | every bike action over MCP has an app control |
| 4 After | stored pairing with source `garmin` (D4), step matching, after view (5.5), pick and unpick | after a ride, the page shows the step table with no typing |
| 5 Move the plan | the assistant rewrites the future bike sessions as workouts (4.1, 4.2) | no bike session left on path A |
| 6 Optional | Download .fit for the watch | the watch runs the steps |

### 7.3 FTP test session

A library workout the assistant adds this week: 20 min warm-up with 2 x 1 min high cadence,
5 min easy, 5 min hard, 10 min easy, 20 min all out (steady), 10 min cool-down. The after view
reads the 20 min step's average power, and offers "Set FTP to 95 % of 20 min power (N W)". Save
writes `manage_thresholds` with source `test`.

## 8. Decisions

| # | Decision | Answer (2026-11-15) |
|---|---|---|
| D1 | FTP | automatic estimate from Garmin rides, updates itself; manual override with a "How to test" note (section 3) |
| D2 | Bike HR | Garmin CYCLING zones, automatic; override with custom zones (section 3) |
| D3 | Edit | full editor in the app; everything works without AI (5.3) |
| D4 | Store Garmin pairs as `workout_sessions` rows with source `garmin` | yes |
| D5 | Pairing minimum | a ride under 50 % of the planned time does not pair by itself; it can be picked by hand |
| D6 | Fuel cues as steps on long rides | yes |

## 9. Tests per phase

- Unit: resolver forms (W, % FTP, zone; bpm from the Garmin snapshot, fallback label);
  `groupWorkout`; step matcher (laps equal, distance laps dropped, time cuts); one-sided range
  parse; `unpick`.
- Integration: pairing writes one `garmin` session per planned session; a pick replaces it; a
  second sync does not duplicate.
- E2E (local dev): the Today card and session page for the tempo session at 390 px; edit a
  step and Undo; after view from a fixture activity with 5 laps and one with 7 laps.

## 10. Build: hub and spokes

The hub (the main session) owns the integration branch, the contract, every merge and the
checks. Each spoke builds one package in its own worktree, on a branch off the contract commit.
A spoke commits with no trailers and never pushes. It stays inside its own files. When it needs
a change in a file it does not own, it says so in its report, and the hub makes the change.

### 10.1 Branches

| Branch | Base | Holds |
|---|---|---|
| `feat/bike-sessions` | `docs/endurance-journeys` | the contract, then every spoke merge |
| `feat/bike-s1-numbers` ... `feat/bike-s5-after` | the contract commit | one package each |

One PR from `feat/bike-sessions` to `main` after the owner tests it in the local dev stack.

### 10.2 H0 contract (hub, before any spoke starts)

One commit on `feat/bike-sessions`. It fixes the shapes the spokes share, so all five can run at
the same time.

1. Step schema in `src/lib/utils/workout-steps.ts`: `secondary` (a target, optional),
   `gradePercent` (optional, -20 to 20), and one-sided ranges (`low` or `high` may be absent, at
   least one is present). `parseWorkout` accepts them. Old workouts parse unchanged.
2. Types, with stub bodies: `ResolvedForms` (W, % FTP, power zone; bpm, HR zone and its label
   "Garmin Z2", "Your Z2" or "estimate"), `ZoneSet` (source and five bpm bands), `WorkoutGroup`
   (warm-up, main set, cool-down), `groupWorkout()`, and `hardSeconds` on `WorkoutEstimate`.
   `resolveWorkout()` takes `{ units, zones }` as its third argument.
3. `src/lib/bike-numbers.ts` (*new*): `getBikeNumbers(userId)` returns `{ ftp: { value, basis,
   source, changedFrom }, watchFtp, zones }`. The stub reads the current FTP threshold only.
4. `src/lib/garmin/after-sync.ts` (*new*): `afterActivitiesSynced(userId, activityIds)`, called
   from the worker after activities and FIT files are stored. It calls two empty functions:
   `updateFtpEstimate` (S1) and `storePairings` (S5), each in its own file.
5. Mount points on the session page, as empty components: `<FtpLine/>` (S1), `<AfterRide/>`
   (S5). S3 places them; their owners fill them.
6. Fixtures in `src/__tests__/fixtures/bike-sessions.ts` (*new*): the tempo and long ride as
   path B workouts (4.1, 4.2), the Garmin CYCLING zones and watch FTP from the real data, and
   two FIT lap sets (5 laps; 7 laps with 2 distance laps). No user ids or activity ids from
   production.

Done when: `pnpm verify` passes on the contract commit.

### 10.3 Packages

| Spoke | Phases | Owns (files) |
|---|---|---|
| S1 Numbers | 0, FTP part of 7.3 | `src/lib/garmin/analytics/trends.ts`, `src/lib/garmin/analytics/thresholds.ts`, `src/lib/bike-numbers.ts`, `src/lib/garmin/ftp-estimate.ts` (*new*), `src/lib/athlete-profile.ts`, `ThresholdsClient`, `ThresholdEditor`, `src/app/more/thresholds/**`, `src/components/features/bike/FtpLine.tsx` and `FtpSheet.tsx` (*new*), migration A (custom bike HR zones) |
| S2 Step library | model part of 2 | `src/lib/utils/workout-steps.ts` (resolver forms, labels for one-sided ranges, `hardSeconds`), `src/lib/utils/workout-group.ts` (*new*), `src/lib/planned-view.ts`, `docs/mcp/workout-steps.md`, the field descriptions in the MCP workout tools |
| S3 Before and player | 1, player part of 2 | `src/components/features/home/widgets/today/View.tsx` (bike card, Rest Day fix), `src/app/planned/[id]/page.tsx`, `src/components/features/bike/{ProfileChart,StepCards,RecordBox,YourNumbers}.tsx` (*new*), `src/components/features/guided/**` except `StepResultsForm.tsx`, `src/app/planned/[id]/play/**`, `src/app/week/page.tsx`, `CycleDetailClient` (links only) |
| S4 Editor and parity | 3a, 3b, 3c, FTP test workout of 7.3 | `src/components/features/workout-editor/**` (*new*), `src/app/planned/[id]/edit/**` (*new*), `src/app/more/workouts/**`, `WorkoutsLibraryClient`, `src/lib/workouts.ts`, `CycleScheduleBuilder`, `CycleCalendarClient`, `src/app/more/calendar/**`, `PlannedSessionActions`, the app cycle slot validator |
| S5 After | 4, after view of 7.3 | `src/db/schema/workout-sessions.ts`, migration B (source `garmin`, link to the activity), `src/lib/garmin/pairing.ts` (*new*), `src/lib/session-compliance.ts`, `src/lib/utils/step-match.ts` (*new*), `src/lib/utils/step-results.ts`, `StepResultsForm.tsx`, `src/app/planned/[id]/results/**`, `src/components/features/bike/after/**` (*new*), op `unpick` in `src/lib/planned-sessions.ts`, its validator and the MCP planned sessions tool |

Notes per spoke:

- S1: the FTP estimate is max(95 % of best 20 min, best 60 min, CP) over 90 days, with its
  basis text. An update of 3 % or more writes a threshold revision with source `garmin`. A
  manual or test value pins the FTP. The HR resolver order is custom zones, Garmin CYCLING
  zones, Friel estimate. Done when: with the fixtures, `getBikeNumbers` returns 186 W with the
  basis "best 60 min", Garmin Z2 121-140, and the watch note for 266 W.
- S2: pure functions only, unit tests for every form and label. Done when: the tempo fixture
  resolves to the numbers in table 4.1, and `groupWorkout` gives warm-up, main 2 x 15 min,
  cool-down.
- S3: build against the contract and the fixtures. At 390 px, every screen matches
  `bike-flow.html`. Done when: the e2e spec shows the tempo session on the Today card and the
  session page with watts, % FTP, HR in bpm with the Garmin zone, and cadence.
- S4: every save goes through `parseWorkout` and writes a revision with writer `user`. Done
  when: the e2e spec changes the tempo to 3 x 12 min, saves for this session, and undoes it,
  and builds a new library workout and plans it on the calendar with no AI.
- S5: the matcher drops distance laps, then matches by lap count, else by time cuts. A pick or
  unpick replaces the stored pair. A second sync does not make a second row. A ride under 50 %
  of the planned time does not pair by itself (D5). Done when: the integration tests for the
  5-lap and 7-lap fixtures pass, and the after view shows the step table.

### 10.4 Rules for every spoke

- Follow `CLAUDE.md` and `TESTING.md`: the Server Action template, `callAction()`, Zod, `userId`
  from the session, tests at the right layer, a failing test first for a bug fix.
- Touch targets of 44 px or more. Real buttons and labels. `aria-label` on icon buttons.
- Every capability you add over MCP has an app control in the same package.
- Run `pnpm verify` (in a worktree, set `TEST_DATABASE_URL` to the compose Postgres) before you
  report.
- New stored or shown user data: run the `privacy-compliance` skill (S1 custom zones, S5 stored
  pairs).
- The report lists: what was built, the tests added, files outside your list you needed, and
  anything not done.

### 10.5 Hub merge and checks

1. Merge order: S2, S1, S5, S3, S4. The hub renumbers migrations A and B at merge and runs
   `pnpm db:generate` so the Drizzle journal does not clash.
2. After each merge: `pnpm verify`.
3. After the last merge: wire `<FtpLine/>` "Plan an FTP test" to the S4 FTP test workout, then
   `make e2e` and the smoke pass in `CLAUDE.md` (schema migration and the Today card are
   critical flows).
4. Local dev stack with a copy of the two real sessions as path B: check every "done when" in
   section 7, phases 0 to 4, at 390 px.
5. A Fable agent audits the merged branch, read only, against this plan. The hub fixes what
   it finds.
6. The owner tests locally. Then one PR to `main`, merged when CI is green.

### 10.6 After the merge

- Phase 5: the assistant rewrites the future bike sessions as workouts 4.1 and 4.2 over MCP in
  production. The hub asks the owner before it writes to production data.
- Phase 6 (.fit download) is not in this build. It goes to `BACKLOG.md` when the PR merges.
