# Review of user-journeys.md

Audited: `user-journeys.md` and `user-journeys.html` against `journeys-audit.md`,
`endurance-clarity-brief.md` and the repo `logeverylift` at `main` feafb9f. Read-only. No code was
run. Paths are relative to the repo root. "Doc" is `user-journeys.md`.

Verdicts: correct, wrong, partly wrong, unverified (the repo cannot prove it).

## A. Garmin claims

| # | Doc section | Claim | Verdict | Evidence | Why it matters |
|---|---|---|---|---|---|
| A1 | 1 #5, 2.2 zone table, 3.2 ("Garmin running zones"), HTML run lane | The `hr_zones` snapshot has a RUNNING row, so run HR resolves from Garmin running zones | Unverified, and the only measured fact says no | `docs/plans/garmin-insights-design.md:36` ("`hr_zones` holds two sports: `DEFAULT` and `CYCLING`"). No `RUNNING` string in `src/`. `snapshotZones` accepts `"CYCLING" \| "DEFAULT"` only (`src/lib/garmin/analytics/thresholds.ts:30-34`). Test rows are `DEFAULT` and `CYCLING` only (`src/__tests__/integration/garmin-metrics-job.test.ts:29`, `src/__tests__/garmin-analytics.test.ts:44`) | The run journey will show `DEFAULT` zones. The label "Garmin running zones" can be false, and the watch can still show a different zone. |
| A2 | 2.2 zone table, brief 2.6 | Snapshot rows have zone floors | Correct for `DEFAULT`; not shown for `CYCLING` in any test | `zone1Floor`..`zone4Floor` in the `DEFAULT` fixture (`garmin-metrics-job.test.ts:29`). The `CYCLING` fixture has no floors (`garmin-analytics.test.ts:44`). The design note says both have `zone1Floor` to `zone5Floor` (`garmin-insights-design.md:36`). No code reads `zoneNFloor` from the snapshot today | The zone table rests on a doc note, not on a parser or a test. |
| A3 | 2.2 "Effort", 3.1 After | `directWorkoutRpe` is in the activity JSON | Partly wrong | It is in `garmin_activities.detail->'summaryDTO'` (`src/lib/garmin/queries.ts:480`), not in the list row `data` that pairing reads (`src/lib/session-compliance.ts:222`). The scale is 0-100: the tile divides by 10 (`src/lib/garmin/charts/activity.ts:117-118`). The only stored example is a synthetic test value (`src/__tests__/garmin-activity-view.test.ts:171`) | The value arrives only after the worker fetches the detail, and needs a scale change. Presence in the owner's real activities is not proved in the repo. |
| A4 | 2.2 "Effort" | "the watch RPE is read nowhere today (4.3)" | Wrong | Read and shown as the tile "How it felt" (`charts/activity.ts:116-118`). Audit 4.13 #13 says "shown as a tile and used nowhere else" | The doc contradicts the audit. The tag is CHANGE by accident, for the wrong reason. |
| A5 | 3.2 After, 4.2 | Laps carry time and distance, so lap pace can be derived | Correct | `parseFit` keeps every named lap field (`src/lib/garmin/fit.ts:134`, `plain` at `:81-90`). Readers use `totalTimerTime`, `totalElapsedTime`, `totalDistance`, `avgHeartRate`, `avgPower` (`src/lib/mcp/tools/garmin.ts:165`, `charts/activity.ts:204-207`). Test lap has `totalDistance` and `enhancedAvgSpeed` (`garmin-activity-view.test.ts:76`) | Lap pace needs no new sync. Treadmill and trainer distance is device-estimated; the app already distrusts treadmill pace (`src/lib/garmin/analytics/sport.ts:17`). |
| A6 | 3.4 During, open question 1 | "Two activities pair with no new code" | Correct | `pairGarmin` matches same sport and same day, one activity per session (`src/lib/utils/session-compliance.ts:397-416`) | The two-activity brick works today. |
| A7 | Open question 1 | A Multisport activity "needs a check of how the sync stores it" | Correct to flag; the code already answers part of it | List row is stored with its `typeKey` (`src/lib/garmin/sync.ts:148-153`). `sportOf` has no multisport case, so `multi_sport` becomes `"other"` (`src/lib/garmin/analytics/sport.ts:8-15`). `pairGarmin` needs `a.sport === r.sport` (`session-compliance.ts:408`). `parseFit` keeps only `sessionMesgs[0]` and `sportMesgs[0]` and puts all laps in one array (`fit.ts:124-125`, `:134`). No string `multi` in `src/lib/garmin` | A Multisport recording pairs with neither leg today, and its FIT summary holds the first leg only. Whether the list endpoint also returns child activities is not provable from the repo. |
| A8 | 3.3 During and After | Pool swim: "Press Lap at the wall to rest, again to start the next set"; "Step results from the watch intervals" | Unverified | The DB had no swim when the Garmin design was written; swim items are "designed from the FIT standard, not from a sample" (`garmin-insights-design.md:34-35`). FIT `lengths` are stored with no reader (`fit.ts:138`, audit 7.4 #3). A send-off set has no rest step (audit 6.7, `docs/mcp/workout-steps.md:74-78`) | Rest laps on the watch make the lap count differ from the step count, so brief 5.2 rule 1 ("lap count equals step count") fails for send-off sets. The doc gives no rule for this. |
| A9 | 3.3 During | Swim lap text against brief 5.1 | Contradiction | Brief 5.1: "One lap per step... Presses = laps - 1". Doc 3.3: two presses per set | The "Record on Garmin" box cannot be built from one rule for all sports. |
| A10 | 3.1 After | "Within 30 min the app pairs the ride" | Correct | `RECENT_EVERY_MS = 30 * 60_000`, tick 60 s (`src/lib/garmin/worker.ts:39-42`, `:121-124`). Pairing reads the list row only (`session-compliance.ts:222`) | Holds after the watch has synced to Garmin. Step results also need the FIT file, fetched in the same tick (5 files per tick, `worker.ts:43`). |
| A11 | 2.2 "Not this activity" | Lists activities "of the sport (plus one day either side)" | Correct for the day window; the sport filter is new | `pick` allows the session day plus or minus 1 and checks no sport (`src/lib/planned-sessions.ts:1060-1080`). No `unpick` in `src/` | The list rule matches the stored rule. |
| A12 | 2.2 "Step results", 4.2 | Garmin step results feed `get_step_results` | Gap, not stated | `workout_step_results.workoutSessionId` is NOT NULL (`src/db/schema/step-results.ts:25-27`). A Garmin-paired session has no `workout_sessions` row (audit 4.13 #9). Sources are `player`, `manual`, `assistant` (`step-results.ts:16`). One `value` per step (`src/lib/utils/step-results.ts:31-32`) | The doc does not say if Garmin step results are stored or computed on read. Stored needs a schema change, which the brief's phase 5 marks "no". Average HR, max HR and zone time do not fit one `value`. |

## B. EXISTS tags

| # | Doc section | Claim | Verdict | Evidence | Why it matters |
|---|---|---|---|---|---|
| B1 | 2.1 | "Details" row link, "Start guided", "Pool view", "This week" | Correct | `src/components/features/guided/EnduranceTodayCard.tsx:27-29`, `:34`, `:46-51` | |
| B2 | 2.2 | Title, threshold warning, Back to `/week`, Start guided, Pool view, "Edit results" | Correct | `src/app/planned/[id]/page.tsx:36`, `:43-45`, `:51-58`, `:78-90` | "Edit results" exists as "Step results" / "Add step results" / "Log results by hand". |
| B3 | 2.2 after | Band "with the ratio" | Partly wrong | The page prints the band word only (`page.tsx:15`, `:41`). The ratio is in `SessionCompliance` and is not rendered | The ratio is NEW on this page. |
| B4 | 2.2 after | "Edit results ... for a correction" | Partly wrong | The form takes a value, RPE or note on work steps only, no pace and no time change (audit 4.13 #8, `StepResultsForm.tsx:175`, `:205`) | It cannot correct most of the Garmin step numbers the doc adds. |
| B5 | 2.3 | Load card and sport totals | Correct | `src/app/week/page.tsx:99-167` | |
| B6 | 2.5 | Laps table and charts | Correct | `src/lib/garmin/charts/activity.ts:202-207` | The page links to a matched logged session only (`GarminActivityView.tsx:397-401`), so "link to the plan" is NEW as tagged. |
| B7 | 3.1 low readiness | "HRV fatigued two days in a row: home shows Make it easy" | Partly wrong | The flag also needs the resting-HR flag (`src/lib/utils/training-limits.ts:557-562`). The swap needs a hard, not-done session today (`:636-640`). Button text is correct (`ReadinessSwapCard.tsx:47`) | The card will not show on the stated condition alone. |
| B8 | 3.1 low readiness | CHANGE: add "Keep the plan" (2.12 #35) | Conflicts with a recorded decision | "No dismiss button (hub decision 12)" (`src/components/features/ReadinessSwapCard.tsx:8-9`) | The doc treats a decision as a defect. The audit states the fact only. |
| B9 | 3.1, 3.2 During | Guided player exists; a distance step waits for Lap | Correct | `GuidedPlayer.tsx:176-187`, `src/lib/utils/workout-player.ts:46`, `:201-205` | |
| B10 | 3.1 Plan | Tools `manage_workout`, `set_workout`, `add`, `edit_cycle_slot workoutId` | Correct | `src/lib/mcp/tools/workouts-compliance.ts:104`, `planned-sessions.ts:127-135`, `:183`, `cycles.ts:404` | |
| B11 | 3.3 Plan | Whole lengths, CSS pace, send-offs | Correct | `src/lib/utils/workout-steps.ts:100-108`, `:155-160` | |
| B12 | 3.4 Plan | `link_brick`, `brickWithNext` | Correct | `planned-sessions.ts:193`, `:204-207`; audit 6.7 | |
| B13 | 3.4 Adapt | "`get_step_results` both legs: EXISTS (tools)" | Inconsistent | Same tool is CHANGE in 3.1, 3.3 and 4.2 (no Garmin source) | A watch-only brick gives null step results today. |
| B14 | 3.4 During, HTML | HTML tags "Two activities on the watch" EXISTS; the md cell says "Open question 1" | Inconsistent | `user-journeys.html` brick lane | The map states as fact what the doc leaves open. |
| B15 | 3.5 | Rest slot, optional recovery session | Correct | audit 6.7; `planned-sessions.ts:136` | |
| B16 | 3.6 Sick | "I'm sick" on home: EXISTS | Wrong | Home has the sick and return banners only (`Notices.tsx:72-73`, `DidYouDoIt.tsx:131-157`). The start of a sick period is "I was sick" inside the "Yes" sheet (`SessionAnswers.tsx:156`, `:291`) and the Athlete profile (`AthleteProfileClient.tsx:177`) | No home button starts a sick period for today. It is NEW on home too. |
| B17 | 3.6 Sick | "The AI proposes the return plan" | Partly wrong | The app shows the return rule itself (`DidYouDoIt.tsx:139-157`). `instructions.ts` tells the AI to change the plan only when asked | The existing return banner is not in the doc. |
| B18 | 3.6 Missed | "Did you do it?" and "Move to <day>" on home | Correct | `DidYouDoIt.tsx:32-61`, `:92-100` | |
| B19 | 4.1 guard rails | Six limits; reason and `expectedVersion`; revisions | Correct for plan writes | `LIMIT_RULES` (`training-limits.ts:18-25`); `instructions.ts` limits and revisions text; thresholds also make a revision (`athlete-profile.ts:192`) | "Every write" is too wide: the checked ops are move, change, add, unskip, reset, set_workout, clear_workout, update_from_library (`planned-sessions.ts:190`). Skip, set_priority and thresholds pass no limit. Logged data makes no revision (audit 6.8 #19). |
| B20 | 4.2 | `list_planned_sessions`, `get_training_load` (ramp, form), `get_garmin_status`, `get_garmin_trends` (FTP, LTHR, critical speed) | Correct | `endurance-app.ts:42-48`, `garmin.ts:36-39`, `:78-96` | `get_garmin_trends` returns no swim value (audit 8.2), so 3.3 Adapt has no Garmin trend input. |
| B21 | 4.2 | "the app sends no miss reason" | Correct | No `missedReason` in `src/components` or `src/lib/validators` | |

## C. CHANGE tags

| # | Doc section | Claim | Verdict | Evidence |
|---|---|---|---|---|
| C1 | 2.1 | Today hero skips path B; "Rest Day" on a path B only day | Correct (read from code, as the audit says) | `src/lib/planned-sessions.ts:519-521`, `src/lib/home/core.ts:191` |
| C2 | 2.1 | "Results" goes to the results form | Correct | `EnduranceTodayCard.tsx:40` |
| C3 | 2.2 | Kicker has no sport and no brick | Correct | `page.tsx:39-42` |
| C4 | 2.2 | Coach note and description not shown; flat rows; one target; no cadence, no step note | Correct | `page.tsx:61-74` |
| C5 | 2.2 after | "Did you do it?" CHANGE, "Move/Skip" NEW, 3.6 "Move" CHANGE | Inconsistent tags | None of the three is on `/planned/[id]` today (`page.tsx`). All are NEW on that page |
| C6 | 2.3 | Program rows are a dead `div`; one cut line; no brick mark | Correct | `week/page.tsx:190`, `:206-209` |
| C7 | 2.3 | Home strip and calendar miss Garmin-done days | Correct | `core.ts:174-176`; audit 2.12 #21 |
| C8 | 2.4 | Calendar "No program assigned"; Start needs a program | Correct | `CycleCalendarClient.tsx:418-421`, `PlannedSessionActions.tsx:333` |
| C9 | 2.6 | Garmin-done session in history: CHANGE | Correct defect; it is NEW work | No `workout_sessions` row exists for it (audit 4.13 #9) |
| C10 | 3.2 Before | Single pace prints twice | Correct | `workout-steps.ts:380-383` (no equal-bounds collapse in the pace branch) |
| C11 | 3.3 During | Pool view last block has no "Done" | Correct per audit 4.13 #14 | `PoolList.tsx` has no results link |
| C12 | 4.2 | Laps over MCP have time, distance, HR, power only | Correct | `garmin.ts:165` |
| C13 | 4.3 | Four stale MCP texts | Correct | `instructions.ts:45-46`, `docs/mcp/app-rules.md:276-279`, `nutrition.ts:114` |
| C14 | HTML run Plan | "NEW Pace main target, HR cap secondary" against md "EXISTS / CHANGE as bike" | Inconsistent | Pace target exists (`workout-steps.ts:84-92`); only the secondary is new |
| C15 | HTML data | Zone bounds tool is `get_athlete_profile`; md says "none" | Inconsistent | md 4.2 row |

## D. NEW tags

All checked items are absent from `src/` and `docs/mcp/`: `unpick`, "Record on Garmin", "Not this
activity", "Keep the plan" (as a control), `gradePercent`, a step `secondary`, a hard-time total, a
profile chart on the session page, "Leg 1 of 2", a day-series MCP tool, zone bounds in
`get_athlete_profile`. No file under `src/app` or `src/components` reads `matchedBy` or the paired
`garminActivityId`. Verdict: correct.

One exception to the wording: 3.5 Adapt points to "section 4.3" for the series tool. The tool is
in 4.2. Section 4.3 holds text fixes only.

## E. Gaps: audit items the doc does not cover

| # | Missing item | Audit ref | Why it matters |
|---|---|---|---|
| E1 | The path A endurance journey. Today's plan is path A (generator). Start from the Today hero into the strength logger, `LogRunModal`, RPE 6-10, `autoComplete` with no effect, the path A brick that never pairs | 1.9 #5, #6, #17; 2.12 #9, #11; 4.13 #4, #16 | Until phase 5 every real session takes this journey, and the doc describes none of it. |
| E2 | Brief phase 4 (`buildRunSetSummary` fix for path A) is dropped | brief section 9 | The doc says "The brief's phases stay". |
| E3 | Guided player finish: results saved from the player, the saved-run link, `localStorage` only until save | 3.4; 4.13 #15 | "Nothing to type" ignores the case where the player ran. Brief 5.2 rule 4 (player and hand results win over Garmin) is not in the doc. |
| E4 | A "Yes" answer creates a logged session; a Garmin activity that syncs later is then taken by it | 4.2; `session-compliance.ts:283-289` | The order of "Did you do it?" and pairing changes what the session page shows. |
| E5 | Refresh from Garmin exists only on `/more/garmin` | 4.13 #19 | The After step has no way to pull the activity from the session page. |
| E6 | The compliance ratio scores duration or distance only | 4.13 #11 | A session at the wrong intensity reads "On plan" beside step results that say "miss". |
| E7 | Home notices: the return banner; limit warnings of a readiness swap are shown nowhere | 2.1 notices; 1.9 #12 | Both sit on the rest and sick journeys. |
| E8 | Fuel: `log_fuel`, `get_nutrition`, the fuel log on the Garmin activity page | 6.4 nutrition; `GarminActivityView.tsx:101` | A data source of long rides and bricks is absent from 4.2. |
| E9 | Workouts library screen and "Use a workout" on a session | 2.9; 2.12 #30, #31 | A user control that changes what a session runs is not on the map. |
| E10 | Swim: `lengths` stored and unused; no Garmin trend or suggestion for CSS; a swim is never key by length | 7.4 #3, #20; 1.9 #9 | The swim Adapt cell has less data than bike and run, and the doc does not say so. |
| E11 | No cap on a single ride or swim | 1.9 #8 | 3.2 names the long-run cap; 3.1 and 3.3 name no guard. |
| E12 | Outdoor ride, outdoor run and open-water swim | scope line | The run lane in the HTML says "road or treadmill"; the doc gives no outdoor rule (auto pause, GPS). |
| E13 | Items in the doc with no phase: "Keep the plan", the sick entry on the session page, readiness and tomorrow's preview on the rest card, the brick result line, the generator's one-program brick | doc 3.1, 3.4, 3.5, 3.6 against doc 5 | They can be lost at build time. |

## F. Build order

| # | Item | Depends on | Verdict |
|---|---|---|---|
| F1 | Phase 1 "player shows secondary target and cadence"; 2.2 step list with "secondary target (HR cap)" and "gradient" | Phase 2 adds `secondary` and `gradePercent` | Wrong order. The brief puts the player change in the schema phase (brief section 4, "same phase as the schema"). Cadence alone can go in phase 1. |
| F2 | Phase 1 "MCP text fixes (4.3)" includes "Weekly review steps: add step results, readiness series and threshold check" | The series tool is phase 4; Garmin step results are phase 3 | Wrong order. The text would name a tool that does not exist. Phase 4 lists "weekly review text" again. |
| F3 | Phase 1 "Garmin HR zones" for run | A `RUNNING` row (finding A1) and `snapshotZones` change | Unverified input. |
| F4 | Phase 1 "Record on Garmin box" | Lap matcher is phase 3 | No hard dependency. The brief has both in one phase (5). In between, the box asks for lap presses that nothing reads. |
| F5 | Phase 3 step results | Storage decision (finding A12) | Missing prerequisite. |
| F6 | Phase 5 "Move the plan" after phases 1-4 | Needs phase 2 only | No violation, but phases 1, 3 and 4 act on path B sessions, and most of the plan is path A until phase 5. The brief has the move as phase 3. |
| F7 | "The brief's phases stay" | | Wrong. Brief order: display, step model, move the plan, path A summary, record box and step results. Doc order: display with record box and home fix, step model, after, AI data, move the plan, .fit. |
