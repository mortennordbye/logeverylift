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

Rules the plan sets:

1. HR targets resolve from the Garmin CYCLING zones, in bpm, labelled "Garmin Z2". The app's
   Friel tables are the fallback only, labelled "estimate".
2. Power targets resolve from one FTP. The session page shows which FTP and its source. When the
   app FTP and the watch FTP differ by more than 5 %, the page shows a "Numbers differ" card.
3. The card offers: use the app FTP, use the watch FTP, or plan an FTP test (section 7.3).
   The owner chooses. The app never picks one in silence.

Decision D1 (owner): which FTP to use until a test. Recommended: plan a 20 min test this week
and keep 180 W until then, because the watts in the notes are built on 180.

## 4. The bike sessions as structured workouts

Both sessions move to structured workouts (path B). Numbers below use FTP 180 and the Garmin
CYCLING zones. They change when D1 changes.

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

Decision D2 (owner): HR for the long ride. Garmin Z2 is 121-140. The note said 142-155. Recent
rides at 159-186 W averaged HR 136-143. Recommended: Garmin Z2 with a cap at 140.

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
| "Numbers differ" chip | shown when D1 is open | thresholds against Garmin FTP | NEW |
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
| Numbers differ card | "Your watch uses FTP 266 W. This plan uses 180 W." with three choices | thresholds, last ride `functionalThresholdPower` | NEW |
| Record on Garmin | "Indoor Bike. Trainer paired. Auto Lap off (it is on: your rides have 5 km laps). Auto Pause off. Start with the warm-up. Press Lap 4 times, at each step change. Do not pause in the easy step." | built from the steps; Auto Lap hint from `lapTrigger: distance` in the last ride | NEW |
| Actions | Start guided · Edit · Move · Skip | | Start EXISTS; Edit NEW; Move, Skip on this page NEW |

### 5.3 Edit

Two ways, same result: the session's workout changes, a revision is written, and Undo exists.

A. Ask the assistant (MCP, EXISTS): "Make Tuesday's tempo 3 x 12 min". The assistant calls
`manage_planned_session set_workout` with a reason. The training limits check it.

B. In the app (NEW, small): "Edit" on the session page opens edit mode.

| Control | Does | Writes |
|---|---|---|
| Tap a step | opens the step sheet | |
| Step sheet: duration stepper (1 min) | changes the step time | |
| Step sheet: power stepper (5 W), shown with % FTP | moves the target range | |
| Step sheet: HR cap picker (Garmin zone or bpm) | sets the secondary target | |
| Step sheet: cadence range | sets cadence | |
| Repeat count stepper on a repeat | changes "2 x" | |
| "Easier 5 %" / "Harder 5 %" on the session | scales every work target | |
| Save | "This session" or "This and later Bike tempo sessions" | op `set_workout` (this session); `manage_workout update` of the library copy (later sessions) |
| Cancel | drops the changes | |

What edit does not do: add or remove steps, change step types, build a workout from nothing.
That stays with the assistant (decision D3).

Rules: a done or started session cannot change. The app runs the training limits in warn mode
and shows a broken rule before Save. Every save is a revision with writer `user`.

Decision D3 (owner): in-app edit as above, or assistant only. Recommended: the small editor,
because changing "15 min" to "12 min" on the way to the trainer should not need a chat.

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

Each phase is one PR. Each ships alone and is tested in the local dev stack with a copy of the
two real sessions.

| Phase | Content | Done when |
|---|---|---|
| 0 Numbers | Garmin CYCLING zones in the resolver; FTP source shown; "Numbers differ" card; D1 settled | the session page shows the same HR zone the watch shows |
| 1 Before | Today card with path B (and the Rest Day fix), session page before (5.2), record box, links from `/week`, the cycle sheet and the calendar | the owner can read Tuesday's tempo on one screen with no note |
| 2 Step model | `secondary`, one-sided range, `gradePercent`; player second line and progress bar (5.4) | tempo steps show watts and HR together |
| 3 Edit | in-app edit (5.3), if D3 says yes | "15 min" becomes "12 min" in three taps, with Undo |
| 4 After | stored pairing with source `garmin` (D4), step matching, after view (5.5), pick and unpick | after a ride, the page shows the step table with no typing |
| 5 Move the plan | the assistant rewrites the future bike sessions as workouts (4.1, 4.2) | no bike session left on path A |
| 6 Optional | Download .fit for the watch | the watch runs the steps |

### 7.3 FTP test session (if D1 picks a test)

A library workout the assistant adds this week: 20 min warm-up with 2 x 1 min high cadence,
5 min easy, 5 min hard, 10 min easy, 20 min all out (steady), 10 min cool-down. The after view
reads the 20 min step's average power, and offers "Set FTP to 95 % of 20 min power (N W)". Save
writes `manage_thresholds` with source `test`.

## 8. Decisions for the owner

| # | Decision | Recommended |
|---|---|---|
| D1 | FTP until a test: 180 (app), 266 (watch), or a test this week | keep 180, test this week |
| D2 | Long ride HR: Garmin Z2 121-140, or the note's 142-155 | Garmin Z2, cap 140 |
| D3 | In-app edit, or assistant only | small in-app editor |
| D4 | Store Garmin pairs as `workout_sessions` rows with source `garmin` | yes |
| D5 | Pairing minimum: a ride under 50 % of the planned time does not pair | yes |
| D6 | Fuel cues as steps on long rides | yes |

## 9. Tests per phase

- Unit: resolver forms (W, % FTP, zone; bpm from the Garmin snapshot, fallback label);
  `groupWorkout`; step matcher (laps equal, distance laps dropped, time cuts); one-sided range
  parse; `unpick`.
- Integration: pairing writes one `garmin` session per planned session; a pick replaces it; a
  second sync does not duplicate.
- E2E (local dev): the Today card and session page for the tempo session at 390 px; edit a
  step and Undo; after view from a fixture activity with 5 laps and one with 7 laps.
