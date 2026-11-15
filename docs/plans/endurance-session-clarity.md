# Clear bike and run sessions: findings and proposal

Repo: `/Users/mnordbye/Documents/Code/github/logeverylift`, `main` at feafb9f. Read-only work. No
code was run. Every `file:line` below was opened. Where a statement is not from the code, it says
so.

Mockup: [`docs/design/endurance/today-and-detail.html`](../design/endurance/today-and-detail.html).

## 0. The short answer

The app already has the right model for this: the structured workout (`planned_sessions.workout`,
schema in `src/lib/utils/workout-steps.ts`). The problem is that most of the plan does not use it,
and the screens that show it are thin.

So the work is three things, in this order:

1. Show a structured workout well (today card, detail, week, cycle sheet). No schema change.
2. Add the few fields the model lacks (a second target, a one-sided limit, grade). Small.
3. Move the endurance sessions of the plan from program sets to structured workouts.

A step editor, changes to the in-app AI planner and Garmin push are not needed for the goal. I
recommend to leave them out or put them last. Section 6 gives the reasons.

## 1. What exists today

### 1.1 Two storage paths

Path A, program sets. An endurance segment is one `program_sets` row with `durationSeconds`,
`distanceMeters`, `targetHeartRateZone` (1-5), `restTimeSeconds`, `setType` and `inclinePercent`
(`src/db/schema/programs.ts:140-191`). It has no power, no pace, no bpm, no cadence and no repeat.

Path B, structured workouts. `planned_sessions.workout` is jsonb
(`src/db/schema/planned-sessions.ts:59`). A session holds a program or a workout, never both
(check constraint, `planned-sessions.ts:84`). The schema is in `src/lib/utils/workout-steps.ts`:

- Step types warmup, work, recovery, cooldown, rest. One level of repeat (`:108`).
- A step ends by time, distance or lap.
- One `target` per step (`:84-92`, `:96-106`) plus an optional `cadence` range (`:101`).
- A range needs both `low` and `high` (`:162`). "HR under 170" cannot be stored.
- No grade or incline field.
- Power zones stop at Z5, 105-120% FTP (`:279`). A target above 120% has no zone.

### 1.2 Running (not audited before)

Run on path A:

- The triathlon generator makes a "Run" exercise with distance-only sets. An interval run is a
  warm-up set, N work sets in Z4 with 120 s rest, and a cool-down set
  (`src/lib/utils/triathlon-plan.ts:321-328`). A long run is one Z2 set (`:310-312`, `:372-373`).
  The brick run is a second exercise inside the bike program (`:379-380`).
- There is no pace target and no planned duration. The only intensity is the HR zone.
- The rest between reps is a rest timer (`restTimeSeconds`), not a jog step.
- `buildRunSetSummary` shows distance, and a pace only when both distance and duration are
  planned (`src/lib/utils/format.ts:203-222`). The generator plans distance only, so the row
  reads "1 km; 1.5 km; 1.5 km; ...". It cuts after 3 sets and drops the HR zone.
- The HR zone shows only inside the open workout, as a "Z4" badge
  (`src/components/features/WorkoutSetsList.tsx:1877-1885`).
- Incline exists for run only (`src/lib/utils/discipline.ts:98`) and is asked when the run is
  logged (`src/components/features/LogRunModal.tsx:24`).
- Endurance-only days are `autoComplete`, "usually recorded on a watch"
  (`triathlon-plan.ts:101-104`, `:429`). So the app expects the user to read the plan and then
  go, which is exactly where the plan is unreadable.

Run on path B:

- Pace is a percent of threshold speed, or absolute m/s. It shows as min/km
  (`workout-steps.ts:356-387`). HR and cadence work as on the bike.
- A distance step has no planned seconds in the guided player. It waits for the Lap button
  (`src/lib/utils/workout-player.ts:46`, `:201-204`).
- The estimate knows the time of a distance step only when the step has a pace target
  (`workout-steps.ts:425-441`). A warm-up "2 km at HR Z2" makes the total read "at least ...".
- Two display faults, read from the code: a single pace prints twice ("4:05-4:05/km") because the
  pace branch does not collapse equal bounds (`:382`), and `targetLabel` prints "X to X" for an
  absolute pace (`:351`).

Where run differs from bike:

| | Bike | Run |
|---|---|---|
| Main target | power (W, % FTP) | pace (min/km, % threshold speed) |
| Natural step end | time | distance or time |
| Total time | exact | an estimate when steps end by distance |
| Extra | cadence, grade on a sim-mode trainer | HR, incline on a treadmill |
| Path A intensity | HR zone only | HR zone only |
| Brick | first exercise of the program | second exercise of the same program |

### 1.3 Creation

- In-app AI plan: the set schema has reps, kg, `durSec`, `distM` and rest only
  (`src/lib/utils/ai-plan.ts:60-70`). It cannot even set an HR zone. It is a strength tool.
- Triathlon generator: path A only, and already listed for removal (`BACKLOG.md:184`).
- Structured workouts: only an assistant over MCP (`manage_workout`,
  `manage_planned_session` with `set_workout`, `src/lib/mcp/tools/planned-sessions.ts:127-197`).
- The step editor is deferred as C6b (`BACKLOG.md:70`).

### 1.4 Display

- Today: `EnduranceTodayCard` shows a name and one truncated line
  (`src/components/features/guided/EnduranceTodayCard.tsx:33-37`). The line is `describeWorkout`,
  which uses `targetLabel`, so it shows "% FTP" and never watts (`workout-steps.ts:482`, `:488`).
- Program sessions show in the strength card as a title and Start
  (`src/lib/home/today-plan.ts:36-73`).
- `/planned/[id]` lists one row per expanded step (`src/app/planned/[id]/page.tsx:61-74`,
  `src/lib/utils/step-results.ts:74-89`). A 5 x 2 session is 12 rows. It shows no cadence, no
  step note and no description. A program session has no detail page
  (`src/lib/planned-view.ts:65-68`).
- `/week` truncates the summary (`src/app/week/page.tsx:189-190`).
- The cycle sheet shows "Bike 104 km" (`src/components/features/CycleSessionsClient.tsx:56`).
- The guided player shows one target and the step note
  (`src/components/features/guided/GuidedPlayer.tsx:182-187`).

### 1.5 Garmin

Read only. The client is the Garmin Connect Personal API (`src/lib/garmin/client.ts:1-13`), for
admins only (`src/lib/garmin/access.ts:14-16`). FIT files are decoded with `@garmin/fitsdk`
(`src/lib/garmin/fit.ts:1`). That package also ships an encoder and knows the secondary target
fields of a workout step (`node_modules/@garmin/fitsdk/src/encoder.js`, `profile.js:21611`).
Push to the watch is parked as D13 (`docs/triathlon-coach-audit.md:378`).

## 2. Data model

### 2.1 One path for endurance

Recommendation: structured workouts are the only path for swim, bike and run. Program sets stay
for strength. Do not add power, pace or cadence columns to `program_sets`. That would build the
same model twice, and path A can never hold a repeat.

Path A endurance sessions stay readable (old sessions, other users' programs). They get no new
work except one cheap fix in phase 1.

### 2.2 What the step must hold

The step keeps `target` as the main target. Load, the hard-session rule, the player and the step
results all read it (`src/lib/utils/training-load.ts:136-180`, `step-results.ts:104-113`). That
must not change.

Add three things. All are optional, so stored workouts stay valid and `v` stays 1.

| Add | Shape | Why |
|---|---|---|
| `secondary` | one more Target, with a metric other than the main one | "280 W and HR under 170", "4:05 /km and HR 165-175" |
| One-sided range | `low` or `high` alone is valid, for HR and power | A cap ("under 170 bpm") or a floor |
| `gradePercent` | number, -10 to 20, bike and run | Treadmill incline, or a sim-mode trainer |

`cadence` stays as it is. So a bike step can hold power, an HR limit, cadence and grade. A run
step can hold pace, HR, cadence and grade. That covers the user's list.

Why one `secondary` and not a list of targets: a FIT workout step has one target and one
secondary target. A list would hold more than the watch can show. One is enough for every
example the user gave, because cadence has its own field.

Not needed:

- Nested repeats. FIT has one level. "2 sets of 4 x 30 s" is two repeat blocks.
- Ramps. A warm-up "50-65% FTP" is a range, and the chart can draw it as a slope.
- Free text per step beyond the existing 140-character note.

Ranges and units: storage stays as today (watts, bpm, rpm, m/s, percent). A single value is a
range with equal ends. The display collapses it.

### 2.3 The resolver must give both forms

`resolveTarget` returns one text (`workout-steps.ts:356`). The screens need more, so the user
never does arithmetic:

- The absolute value: "280 W", "165-175 bpm", "4:05 /km".
- The relative value: "93% FTP", "102% of threshold speed". For an absolute target this needs the
  reverse sum (280 / FTP).
- The zone, from the tables already in the file (`:279-281`).
- For a run distance step with a pace: the split, "3:16 per rep".

This is one pure function with unit tests. It is the core of phase 1.

### 2.4 Totals

- Time and distance come from `estimateWorkout`. Fix: when a run step has no pace target, use a
  default speed by step type (for example 75% of threshold speed for warm-up, cool-down and
  recovery) for the estimate only, and print "about". Label it an inference, as the load code
  does (`training-load.ts:115`).
- Add "hard" time or distance: the sum of the work steps. "20 min at 280 W" tells more than
  "55 min".

### 2.6 HR zones come from Garmin, not from a table

Today a planned "Z2" is a Friel percent of an LTHR typed into the app
(`workout-steps.ts:279-286`, `BIKE_HR_ZONES`, `RUN_HR_ZONES`). The watch uses the zones in the
Garmin profile. The two can differ, so the plan can say "Z2" while the watch shows Z3.

The app already has the Garmin zones. The sync stores an `hr_zones` snapshot from
`/biometric-service/heartRateZones/v2` (`src/lib/garmin/endpoints.ts:223`). Each row has `sport`,
`maxHeartRateUsed`, `restingHeartRateUsed`, `lactateThresholdHeartRateUsed` and the zone floors.
Each FIT activity also has `hrZoneHighBoundary` (`src/lib/garmin/queries.ts:513`). Only the
activity analytics use them (`src/lib/garmin/analytics/thresholds.ts`).

Rule:

- An HR zone target resolves to bpm from the latest Garmin snapshot row for the sport: `CYCLING`
  for bike, `RUNNING` for run, then `DEFAULT`. `snapshotZones` accepts only `CYCLING | DEFAULT`
  today; add `RUNNING`.
- Zone N is `zoneNFloor` to `zone(N+1)Floor - 1`. Zone 5 ends at `maxHeartRateUsed`.
- A %LTHR or %max target uses `lactateThresholdHeartRateUsed` or `maxHeartRateUsed` from the same
  row, when the user has not set a value in the app.
- Fallback when there is no snapshot: the current Friel tables, labelled "estimate".
- Each step shows the bpm and the source: "Z2 · 128-141 bpm (Garmin zones)". The detail page
  lists the five zones in bpm once, so the user can compare them with the watch.
- The zones are read when the page renders, so a change on Garmin shows after the next sync. No
  stored copy in the workout.
- Step results compare the logged HR against the same bounds. The FIT boundaries of the activity
  win over the snapshot, as `thresholdsFor` already does.

Power: Garmin power zones are not synced. FTP comes from the app, or from
`functionalThresholdPower` in the last bike FIT file when the app has none.

### 2.5 Migration of path A endurance sessions

Facts that decide this:

- The endurance switch is on for the owner only (D15, `docs/triathlon-coach-audit.md`). So there
  is one user's data to move.
- A converter from sets to steps is possible (set to step, warm-up set to warm-up, HR zone to an
  HR zone target, rest to a rest step). But it cannot invent watts or pace. The result is the same
  information in a new shape.
- The weekly sync scales path A sets by phase through `peakDistanceMeters`
  (`src/db/schema/programs.ts:176-182`). A workout has no such scaling. A slot that holds a
  library workout copies the same workout into every week.
- A brick day is one program with a bike and a run exercise. In path B it is two linked sessions
  (`brick_parent_id`). A mixed day such as "Bike · Endurance + swim" splits the same way.

Recommendation: no migration code. The assistant rewrites the future sessions of the current
block with `set_workout`, with real targets from the user's thresholds. Past sessions stay as
they are. This is a data task, not a build task, and it is the only way the sessions get targets.

The cost is the weekly progression: after the move, the assistant (or the user) must write each
week's sessions. This is the largest open decision. See section 7, question 1.

## 3. Creation

Keep it small.

| Route | Recommendation |
|---|---|
| MCP (`manage_workout`, `set_workout`) | The main route. Extend the schema and `docs/mcp/workout-steps.md` with the new fields. Add one rule to the doc: every bike work step has a power target, every run step has a pace target. |
| Workout library | Already there. Use it as the template store: 8-10 named sessions, made once by the assistant. No code. |
| Triathlon generator | Do not teach it workouts. It is listed for removal (`BACKLOG.md:184`). |
| In-app AI plan and edit | Leave as a strength tool. Its schema has no endurance fields at all. |
| Step editor (C6b) | Not in this work. See below. |

The step editor: the user asked for clear sessions, not for a way to author them by hand. A full
editor (steps, repeats, ends, targets, reorder) on a phone is the largest item on this list. A
smaller form covers the real need if one shows up: "Adjust numbers" on the detail page, which
changes the duration, the repeat count and the target values of existing steps and cannot change
the structure. Build neither until the user asks.

## 4. Display

See the mockup. The rules behind it:

1. The title says the session ("5 x 4 min at 280 W"). The name field already holds this.
2. Totals come first: total time, total distance where known, and the hard part.
3. A profile chart: width is time, height is the share of threshold (FTP or threshold speed),
   colour is the zone. It uses the app's zone colours (`--viz-zone-1..5` in
   `src/app/globals.css`). A dashed line marks the threshold.
4. Three groups: warm-up, main set, cool-down. They come from the step types, with no new field:
   the leading warm-up steps, the trailing cool-down steps, and all between.
5. A repeat is one block with a count badge and its steps once. It is never expanded.
6. Each step shows its length on the left, the main target large in the user's unit, the relative
   value and zone under it, and the second targets as chips (cadence, HR, incline).
7. The description shows as "Why this session". The thresholds used show at the bottom with a
   link, so the user knows where the watts come from.

Per screen:

- Today card (`EnduranceTodayCard.tsx`): title, totals, a small profile, three lines, Start and
  Details. One card per session. The mockup card is about 330 px high; with two sessions on one
  day the second can use a compact row.
- Detail (`/planned/[id]`): as the mockup. The expanded per-rep list stays where it is needed:
  the results screen and the player.
- `/week` (`src/app/week/page.tsx:189`): two lines in place of one truncated line. Line 1 is the
  totals, line 2 is the main set ("5 x 4 min at 280 W"). No chart.
- Cycle sheet (`CycleSessionsClient.tsx`, `CycleCalendarClient.tsx:444`): the same two lines, and
  a link "See steps" to `/planned/[id]`.
- Guided player (`GuidedPlayer.tsx:182`): show the secondary target, cadence and grade under the
  main target. Small change, same phase as the schema.
- Path A sessions: in the cycle sheet, show every set, the HR zone and the rest
  ("1 km Z2 · 4 x 1.5 km Z4, 2 min rest · 1 km Z2"). This is a change to `buildRunSetSummary`
  only. Nothing more for path A.

## 5. Garmin and D13

The goal is "I know what to do before I start". The screens solve that. Push to the watch solves
a different thing: prompts during the session without the phone. So D13 is not needed for the
goal. I recommend to keep it out of the first phases and decide it after the user has used the
new screens for some weeks.

If it goes in scope, the smallest form is a "Download .fit" button on the detail page:

- Encode with the `@garmin/fitsdk` encoder that is already installed. The mapping table exists
  (`docs/plans/workouts-and-compliance.md`, section 3.6). `secondary` maps to the FIT secondary
  target. When a step has both a secondary target and cadence, one goes to the step notes.
- Resolve targets to absolute values at export. The file then goes stale when FTP changes.
- No Garmin account link is needed, so it is not limited to admins.

Not verified, and to check before a build:

- Whether the Personal API has any write call for workouts. The client in the repo is read only
  and lists no such endpoint (`src/lib/garmin/endpoints.ts`).
- How the user's watch takes a workout file (USB copy to the watch, or an import in Garmin
  Connect). This depends on the model.
- What controls the trainer. If the user rides in ERG mode through an app such as Zwift, the
  useful export for the bike is a ZWO file, not FIT. If the watch controls the trainer, FIT is
  right.

Related and cheaper: "Garmin laps as step results" (`BACKLOG.md:136`) closes the loop the other
way and needs no delivery route.

### 5.1 How to record the session on the watch

The session detail page gets a short "Record on Garmin" box, built from the workout. Example for
the bike session:

> Indoor Bike. Trainer paired. Auto Pause off, Auto Lap off. Start at the warm-up. Press Lap at
> each step change, 11 times. 12 laps in total. Do not pause in the easy steps. Stop after the
> cool-down.

Rules behind the text:

- One lap per step. Lap count = flattened step count (repeats expanded). Presses = laps - 1.
- Keep the recording running. A recovery step is part of the session. A pause removes it from
  time, load and the HR curve, and breaks the time cuts below.
- Pause only for a real stop (a break the plan does not have).
- Auto Lap off for interval sessions. A 1 km auto lap adds laps that do not match steps.
- Auto Pause off on the trainer. Low speed in an easy step can start a pause by itself.
- Activity profile: Indoor Bike (trainer paired for watts) or Run / Treadmill.
- With a workout on the watch (D13), the watch makes the laps. The box then says "Start the
  workout on the watch" and drops the lap text.

### 5.2 Step results from the Garmin activity

The session pairing exists (`pairGarmin`, `src/lib/utils/session-compliance.ts:397`). Add step
results from the paired activity:

1. Laps: when the lap count equals the step count, lap N is step N.
2. Time cuts: otherwise, cut the record into the planned step lengths from the start.
   Label the result "matched by time".
3. Per step: average W or pace, average and max HR, time in the Garmin zone of the target, and
   the band against the target. Read from the stored laps and streams
   (`garminActivityStreams.laps`, `.streams`).
4. Results from the guided player or a hand entry win over the Garmin ones.

## 6. Where I push back

- Gradient on the bike. In ERG mode the trainer holds the watts and grade means nothing. Store
  `gradePercent` as an optional field and show it only when set. Do not make it a target.
- "Several targets" does not mean a list. One main target, one secondary, cadence and grade. More
  than that cannot be followed during a rep and cannot go to a watch.
- A manual step editor. Not needed for the goal (section 3).
- The in-app AI planner. Do not extend it for endurance (section 3).
- A code migration of program sets. It moves data without adding targets (section 2.5).
- A new model for path A. Do not add columns to `program_sets`.

## 7. Open decisions for the user

1. Who writes each week's sessions after the move? Today the weekly sync scales path A distances
   by phase. Workouts have no scaling. Options: (a) the assistant writes each week or each block
   over MCP, which is how the coach plan already points; (b) keep path A for long steady sessions
   and use workouts for interval sessions only; (c) build scaling for workouts, which is a new
   feature. I recommend (a).
2. Is the assistant over MCP the accepted way to author sessions, or do you want to change
   numbers in the app? This decides whether "Adjust numbers" is ever built.
3. Watch delivery (D13): in or out? If in: which watch, and what controls the trainer?
4. Bike HR limits: a cap in bpm ("under 170"), or a zone? The model takes both. This is about
   what the assistant should write.
5. Run targets: pace as the main target with HR second, or HR as the main target for easy runs?
   I recommend pace for intervals and HR for easy and long runs. Both show the same way.
6. The chart uses the app's blue zone scale, light for hard. A warm scale (red for hard) reads
   faster but is a new palette. Keep blue?
7. Power zones: the table has 5 zones and stops at 120% FTP. Sessions above that show no zone.
   Accept, or extend to the 7 Coggan zones?

## 8. Gaps and risks

- Thresholds must be set. With no FTP or threshold pace, percent targets show as percent only.
  The screen already warns (`planned/[id]/page.tsx:51-58`). Check that FTP, both threshold HRs
  and threshold pace are set before the move.
- Home has two cards today: program sessions in the blue card and workouts in "Endurance today".
  After the move the endurance sessions leave the blue card. On an endurance-only day the blue
  card must not read as empty or as a rest day. Check this in phase 3.
- `autoComplete` belongs to program slots. Workout sessions are matched to Garmin activities or
  asked "Did you do it?". The behaviour of a done day changes a little after the move.
- Brick days become two sessions. The week view and the limits must count them as today.
- Run totals are estimates when steps end by distance. The screen must say "about".
- The step results compare one measured value with the main target (`step-results.ts:33`). The
  secondary target is shown, not scored. Say so in the brief of phase 2.
- The detail page is server rendered and client components must not format numbers
  (`src/lib/planned-view.ts:1-9`). The chart must get plain numbers from the server.
- Privacy: no new kind of personal data. A FIT download would be a new export; run the
  `privacy-compliance` skill for phase 5.
- Tests: the resolver, the grouping and the estimate are pure and need unit tests. The screens are
  a redesign, so the repo's journey review applies (390 and 320 px).

## 9. Build order

Each phase is one PR and ships alone.

| Phase | What | Schema change | Size |
|---|---|---|---|
| 1 | Display of structured workouts. Resolver gives absolute, relative, zone and split. HR zones resolve to bpm from the Garmin `hr_zones` snapshot (2.6). Grouping into warm-up, main, cool-down. Profile chart. New today card and detail page. Two-line summary in `/week` and the cycle sheet. Fix the doubled pace text. Show cadence, note and description. | no | medium |
| 2 | Step model: `secondary`, one-sided ranges, `gradePercent`. Update the MCP doc and its parsed examples. Show them in the detail page and the player. Run estimate with a default pace. | JSON only, no SQL | small |
| 3 | Move the plan. The assistant rewrites the future endurance sessions as workouts with targets and fills the library. Fix home for endurance-only days. No migration code. | no | data task plus a small home fix |
| 4 | Path A summary fix: all sets, HR zone and rest in `buildRunSetSummary`. | no | very small |
| 5 | "Record on Garmin" box (5.1) and step results from Garmin laps or time cuts (5.2). Then "Download .fit" (D13). | no | medium |
| Later, on request | "Adjust numbers" on the detail page. Removal of the triathlon generator. | no | |

Phase 1 already makes the existing "5x4 min VO2 trainer" session clear, with no data change. Phase
4 can ship at any time; it is first if the move in phase 3 waits on decision 1.

Success check for the whole work: open the app on the phone on a session day, and within one
screen read the total, the structure and every target in watts, bpm and min/km, with no note.
