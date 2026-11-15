# LogEveryLift journeys audit

Repo `/Users/mnordbye/Documents/Code/github/logeverylift`, `main` at feafb9f. Read-only audit. No code
was run, no sign-in was made, nothing was changed. The audit states facts about the app as it is. It
has no proposals.

How to read this file:

- Sections 1 to 7 were written in five parallel passes over the code. Each `file:line` was opened by
  the pass that cites it. Section 8 groups the gap facts of all passes. A sample of the main claims
  was opened a second time (list in 8.9).
- Paths are relative to the repo root. Exception: sections 3 and 4 give paths relative to `src/`
  (`lib/...`, `components/...`, `app/...`). In section 6, `T/` means `src/lib/mcp/tools/`.
- Statements marked "read from code, not run" follow a code path across files and were not seen on
  a screen.
- Scope: strength is a short pointer only (a separate strength audit exists). The depth is in run,
  bike, swim, brick days, rest and recovery days, Garmin pairing, step results, the adapt mechanics,
  the MCP inventory and the data inventory.

Terms:

- Path A: an endurance session stored as a program with `program_sets` (distance, duration, HR zone
  1-5, rest, incline). The session row has `program_id`.
- Path B: a session with a structured workout in `planned_sessions.workout` (steps, repeats,
  targets). The session row has no program.
- Endurance switch: `users.enduranceEnabled` (`src/lib/endurance.ts:18-24`). Only an admin sets it.
- Garmin access: role `admin` and the env key `GARMIN_KEY_ENCRYPTION_KEY`
  (`src/lib/garmin/access.ts:15-17`).

Contents: 0 summary per training type; 1 Plan; 2 Before; 3 During; 4 After; 5 Adapt; 6 MCP
inventory; 7 Data inventory; 8 Gaps as facts.

## 0. Summary per training type

Assumes the endurance switch and Garmin access are on and the cycle is a weekday cycle. Each cell
points to the section with the detail and the `file:line`.

| | Strength (pointer) | Run, bike, swim on path A | Run, bike, swim on path B | Brick day | Rest or recovery day |
|---|---|---|---|---|---|
| Data form (1.0, 1.2) | Program with reps and kg sets. Session `sport` is null. | Program whose sets all have one discipline. Sets hold distance, duration, HR zone, rest, incline. No power, pace, bpm or cadence. | Workout JSON on the session: steps, one repeat level, one target per step, cadence. | Two forms. Path A: one program with a bike and a run exercise, one session, `sport` null. Path B: two sessions, the second with `brickParentId`. | Rest: a template slot with no program and no workout. No dated row. Recovery: no data form. |
| Who can plan it (1.1, 6.7) | App editors, import, in-app AI, MCP. | Triathlon generator, program editor, import, MCP program tools. | MCP only for steps (`manage_workout`, `set_workout`, `add`, `edit_cycle_slot` with `workoutId`). The app can only copy an existing library workout onto a dated session. | Template: `brickWithNext` in the app builder or MCP. Dated session: MCP only. | App builder, `edit_cycle_slot`, generator, import. |
| Home (2.1) | Today hero, "Start". | Today hero, "Start" opens the strength logger. | Endurance today card: name, one truncated line, start, link to the detail. The Today hero does not list it. | Path A: one hero row. Path B: two card rows. No brick mark on home. | Hero reads "Rest Day". |
| Detail page (2.8) | None (`/planned/[id]` gives 404). Program page instead. | None. | `/planned/[id]`: one row per expanded step, band, planned load. | Path B only, one page per leg. | None. |
| `/week`, cycle sheet, calendar (2.2 to 2.5) | Row with no action on `/week`. Start on the cycle sheet today. | Same as strength. | `/week` row links to the detail. Cycle sheet and calendar have no start, no step list and no link. Calendar reads "No program assigned". | Brick icon on the cycle detail row only. A path A brick counts under "Strength" on `/week`. | `/week` shows "Rest", also for a named day such as "Mobility". |
| During (3) | Strength logger. | Strength logger; a set tap opens `LogRunModal` (distance, duration, incline for run, HR zone, RPE). | Guided player for bike and run; pool view for swim (a pager, saves nothing). Player state is in `localStorage` until the results save. | Path A: logger. Path B: one player per leg. | Nothing. |
| Watch-only user (3.7, 4.12) | A Garmin strength activity does not clear the session. | Pairs with a Garmin activity of the same sport and day. | Same pairing. | Path A never pairs; it needs "Did you do it?". Path B pairs per leg. | Nothing to do. |
| After (4) | Finish screen, history, PRs, metrics. | Band where shown. No history row when done by Garmin. | Band on `/planned/[id]`, `/week`, calendar. Results form (hand entry, one value per work step). No Garmin step results. No history row when done by Garmin. | A band per leg (path B). No combined result. | No record. |
| Adapt (5) | Progression engine, weight-stack learning. | Weekly sync scales sets with a peak anchor. Readiness swap, limits, missed-key move apply when the session has one sport. | No weekly scaling. Readiness swap and limits apply. | Path A brick: no readiness swap, never key by length. | Illness and readiness change no session by themselves. |

## 1. Plan: how a session gets onto a day

### 1.0 The model

| Object | Table | Facts |
|---|---|---|
| Cycle | `training_cycles` | A time-boxed block with a weekly template. `scheduleType` is `day_of_week` or `rotation` (`src/db/schema/training-cycles.ts:42-46`). `status` is `draft`, `active` or `completed` (`:74-76`). One cycle is active at a time: activation completes the others (`src/lib/plan-revisions.ts:772-775`). `scheduledStartDate` starts a draft on a later day (`training-cycles.ts:88-92`). `goal` is `build` or `maintain`, `athleteLevel` is novice, intermediate or advanced (`:50-59`). `lastSyncedWeek`, `adaptationPct`, `adaptationNote` belong to the weekly sync (`:60-67`). `endAction` is deload, new_cycle, rest or none (`:77-81`). |
| Slot | `training_cycle_slots` | One template entry. Weekday mode uses `dayOfWeek` 1-7 and `daySlot` 1-3. Rotation mode uses `orderIndex` (`training-cycles.ts:123-138`). A slot holds a `programId` or a `workoutId` (library workout, weekday cycles only), never both (`:128-141`, `src/lib/planned-sessions.ts:672-675`). Other fields: `label`, `notes`, `autoComplete`, `priority`, `brickWithNext` (`training-cycles.ts:127-145`). |
| Program | `programs`, `program_exercises`, `program_sets` | A named template of exercises and sets (`src/db/schema/programs.ts:30-53`). `createdByCycleId` marks a program a generator made for one cycle (`:36-43`). An endurance segment is one `program_sets` row with `durationSeconds`, `distanceMeters`, `targetHeartRateZone` 1-5, `inclinePercent`, `restTimeSeconds`, `sessionRole`, and the peak anchors `peakDistanceMeters` and `peakDurationSeconds` (`:170-198`). |
| Planned session | `planned_sessions` | One dated session. A weekday cycle gets one row per template slot per day for the whole block (`src/db/schema/planned-sessions.ts:4-7`, `src/lib/utils/planned-sessions.ts:110-136`). A rotation cycle stores no rows from the template. It stores only overrides, with `rotationPosition` set and `date` null (`planned-sessions.ts:9-11`, `:42-45`). |
| Program session or workout session | `planned_sessions.programId`, `.workout` | A session runs a program or its own copy of a workout JSON, never both (check constraint, `planned-sessions.ts:56-59`, `:84`). `workoutId` records the library entry it was copied from and is not read for content (`:60-61`). |
| Brick | `planned_sessions.brickParentId` | The session this one follows on the same day (`planned-sessions.ts:64-65`). One level only, same cycle and day, parent earlier in the day (`src/lib/planned-sessions.ts:1195-1204`, `:1043`). |
| Origin fields | `slotId`, `templateDate`, `touchedAt` | `slotId` and `templateDate` are the key regeneration matches on. `slotId` is null for a session added by hand (`planned-sessions.ts:36-41`). `touchedAt` is set by any user or assistant change. Null means a template edit may rewrite the row (`:54-55`). There is no `source` column on `planned_sessions`. |
| Stored status | `planned_sessions.status` | `planned`, `skipped`, `missed` (`planned-sessions.ts:23`). `statusOn` holds the user's date of the last skip or miss (`:70-72`). |
| Read states | computed | `done` and plain `missed` are never stored. They are matched from completed workouts on read (`planned-sessions.ts:6-7`). With the endurance switch on, the states are planned, done, missed, unconfirmed, illness, sick, skipped (`src/lib/utils/session-compliance.ts:303`, `:425-449`). |
| Logged session | `workout_sessions` | `source` is `app`, `auto` or `assistant` (`src/db/schema/workout-sessions.ts:67-71`). `plannedSessionId` links it to a planned session (`:72-75`). `intendedDate` marks a make-up (`:63-66`). `readiness` is the pre-workout score 1-5 (`:60-62`). |
| Season and phase | `seasons`, `season_races` | A season has a name, goal, start, end and races (`src/db/schema/seasons.ts:26-52`, `:54-75`). A phase is a cycle with `seasonId`, `phaseOrder` and `phaseType` (general, base, build, peak, taper, transition) (`training-cycles.ts:28-30`, `:94-100`). The next phase is scheduled for the day after the running one ends (`src/lib/plan-revisions.ts:785-787`). |
| Workout library | `workouts` | Reusable structured workouts. `sport` is swim, bike or run only (`src/db/schema/workouts.ts:12`, `:16-34`). Sessions get a copy, not a reference (`:4-6`). |
| autoComplete | slot and session flag | "Days tracked outside the app" (`training-cycles.ts:132-135`). The app writes a completed `source='auto'` workout with no sets, timed at noon (`src/lib/auto-sessions.ts:17-40`). |
| Rest day | no row | A weekday rest day is a slot with no program and no workout. It is the only slot of its day (`src/lib/utils/planned-sessions.ts:35-49`). Generation makes no planned session for it (`:108-114`). On a rotation cycle a rest slot uses one calendar day of the walk (`src/lib/utils/cycle-position.ts:5`). |

How dated sessions follow the template:

- Every plan write runs inside `planWrite`. Its `finish` calls `regenerateSessions`, which regenerates each cycle the write created or whose template changed (`src/lib/plan-revisions.ts:468-498`, `:501-502`, `:555-565`).
- The template key holds status, start dates, lengths, schedule type and every slot field (`src/lib/planned-sessions.ts:304-310`).
- Regeneration rules: done rows, rows a workout was started for, and rows before this week's Monday never change. Touched rows keep their changes. Untouched rows from this week's Monday follow the template. A day holds at most three sessions that are not skipped (`src/lib/utils/planned-sessions.ts:170-183`, `:10`).
- A cycle that has no dated rows yet gets them on first read (`ensureCycleSessions`, `src/lib/planned-sessions.ts:328-343`).
- Brick links come from the template: the session of the slot after one marked `brickWithNext` follows it. Touched, done and started sessions keep their own link (`src/lib/planned-sessions.ts:280-301`).

### 1.1 Every route onto a day

| # | Route | Who triggers it | Function, file:line | Rows written | Types it can produce |
|---|---|---|---|---|---|
| 1 | Create a cycle | User: `CreateCycleForm` on `/cycles/new` (`src/app/cycles/new/page.tsx:56`), submit `createTrainingCycle` (`src/components/features/CreateCycleForm.tsx:110`) | `createTrainingCycle`, `src/lib/actions/training-cycles.ts:600-630` | `training_cycles` | None yet. A cycle with no slots has no sessions. |
| 2 | Edit the weekly template | User: `CycleScheduleBuilder` on `/cycles/[id]/template` (`src/app/cycles/[id]/template/page.tsx:42`), submit `upsertCycleSlot`, `removeCycleSlot`, `reorderCycleSlots` (`src/components/features/CycleScheduleBuilder.tsx:432-453`, `:633`, `:660-693`) | `upsertCycleSlot`, `src/lib/actions/training-cycles.ts:838-882`; `upsertSlotInTx`, `src/lib/planned-sessions.ts:651-703` | `training_cycle_slots`, then `planned_sessions` by regeneration | Program slots (strength or path A endurance), rest day, `autoComplete`, key priority, `brickWithNext`. The app's slot schema has no `workoutId` (`src/lib/validators/training-cycles.ts:38-55`). |
| 3 | Edit the weekly template over MCP | AI: `edit_cycle_slot` (`src/lib/mcp/tools/cycles.ts:403-434`) | same `upsertSlotInTx` | same | As 2, plus a library workout on a slot (`workoutId`, `cycles.ts:409`, `:429`). |
| 4 | Start or schedule a cycle | User: `CreateCycleForm.tsx:304`, `CycleDetailClient.tsx:104`, `CycleCompletionBanner.tsx:58`. AI: `manage_training_cycle` operation `start` (`src/lib/mcp/tools/cycles.ts:143`) | `startTrainingCycle`, `src/lib/actions/training-cycles.ts:775-813`; `activateInSession`, `src/lib/plan-revisions.ts:736-790`; `scheduleCycle`, `:797-831` | Cycle status and start date. Dated rows are made by regeneration with `includePast` when the start moved (`plan-revisions.ts:483-487`). | All types in the template. |
| 5 | Scheduled start comes due | Job on read: `startDueScheduledCycle` (`src/lib/plan-revisions.ts:1070-1116`), called from `getActiveCycleForUser` (`src/lib/actions/training-cycles.ts:157`), `syncDueCycle` (`src/lib/periodization-sync.ts:49`) and MCP reads (`src/lib/mcp/tools/cycles.ts:86`, `:110`) | as 4 | Cycle becomes active as writer `sync`; training limits stored as warnings (`plan-revisions.ts:1089-1100`) | All types in the template. |
| 6 | Restart a cycle | User: `CycleDetailClient.tsx:189` | `restartTrainingCycle`, `src/lib/actions/training-cycles.ts:815-836` | as 4, start is today | All types in the template. |
| 7 | Triathlon plan generator | User: `SeasonForm` on `/seasons/new` (`src/app/seasons/new/page.tsx:38`), submit `generateTriathlonPlan` (`src/components/features/SeasonForm.tsx:190`). `/cycles/triathlon` redirects there (`src/app/cycles/triathlon/page.tsx:7-9`). | `generateTriathlonPlan`, `src/lib/actions/triathlon-plan.ts:25-47`; `createTriathlonPlan`, `src/lib/triathlon-plan.ts:79-159`; `insertPlanWeek`, `:198-232` | One season, one A race, one draft cycle per phase, one program per training day (`createdByCycleId`), slots, program sets with peak anchors | Strength (two days), run intervals, bike plus swim day, recovery swim, long run, long bike plus brick run, rest days (`src/lib/utils/triathlon-plan.ts:344-382`, `:418-419`). Path A only. |
| 8 | Create a season, add a phase | User: `SeasonForm.tsx:205` (`createSeasonAction`), `AddPhaseForm` on `/seasons/[id]/phases/new` (`src/app/seasons/[id]/phases/new/page.tsx:33`, `AddPhaseForm.tsx:145`). AI: `manage_season` (`src/lib/mcp/tools/seasons.ts:166`, `:181`) | `createSeason`, `src/lib/seasons.ts:325-353`; `addPhaseIn`, `:651-734` | `seasons`, `season_races`; an existing cycle joins, or a new empty draft cycle is made (`seasons.ts:713-725`) | None by itself. A new phase has no slots. |
| 9 | Create or edit a program | User: `ProgramListClient` on `/programs` (`src/app/programs/page.tsx:32`, `ProgramListClient.tsx:146`), plus the program editor actions in `src/lib/actions/programs.ts:191-1258`. AI: `create_program`, `update_program`, `edit_program_exercise` (`src/lib/mcp/tools/programs.ts:222`, `:243`, `:293`) | `createProgram`, `src/lib/actions/programs.ts:191`; `addProgramSet`, `:941`; `updateProgramSet`, `:1009` | `programs`, `program_exercises`, `program_sets` | Strength, and path A run, bike, swim sets. A program is on a day only through a slot or a planned session. |
| 10 | Import a program or a cycle (JSON) | User: `ProgramListClient.tsx:169`; `AiSetupClient` on `/more/ai-setup` (`src/app/more/ai-setup/page.tsx:84`, `AiSetupClient.tsx:631`, `:642`) | `importProgram`, `src/lib/actions/programs.ts:1483`; `importCycle`, `src/lib/actions/training-cycles.ts:939-1007` | Programs; a draft cycle with slots (`label`, `notes`, `auto`) | Program slots only. The import schema has no workout, priority or brick field (`src/lib/validators/training-cycles.ts:68-83`). |
| 11 | In-app AI plan and edit | User: `AiSetupClient.tsx:528` (`editPlanWithAi`), or copy a prompt and paste the reply (`AiSetupClient.tsx:1043-1079`) | `editPlanWithAi`, `src/lib/actions/ai-generate.ts:140`; `generateWithModel`, `src/lib/ai-generation.ts:43`; then route 10 | as 10 | The set schema holds reps, kg, `durSec`, `distM`, rest, rep range and RIR only (`src/lib/utils/ai-plan.ts:61-71`). No HR zone, no workout steps. |
| 12 | Copy a shared program | User: `SharedProgramsClient.tsx:44` | `copySharedProgram`, `src/lib/actions/program-shares.ts:147` | Programs | As 9. |
| 13 | Add one dated session | User: op `add` with a required `programId` (`src/lib/validators/planned-sessions.ts:23-31`), through `updatePlannedSession` (`src/lib/actions/planned-sessions.ts:40-59`). AI: `manage_planned_session` operation `add` with `programId`, `workout` or `workoutId` (`src/lib/mcp/tools/planned-sessions.ts:122`, `:181-184`) | `sessionOpBody` add branch, `src/lib/planned-sessions.ts:952-990` | One `planned_sessions` row, `touchedAt` set, `slotId` null | App: program sessions. MCP: program or workout sessions, with optional `priority` and `brickParentId`. Weekday cycles only (`:958`). The date is today or later and inside the block (`:1206-1211`). Cap of three a day (`:970`). |
| 14 | Change what a session runs | User: op `change` with `programId` (`PlannedSessionActions.tsx:453`), op `set_workout` with a library `workoutId` (`PlannedSessionActions.tsx:464`, `CycleCalendarClient.tsx:236-240`). AI: `change`, `set_workout` (JSON or library id), `clear_workout`, `update_from_library` (`src/lib/mcp/tools/planned-sessions.ts:127`, `:133`) | `sessionOpBody`, `src/lib/planned-sessions.ts:1014-1031`, `:1087-1138` | The row's `programId` or `workout` and `workoutId` | App: another program, or a copy of a library workout. MCP: also a workout from inline JSON. A past session cannot be changed (`:1016`, `:1089`). |
| 15 | Move, skip, unskip, reset, remove a session | User: `PlannedSessionActions.tsx:84-112`, `:325-440`. AI: `manage_planned_session` | `sessionOpBody`, `src/lib/planned-sessions.ts:999-1013`, `:1082-1086`, `:1139-1170` | `date`, `position`, `status`, `skipReason`, `statusOn`, `touchedAt` | All types. A template session cannot be removed, only skipped (`:1167`). A brick moves by its first session and its second leg follows (`:1001`, `:1173-1190`). |
| 16 | Rotation override | User: `CycleSessionsClient.tsx:424-429`, `:475-508` (`updateRotationSession`). AI: `manage_planned_session` with `rotationPosition` (`src/lib/mcp/tools/planned-sessions.ts:157-173`) | `applyRotationOp`, `src/lib/planned-sessions.ts:1217-1298` | An override row with `rotationPosition`, `date` null | Program sessions only. Ops are skip, unskip, change (`:1219`). |
| 17 | Brick link and priority on a dated session | AI only: `link_brick`, `unlink_brick`, `set_priority` (`src/lib/mcp/tools/planned-sessions.ts:133`). The app schema says these are "MCP only until the app has a control for them" (`src/lib/validators/planned-sessions.ts:32-33`). | `sessionOpBody`, `src/lib/planned-sessions.ts:1032-1050` | `brickParentId`, `priority` | Brick, key or support or optional. |
| 18 | Workout library write | User: `WorkoutsLibraryClient` on `/more/workouts` (`src/app/more/workouts/page.tsx:26`, `WorkoutsLibraryClient.tsx:45`): duplicate, rename, delete, restore only (`src/lib/validators/planned-sessions.ts:74-80`). AI: `manage_workout` create, update, duplicate, delete (`src/lib/mcp/tools/workouts-compliance.ts:104`, `:117`) | `createWorkout`, `updateWorkout`, `src/lib/workouts.ts:131-165`; `regenerateUsers`, `:96-106` | `workouts`. An update or delete regenerates the untouched sessions of active and scheduled weekday cycles whose slots use it (`workouts.ts:114-129`, `:186`). | Swim, bike, run. Only an assistant can create a workout or change its steps. |
| 19 | Readiness swap | User tap or AI. See section 5. | `applyReadinessSwap`, `src/lib/readiness-swap.ts:65-102` | `set_workout` on today's hard session | Swim, bike or run easy session (`src/lib/utils/training-limits.ts:614-623`). |
| 20 | Weekly periodization sync | Job on read. See section 5. | `syncPeriodizedTargets`, `src/lib/periodization-sync.ts:246-365` | Rewrites `program_sets` distance, duration, HR zone and rest. It does not add or move sessions. | Path A endurance sets with a peak anchor only. |
| 21 | Start a workout with no plan | User: `NewWorkoutClient` on `/new-workout` picks any program (`src/app/new-workout/page.tsx:15-24`, `NewWorkoutClient.tsx:50`, `:77`) | `createWorkoutSession`, `src/lib/actions/workout-sessions.ts:51-102` | `workout_sessions` only. No planned session is made. The link to a planned session is kept only for a session of today with the same program (`src/lib/planned-sessions.ts:1393-1411`). | Any program. |
| 22 | Restore a revision | User or AI. See section 5. | `restoreRevision`, `src/lib/plan-revisions.ts:1838` | Puts a program, cycle, season, session or workout back | All types. |

The athlete interview page (`/more/athlete/interview`, `InterviewClient`, `src/app/more/athlete/interview/page.tsx:16`) submits `moveMemoryToProfile` and `finishInterview` (`InterviewClient.tsx:99`, `:111`). It writes profile data. It puts no session on a day.

### 1.2 Per training type

Strength (short pointer)

| Item | Fact |
|---|---|
| Data | A program with reps and kg sets. A planned session with `programId`. `sport` is null (`src/lib/session-compliance.ts:129`). |
| Planned by | Routes 2, 3, 7, 9, 10, 11, 13, 14 in 1.1. |
| Engine | The progression engine: `evaluateSession` (`src/lib/utils/progression.ts:664`), `buildSuggestion` (`:1328`). Plan: `docs/progression-revamp-plan.md`. |
| Stack learning | `learnWeightStacks` (`src/lib/weight-stack-learning.ts:35`), run when a session completes or is swept (`src/lib/actions/workout-sessions.ts:75`, `:203`, `:231`). |
| Limit rules that read it | `heavy_legs_before_key` and `strength_per_week` (section 5). A strength session never counts as hard (`src/lib/utils/training-limits.ts:155-156`). |

Run

| Item | Fact |
|---|---|
| Path A data | A program whose exercises all have `discipline = run` gives the session `sport = run` (`src/lib/session-compliance.ts:126-133`). Sets hold distance, duration, HR zone 1-5, incline, rest, `sessionRole` (`src/db/schema/programs.ts:170-198`). |
| Path B data | `planned_sessions.workout` with `sport: "run"` (`src/db/schema/planned-sessions.ts:59`, `src/db/schema/workouts.ts:12`). |
| Planned by, path A | Generator: interval run on Tuesday, long run on Saturday (`src/lib/utils/triathlon-plan.ts:350-353`, `:370-373`). Program editor, import, in-app AI, MCP program tools. |
| Planned by, path B | MCP `manage_workout`, `set_workout`, `add` with a workout, `edit_cycle_slot` with `workoutId`. App: pick an existing library workout for a dated session only (`PlannedSessionActions.tsx:464`). |
| Hard | Path A: a set with `sessionRole = work` or zone 4-5 (`src/lib/utils/training-limits.ts:168-172`). Path B: `isHardWorkout` (`src/lib/session-compliance.ts:259`). |
| Only for run | The long-run cap reads run sets and run history (`src/lib/utils/training-limits.ts:39-60`, `:133-148`). Incline is shown for run only (`src/lib/utils/discipline.ts:98`). |
| Key by length | Longest run of its week and at least 90 minutes reads as key (`src/lib/utils/session-compliance.ts:451-486`). |

Bike

| Item | Fact |
|---|---|
| Path A data | Program with `discipline = bike` sets. Same set fields as run. No power, pace or cadence column exists on `program_sets` (`src/db/schema/programs.ts:152-201`). |
| Path B data | Workout with `sport: "bike"`. |
| Planned by, path A | Generator: mid bike on Wednesday in one program with a swim, long bike on Sunday in one program with a brick run (`src/lib/utils/triathlon-plan.ts:354-360`, `:375-381`). |
| Planned by, path B | Same as run. |
| Differences | No long-ride cap exists: the cap rule is run only (`src/lib/utils/training-limits.ts:39-43`). Key by length applies to bike and run, not swim (`src/lib/utils/session-compliance.ts:480-484`). Heavy legs before key reads bike and run keys only (`src/lib/utils/training-limits.ts:361`). |

Swim

| Item | Fact |
|---|---|
| Path A data | Program with `discipline = swim` sets. |
| Path B data | Workout with `sport: "swim"`. |
| Planned by, path A | Generator: endurance swim in the Wednesday bike program, recovery swim on Friday (`src/lib/utils/triathlon-plan.ts:332-342`, `:358-369`). All swim sets are zone 2; no swim set has `sessionRole = work` (`:333-341`, `:310-312`). |
| Differences | A swim is never key by length (`src/lib/utils/session-compliance.ts:480-484`). No heavy-legs check before a swim (`src/lib/utils/training-limits.ts:361`). No long-swim cap. The readiness swap can make an easy swim (`:614`). |
| Mixed day | The generator's "Bike · Endurance + swim" is one program with two disciplines. Its `sport` is null and `sports` is `[bike, swim]` (`src/lib/session-compliance.ts:129-130`). A "Yes, I did it" on a mixed session logs its time on the first sport (`src/lib/session-answers.ts:61-62`). |

Brick day

| Item | Fact |
|---|---|
| Path A data | One program with a Bike exercise and a Run exercise: "Long Bike + Brick Run" (`src/lib/utils/triathlon-plan.ts:375-381`). One planned session. `sport` is null because the program has two disciplines (`src/lib/session-compliance.ts:129`). No `brickParentId` is set. |
| Path B data | Two planned sessions on the same day, the second with `brickParentId` (`src/db/schema/planned-sessions.ts:64-65`). |
| Planned by | Template: `brickWithNext` on a slot, from the app builder (`CycleScheduleBuilder.tsx:446`, `:523`) or `edit_cycle_slot` (`src/lib/mcp/tools/cycles.ts:431`). Dated session: `add` with `brickParentId`, `link_brick`, `unlink_brick`, MCP only (`src/lib/validators/planned-sessions.ts:32-33`). |
| Rules | Same cycle and day, parent earlier in the day, one level (`src/lib/planned-sessions.ts:1195-1204`). A move of the first session moves the second. A logged second leg blocks the move (`:1173-1190`). The second leg cannot move alone (`:1001`). A rotation session cannot be in a brick (`:1037`). |
| Matching | One logged workout with sets of two disciplines clears one session of each sport (`src/lib/utils/session-compliance.ts:321-323`). |
| Readiness swap | A swapped session keeps its brick link (`src/lib/readiness-swap.ts:76-77`). |

Rest day and recovery day

| Item | Fact |
|---|---|
| Rest day, weekday cycle | A slot with `programId` null and `workoutId` null (`CycleScheduleBuilder.tsx:66`). It is the only slot of its day (`src/lib/utils/planned-sessions.ts:46-47`). No `planned_sessions` row exists for it (`:114`). The home "today slot" falls back to the template's rest slot on a day with no session (`src/lib/planned-sessions.ts:597-604`). |
| Rest day, rotation cycle | A rest slot with label "Rest" (`CycleScheduleBuilder.tsx:668`). It uses one calendar day (`src/lib/utils/cycle-position.ts:5`). |
| Rest day by deletion | A slot whose program or library workout was deleted reads as a rest day (`src/lib/planned-sessions.ts:76-82`, `:89`, `:520-521`). |
| Rest day in the generator | The form sends up to two `restDays` (`src/lib/actions/triathlon-plan.ts:19`). Defaults come from the profile's `availableDays`, else Friday and Saturday (`src/lib/utils/triathlon-plan.ts:439-452`). The lightest sessions drop and long sessions slide to free days (`:384-422`). The slot gets label "Rest" and no program (`src/lib/triathlon-plan.ts:201-209`). |
| Planned by | App builder, `edit_cycle_slot`, generator, cycle import. A rest day cannot be added as a dated session: `add` needs a program or a workout (`src/lib/planned-sessions.ts:962-964`). |
| Recovery day | No recovery-day object exists. The nearest things are: a program named "Recovery Swim" (one zone 2 set, `src/lib/utils/triathlon-plan.ts:365-369`); a `recovery` step type inside a workout (`src/lib/utils/workout-steps.ts:24`); the easy session the readiness swap writes (`src/lib/utils/training-limits.ts:614-623`); a deload week in the periodization curve (`src/lib/utils/periodization.ts:50-52`); a `transition` phase type (`src/db/schema/training-cycles.ts:29`); the cycle `endAction` values `deload` and `rest`; only the completion banner reads `endAction` (`src/components/features/CycleCompletionBanner.tsx:67`, `:107`). |
| A skipped session | A session skipped before its day is a plan change and leaves the week's count (`src/lib/utils/session-compliance.ts:82-91`). The row stays with `status = skipped`. The day is not marked as rest. |

### 1.9 Plan and adapt facts that look like gaps (sections 1 and 5)

Facts only.

1. A structured workout can be created or have its steps changed only over MCP. The app can duplicate, rename, delete and restore a library workout (`src/lib/validators/planned-sessions.ts:74-80`) and can copy an existing library workout onto a dated session (`:34`).
2. The app's template builder cannot put a library workout on a slot. The app action schema has no `workoutId` (`src/lib/validators/training-cycles.ts:38-55`). The MCP tool has it (`src/lib/mcp/tools/cycles.ts:429`).
3. The app's `add` session op requires a `programId` (`src/lib/validators/planned-sessions.ts:23-31`). A workout session can be added only over MCP.
4. Brick link, unlink, `set_priority` on a dated session, `unmiss`, the Garmin `pick` and `update_from_library` have no app control (`src/lib/validators/planned-sessions.ts:32-33`). The app can set `brickWithNext` and a key toggle on a template slot only (`CycleScheduleBuilder.tsx:299`, `:446`).
5. A brick has two shapes. Path A: one program with two disciplines, one session, `sport` null (`src/lib/utils/triathlon-plan.ts:375-381`, `src/lib/session-compliance.ts:129`). Path B: two sessions with `brickParentId`. The path A brick has no sport, so the readiness swap never picks it (`src/lib/utils/training-limits.ts:639`), and it is never key by length (`src/lib/utils/session-compliance.ts:479`).
6. The generator's Wednesday "Bike · Endurance + swim" has the same shape: one session, `sport` null. A "Yes" answer logs all its time on the bike (`src/lib/session-answers.ts:61-62`).
7. The weekly sync scales only `program_sets` with a peak anchor (`src/lib/periodization-sync.ts:308-347`). Workout sessions get no weekly scaling and no adaptation percent. `set_volume` and the wearable suggestion act on the same sets only.
8. The long-run cap exists for run only. No rule caps a single ride or swim (`src/lib/utils/training-limits.ts:39-43`).
9. Key by length applies to bike and run only (`src/lib/utils/session-compliance.ts:480-484`). The code states this as inference for "long ride, long run" (`:463-466`). A swim is key only when hard or stored.
10. The generator makes no hard swim or bike session: only the run intervals have `sessionRole = work` and zone 4 (`src/lib/utils/triathlon-plan.ts:321-330`). So in a generated plan the readiness swap and the hard-session rule can act on the Tuesday run only.
11. Training limits never check a user's own edit (`src/lib/training-limits.ts:5-6`). Only the heavy-legs line is shown to the user for own edits (`src/app/more/calendar/page.tsx:72`).
12. Sync and scheduled-start limit warnings are stored on the revision. The user sees the sync warnings on the cycle page (`src/app/cycles/[id]/page.tsx:85`). `syncLimitWarnings` reads only the change sets `sync:<cycle>:<week>` and `apply:<cycle>:<week>` (`src/lib/training-limits.ts:884`). A scheduled start passes no such change set id (`src/lib/plan-revisions.ts:1093-1100`). The plan history page reads `limitCheck` only for the override line (`src/components/features/PlanHistoryPage.tsx:47`). So in the files read, no screen shows the warnings of a scheduled start or of a readiness swap the user applied.
13. An illness period changes no session and no volume directly (`src/db/schema/illness.ts:3-5`). It does lower adherence in the next weekly sync, which can ease volume 10% (`src/lib/periodization-sync.ts:138-142`, `src/lib/utils/periodization.ts:363-365`). Illness `severity` is read only by the return rule text (`src/lib/utils/session-compliance.ts:207-211`).
14. Inputs stored but read by no adapt mechanism: Body Battery; sleep other than sleep debt in the wearable suggestion; step results and compliance bands (neither is read in `src/lib/periodization-sync.ts` or `src/lib/training-limits.ts`); `missedReason` and `skipReason` (written at `src/lib/planned-sessions.ts:1012`, `:1054`, returned in `SessionCompliance`, `src/lib/session-compliance.ts:363-364`); priority `optional`; coach memory (`src/lib/coach-memory.ts:8-10`).
15. The wearable suggestion is computed only when the Garmin training tab renders (`src/app/more/garmin/page.tsx:57`). The home read calls the readiness swap, not the suggestion (`src/lib/home/core.ts:103-106`).
16. The readiness swap and the readiness limit need Garmin, which is admin only (`src/lib/garmin/access.ts:15-17`). The no-wearable path uses the 1-5 check-in, which is asked at the start of an in-app workout only (`src/contexts/workout-session-context.tsx:290`), so a watch-only endurance session gives no readiness value.
17. With the endurance switch on, `autoComplete` has no effect on a session whose program holds an endurance sport (`src/lib/planned-sessions.ts:542-557`). The generator still sets `autoComplete` on every endurance-only day (`src/lib/utils/triathlon-plan.ts:429`), and the generator needs the switch on (`src/lib/triathlon-plan.ts:82`).
18. Rotation cycles: no dated rows, no workouts on slots (`src/lib/planned-sessions.ts:672`), no added sessions (`:958`), no bricks (`:1037`), no move (`src/lib/mcp/tools/planned-sessions.ts:159-160`), and `hard_sessions_per_week` is not counted (`src/lib/training-limits.ts:1162`). `sessionCompliance` reads weekday rows only (`src/lib/session-compliance.ts:226-234`).
19. No rest-day or recovery-day record exists on a date. A rest day is the absence of a session on a template rest slot (`src/lib/utils/planned-sessions.ts:108-114`). A recovery day has no data form (section 1.2).
20. The season re-plan flag changes nothing by itself and waits for a manual clear (`src/db/schema/seasons.ts:38-41`).
21. The cycle `endAction` values are read by the completion banner only: `new_cycle` and `deload` show a start button, and `deload` changes its text (`src/components/features/CycleCompletionBanner.tsx:67`, `:107`). No code under `src/lib` reads them to change a plan; `rest` and `none` have no reader there.
22. The in-app AI plan schema has no HR zone and no workout steps (`src/lib/utils/ai-plan.ts:61-71`), and cycle import has no workout, priority or brick field (`src/lib/validators/training-cycles.ts:68-83`).

## 2. Before: screens that show a session before training

Repo `/Users/mnordbye/Documents/Code/github/logeverylift`, `main` at feafb9f. Read from code. Nothing was run.
All paths are relative to the repo root. Strength-only screens get a short pointer (scope change from the caller).

Terms used here:

- Path A: an endurance session stored as a program (`planned_sessions.program_id`), with cardio exercises and `program_sets`.
- Path B: a session with a structured workout (`planned_sessions.workout`), no program.
- Endurance switch: `users.endurance_enabled`, read by `enduranceEnabledFor` (`src/lib/endurance.ts:18-24`). Only an admin can set it (`src/lib/endurance.ts:4-6`).
- Garmin access: `garminAllowed(role)` is true only for role `admin` with `GARMIN_KEY_ENCRYPTION_KEY` set (`src/lib/garmin/access.ts:15-17`).

### 2.0 Navigation map

Bottom navigation (`src/components/ui/bottom-nav.tsx:15-36`):

| Tab | Target | Note |
|---|---|---|
| Workout | `/`, or the open workout path while a workout is active | `bottom-nav.tsx:122-124`. Active on `/`, `/new-workout` and `/programs/*/workout*` (`:96-98`). |
| Plan | `/cycles` | Also active on `/seasons*` (`:111`). |
| Programs | `/programs` | |
| More | `/more` | Also active on `/settings`, `/history`, `/exercises` (`:102-108`). |

The tab bar is hidden on the Plan form routes, login, signup, welcome and the legal pages (`bottom-nav.tsx:13`, `:74`, `:93`).
No tab points at `/week`, `/more/calendar`, `/planned/*` or `/more/workouts`.

More menu (`src/components/features/MoreClient.tsx:18-164`, flags from `src/app/more/page.tsx:11-19`):

| Group | Entry | Route | Shown when |
|---|---|---|---|
| Training | History | `/history` | always (`MoreClient.tsx:22-27`) |
| Training | Progress | `/more/metrics` | always (`:28-33`) |
| Training | Garmin | `/more/garmin` | `showGarmin` = `garminAllowed(role)` (`:128-133`, `:244-247`; `more/page.tsx:17`) |
| Training | Calendar | `/more/calendar` | always (`:34-39`) |
| Training | Exercises | `/exercises` | always (`:40-45`) |
| Training | Thresholds | `/more/thresholds` | always (`:46-52`) |
| Training | Athlete profile | `/more/athlete` | endurance switch (`:136-141`, `:248-251`; `more/page.tsx:18`) |
| Training | Workouts | `/more/workouts` | endurance switch (`:144-149`, `:250`) |
| Training | Nutrition | `/more/nutrition` | endurance switch (`:152-157`, `:250`) |
| Plan & share | AI Setup, Friends, Gym map, Invite a friend | `/more/ai-setup`, `/more/friends`, `/more/gyms`, share action | always (`:56-83`) |
| App | Settings, Account, Connected assistants, Coach memory, Feedback, Privacy & Terms | `/settings`, `/more/account`, `/more/assistants`, `/more/coach-memory`, `/more/feedback`, `/privacy` | always (`:85-123`) |
| App | Admin Tools | `/more/admin` | role `admin` (`:159-164`, `:243`) |

How the endurance screens are reached:

| Screen | Inbound links |
|---|---|
| `/week` | "This week →" on the Endurance today card (`src/components/features/guided/EnduranceTodayCard.tsx:27-29`); the Training load widget (`src/components/features/home/widgets/training-load/View.tsx:15`, `:48`); the error state of the Endurance today widget (`src/components/features/home/widgets/endurance-today/View.tsx:28`); Back from `/planned/[id]` (`src/app/planned/[id]/page.tsx:36`). No menu entry. |
| `/planned/[id]` | A row of the Endurance today card (`EnduranceTodayCard.tsx:34`); a path B row on `/week` (`src/app/week/page.tsx:203`); Back from the pool view and results (`src/components/features/guided/PoolList.tsx:34`, `src/app/planned/[id]/results/page.tsx:24`). |
| `/more/calendar` | More menu; the Week widget on home (`src/components/features/home/widgets/week/View.tsx:119`, `:145`); "planned_session" rows on the assistant changes page (`src/components/features/AssistantChangesClient.tsx:29`). |
| `/more/workouts` | More menu (endurance); "workout" rows on the assistant changes page (`AssistantChangesClient.tsx:30`). |
| `/races/[id]/plan` | "Race plan ›" on a season (`src/components/features/SeasonDetailClient.tsx:365-368`); a race row on Nutrition (`src/components/features/nutrition/NutritionClient.tsx:52`). |

### 2.1 Home `/`

Files: `src/app/page.tsx`, `src/lib/home/core.ts`, `src/lib/home/layout.ts`, `src/lib/home/widgets/*.ts`, `src/components/features/home/**`.

Load order (`src/app/page.tsx:28-50`): session, terms redirect, `closeStaleOpenSessions()` (`:36`), user settings, `activeCycle()` (`:43`), `loadHomeCore` (`:46`), then the layout. `activeCycle` is `getActiveCycleForUser` (`src/lib/home/core.ts:46`). That call can start a scheduled block, complete a block that is over, run the weekly periodization sync and write auto sessions (`src/lib/actions/training-cycles.ts:157`, `:192-198`, `:206-208`; `src/lib/planned-sessions.ts:556-565`).

#### Widgets

Registry order = gallery order (`src/lib/home/widgets/index.ts:24-40`). Default layout: the widgets with `defaultVisible`, in registry order, then all others hidden (`src/lib/home/layout.ts:60-67`). So the default home is Title, Today, Endurance today (endurance only), Week.

| Widget | Sizes, default | Available when | Default visible | Critical | Data | Tap target |
|---|---|---|---|---|---|---|
| Title | m, l; m | always | yes | no | date, "Week N of M" (`widgets/title/View.tsx:15-21`) | none |
| Today | s, m, l; l | always | yes | yes | see below | see below |
| Cycle progress | s, m; m | active cycle (`src/lib/home/widgets/cycle.ts:15`) | no | no | cycle name, week, end date (`widgets/cycle/View.tsx:32-41`) | `/cycles` (`:44`, `:55`) |
| Date | s, m; m | always | no | no | today's date | none |
| Endurance today | m; m | endurance switch (`src/lib/home/widgets/endurance-today.ts:13-14`) | yes with the switch | yes | see below | see below |
| Week | m, l; l | always | yes | no | see below | `/more/calendar` |
| Weekly goal | s, m; s | always | no | no | `stats.thisWeekWorkouts` (`widgets/weekly-goal/View.tsx:13`); the goal is in localStorage (`:8-9`) | none |
| Race countdown | s; s | endurance switch (`src/lib/home/widgets/race-countdown.ts:14`) | no | no | soonest A race from `listSeasons` (`widgets/race-countdown/load.ts:13-20`) | `/seasons/<id>` (`View.tsx:12`); empty state `/seasons` (`:24`), which redirects to `/cycles` (`src/app/seasons/page.tsx:5`) |
| Training load | m, l; m | endurance switch or Garmin access (`src/lib/home/widgets/training-load.ts:14`) | no | no | `getTrainingLoad(userId, 28)`: form, 7-day load, ramp band, 28 daily bars, fatigue line (`widgets/training-load/load.ts:29-38`) | `/week` (`View.tsx:15`) |
| Recent PRs | s, m, l; m | always | no | no | PR feed | `/more/metrics?tab=records` (`widgets/recent-prs/View.tsx:10`) |
| Streak | s, m; s | always | no | no | weeks in a row | `/more/metrics` (`widgets/streak/View.tsx:9`) |
| Weekly sets | s; s | always | no | no | sets per muscle group | `/more/metrics` (`widgets/weekly-sets/View.tsx:9`) |
| Body weight | s, m; s | always | no | no | latest weight, 30-day trend | `/more/metrics` (`widgets/body-weight/View.tsx:15`) |
| Friends' activity | s, m, l; m | always | no | no | friends' workouts | `/more/friends` (`widgets/friends-activity/View.tsx:12`) |
| Garmin readiness | s, m; m | Garmin access (`src/lib/home/widgets/garmin-readiness.ts:14`) | no | no | today's `readiness` from the newest `garmin_daily_metrics` row; null when that row is not today's (`widgets/garmin-readiness/load.ts:18-33`). Shows score, band, contributors (HRV, RHR, Sleep, Sleep debt, Form, Feel) (`View.tsx:20`, `:68-102`) | `/more/garmin?tab=day` (`View.tsx:15`); "Connect Garmin" to `/more/garmin` when not connected (`:52`) |

A critical widget cannot be hidden and is put back if missing (`src/lib/home/layout.ts:96`, `:103-106`). A widget the audience cannot have is left out of the layout (`:94`, `:102`).
"Edit home" (pencil on the title row or long press) opens edit mode with move, resize, hide, add and reset (`src/components/features/home/HomeGrid.tsx:237-261`, `:362`).
With no active cycle a pinned "Start a Workout" bar links to `/new-workout` (`src/app/page.tsx:94`, `src/components/features/home/StartBar.tsx:12-18`).

#### Today widget

Files: `src/components/features/home/widgets/today/View.tsx`, `TodayMore.tsx`, `src/lib/home/today-actions.ts`, `src/lib/home/today-plan.ts`, `src/components/features/TodaySessionsList.tsx`.

Data source. `todaySessions` and `todaySlot` come from `weekdayToday` for a weekday cycle (`src/lib/actions/training-cycles.ts:225-230`). `weekdayToday` keeps only planned sessions with a program: `.filter((r) => r.row.programId != null && r.programDeletedAt == null)` (`src/lib/planned-sessions.ts:519-521`). A path B session is not in `todaySessions`. `todayProgram` is `info.todaySlot.program` (`src/lib/home/core.ts:143`).

Data shown (L size):

| Element | Source | file:line |
|---|---|---|
| Cycle name, "Week N of M", one bar segment per week | `info.cycle`, `core.totalWeeks` | `today/View.tsx:111-121` |
| Name | "N sessions today", or the program name, or "Rest Day", or "No program today" | `today/View.tsx:99-101` |
| "Done" or "Done · automatic" chip | `completedToday`, `todayAutoSession` | `:63-70`, `:125` |
| "N days overdue" | rotation cycles only, from `missedSlots` | `:126-130`; `core.ts:195-205` |
| "N exercises · N sets · about N min" | `readTodayPlan`, one read of the program's exercises and sets | `:132-133`, `:201-202`; `core.ts:72-93` |
| Tip pill | `getWorkoutInsight` headline | `:137-144`; `core.ts:148-150` |
| First three exercises with "sets × target · kg", then names of the rest | `todayPlanFrom` | `:145`, `:205-228`; `src/lib/home/today-plan.ts:48-74` |
| "Cycle ends <date>" | shown at L when there is no plan | `:135` |

`todayPlanFrom` counts only sets with `setType === "working"` (`today-plan.ts:58`, `:62`). Its target text reads reps, then duration, then distance (`today-plan.ts:39-45`). It does not read `targetHeartRateZone`. The plan read does not select that column (`core.ts:73-84`).

Buttons:

| Label | Condition | Action | file:line |
|---|---|---|---|
| Start Today's Workout | one program today, not done | link to `/programs/<id>/workout` | `today/View.tsx:160-163`, `:175-178` |
| Do Again | one program today, done by a logged workout | link to `/programs/<id>/workout` | `:170-173` |
| Log in app | one program today, done by an auto session | link to `/programs/<id>/workout` | `:170-173` |
| I skipped it | an auto session exists today | `skipAutoCompletedDay({ sessionId })`, then refresh. Removes the auto session (`src/components/features/SkipAutoDayButton.tsx:8-25`) | `today/View.tsx:180-184` |
| Different Program | cycle and a program today | link to `/new-workout` | `:152-154`, `:164-166`, `:185-187` |
| Start, Do again (one per session) | several sessions today | link to `/programs/<id>/workout?planned=<plannedSessionId>` | `src/components/features/TodaySessionsList.tsx:28-41` |
| Start a Workout →, Do Another Workout → | cycle, no program today | link to `/new-workout` | `today/View.tsx:192-195` |
| Set up a Cycle → | no cycle | link to `/cycles` | `:268-270`, `:281-284` |
| See the plan → | no active cycle, one scheduled | link to `/cycles/<id>` | `:298-300`, `:311-313` |
| More (S size) | S size | opens a sheet with the other actions | `today/TodayMore.tsx:16-54`; `src/lib/home/today-actions.ts:25-68` |

The Today card has no link to a detail of the session. The program name is plain text (`today/View.tsx:124`).

#### Endurance today widget

Files: `src/components/features/home/widgets/endurance-today/View.tsx`, `src/components/features/guided/EnduranceTodayCard.tsx`, `src/lib/home/core.ts:53-65`.

Data. `enduranceToday` reads `sessionCompliance(userId, today, today)` and keeps sessions with `s.workout && s.sport && s.status === "planned"` (`core.ts:54-56`). So the card lists path B sessions only. Each row has the name (label, else workout name, `src/components/features/answer-session.ts:17`), the summary from `describeWorkout` (`src/lib/session-compliance.ts:352`, `src/lib/utils/workout-steps.ts:488-496`) and "N min · distance" (`core.ts:59-62`). Name and summary are each one truncated line (`EnduranceTodayCard.tsx:35-36`).
With no row the widget renders nothing (`endurance-today/View.tsx:18-20`).

Buttons:

| Label | Condition | Action | file:line |
|---|---|---|---|
| This week → | always | link to `/week` | `EnduranceTodayCard.tsx:27-29` |
| Row (name and summary) | always | link to `/planned/<id>` | `:34-37` |
| Start guided | not done, bike or run | link to `/planned/<id>/play` | `:46-51` |
| Pool view | not done, swim | link to `/planned/<id>/pool` | `:46-51` |
| Resume, Save results | a saved player run for this session in localStorage | link to `/planned/<id>/play` or `/planned/<id>/results?from=player` | `:45`; `src/components/features/guided/SavedRunLink.tsx:14-37` |
| Results | session state is done | link to `/planned/<id>/results` | `EnduranceTodayCard.tsx:39-42` |

#### Week widget

File: `src/components/features/home/widgets/week/View.tsx`. The whole card links to `/more/calendar` (`:119`, `:145`).

- Weekday cycle or no cycle: seven dots, Monday to Sunday. States: done, missed, today, planned, rest (`:85-110`). "done" means the date is in `completedDates` (`:99`), which is the set of dates with a completed `workout_sessions` row (`core.ts:174-176`). A day has a program dot when it has any dated session, a workout session included (`weekDayMarks`, `src/lib/utils/planned-sessions.ts:58-66`; `listPlanned` returns every row, `src/lib/planned-sessions.ts:407-415`). A day with more than one session shows the count (`week/View.tsx:54`).
- Rotation cycle: one chip per slot with the program name, label or "Rest". Today's slot is filled (`:117-142`).
- L size adds the weekly goal ring and a legend Done, Missed, Planned (`:115`, `:153`).
- The widget shows no sport, no session name (weekday cycle) and no key mark.

#### Notices

Fixed slots, not widgets (`src/lib/home/notices.ts:17-25`, `src/components/features/home/Notices.tsx:65-87`).

| Notice | Slot | Shown when | Buttons | file:line |
|---|---|---|---|---|
| Policy update | top | `needsPolicyNotice` | (not audited) | `Notices.tsx:68-69` |
| AI check-in | top | a pending check-in | "Yes, it fits" and "Not now" call `answerCheckin`; "Not really" opens a sheet, "See a revised plan" calls `answerCheckin` and goes to `/more/ai-setup?revise=<id>` | `src/components/features/AiCheckinCard.tsx:27`, `:39-45`, `:61-82`, `:142-146` |
| Sick banner | top | endurance switch and a sick period that covers today | "I'm better" flow: Yesterday or Today call `manageIllness({ op: "end" })` | `src/components/features/DidYouDoIt.tsx:131-137`; `src/components/features/IllnessSheet.tsx:181-216` |
| Return banner | top | endurance switch and a return rule after a sick period | More, Less | `DidYouDoIt.tsx:139-157` |
| Low readiness | after training | endurance switch and `readinessSwapFor` returns a swap | "Make it easy" calls `makeSessionEasy({ plannedSessionId, expectedVersion })`. No dismiss button. | `src/components/features/ReadinessSwapCard.tsx:24-48`; `src/lib/readiness-swap.ts:25-54` |
| Did you do these? | after training | endurance switch and unconfirmed sessions | Yes opens the answer sheet; Missed calls `updatePlannedSession({ op: "miss" })` | `DidYouDoIt.tsx:32-51`; `src/components/features/SessionAnswers.tsx:92`, `:106-110` |
| Missed key session | after training | endurance switch and a missed key session of this week | "Move to <day>" calls `updatePlannedSession({ op: "move", id, date, suggested: true })`; or a reason text with no button | `DidYouDoIt.tsx:53-61`, `:73-103` |
| Missed this week | after training | weekday cycle with missed program sessions | "Make up" links to `/programs/<id>/workout?makeup=<date>`; "Decline" calls `dismissMissedWorkout` | `Notices.tsx:30-63`; `src/components/features/DeclineMakeupButton.tsx:16-25` |
| Share prompt | end | (not audited) | | `Notices.tsx:80-85` |

The readiness swap needs a readiness flag for today from `readinessToday` (`readiness-swap.ts:28-29`) and a hard planned session today that has no open workout (`:30-39`). In a taper phase it is computed with `taper: true` (`:52-53`).
The pre-workout `ReadinessSheet` ("How are you feeling today?", five levels, auto-skip after 4 s with level 3) is part of the strength logger. It is imported only by `WorkoutSessionClient` (`src/components/features/ReadinessSheet.tsx:17-26`; `src/components/features/WorkoutSessionClient.tsx:5`).
`TakeStartSheet` is the confirm before a season takes the scheduled start. It is not a session screen (`src/components/features/TakeStartSheet.tsx:8-12`).

#### Home per training type

| Type | What home shows |
|---|---|
| Strength program session | Today hero with name, counts, first three exercises and "Start Today's Workout". |
| Run, bike or swim on path A | The same Today hero. The exercise line reads "N × <duration or distance>" for working sets only (`today-plan.ts:39-45`, `:58`). No HR zone. The start goes to the strength logger at `/programs/<id>/workout`. It is not on the Endurance today card (`core.ts:56`). |
| Path B session | The Endurance today card only. It is not in `todaySessions` (`planned-sessions.ts:521`). |
| Day with only a path B session | Read from code, not run: the Today hero reads "Rest Day" when the template slot of that weekday has no program, and "No program today" when no such slot exists. `todaySlot` falls back to the weekday's slot with `programId == null` (`planned-sessions.ts:600-604`); a workout slot has `programId == null`. `isRestDay` is `todaySlot !== null && !todayProgram` (`core.ts:191`). The button reads "Start a Workout →" (`today/View.tsx:192-195`). |
| Brick, path A (one program with bike and run exercises) | One Today hero for the program. One Start. |
| Brick, path B (two linked sessions) | Two rows on the Endurance today card. No brick mark (the card has no brick code). |
| Rest day | Today hero "Rest Day", "Cycle ends <date>", "Start a Workout →". Endurance today renders nothing. |
| Completed day | Today: "Done" chip and "Do Again", or "Done · automatic", "Log in app" and "I skipped it". Endurance today: the row shows "Results" when the state is done. |
| Missed day | Weekday cycle, program without a sport: "Missed this week" with Make up and Decline. With the endurance switch a session whose program holds any endurance sport is left out of that list (`planned-sessions.ts:546-552`, `:608`) and goes to "Did you do these?" for 7 days (`src/lib/utils/session-compliance.ts:419`, `:445`). Rotation: "N days overdue" on the Today hero. |
| Sick day | Sick banner at the top. The session rows stay. |

### 2.2 Week `/week`

File: `src/app/week/page.tsx`. Endurance switch only: without it the page redirects to `/` (`:40`). `?w=YYYY-MM-DD` picks the week (`:42-43`).

Data (`:45-51`): `sessionCompliance` (dated sessions of weekday cycles, `src/lib/session-compliance.ts:226-230`), `appSessionLoads`, `thresholdValues`, user units, `getTrainingLoad(userId, 42)`.

| Element | Content | file:line |
|---|---|---|
| Title | "<Mon> to <Sun>" | `:91-93` |
| Load card | fitness (CTL), fatigue (ATL), form (TSB) of the last day, a 6-week fitness line, ramp per week with band, "calibrating" note, count of sessions with no load, the source text "from Garmin and the app" or "from sessions logged in the app" | `:99-135` |
| "How load is counted" | four fixed lines | `:136-144` |
| Sport totals | Swim, Bike, Run: done time / planned time, done distance / planned distance, "load done / ~planned" | `:147-167` |
| Strength line | "Strength: N sessions, load N" | `:168-172` |
| Day list | Monday to Sunday. Per session: name, summary, "done <time>", priority, band or state | `:174-219` |

Planned load is summed only for sessions with a workout (`:68`). A session with `sport == null` is counted in `strengthCount` (`:59-61`). `sport` is null for a program with more than one discipline or with lifts (`session-compliance.ts:129`).

Buttons and links:

| Element | Action | file:line |
|---|---|---|
| Previous week, Next week | link to `/week?w=<date>` | `:88-90`, `:94-96` |
| "How load is counted" | opens the details element | `:136-137` |
| Path B session row | link to `/planned/<id>` | `:202-205` |
| Other session row (program) | a `div`. No action. | `:206-209` |

Per training type:

| Type | Row |
|---|---|
| Strength | Name. No summary. Priority and state. Not a link. Counted in the strength line. |
| Path A run, bike, swim | Name (label, else program name). No summary, because `workoutSummary` is null without a workout (`session-compliance.ts:352`). Planned time and distance go into the sport totals from the program sets (`session-compliance.ts:131-132`). Not a link. |
| Path B | Name, one truncated summary line (`:190`), link to `/planned/<id>`. |
| Brick, path A | One row. `sport` is null, so the row counts as strength and adds nothing to the sport totals (`:59-61`). |
| Brick, path B | Two rows. No brick mark. |
| Rest day | "Rest" (`:181`). A labelled day (such as "Mobility") is not shown here; the page reads sessions only. |
| Done | "done <time>" and the band text: on plan, partly, far off plan, done (`:28`, `:191`, `:196`). |
| Missed, unanswered, sick, skipped | State text: missed, not answered, sick, skipped (`:19-27`). No answer button on this page. |

### 2.3 Calendar `/more/calendar`

Files: `src/app/more/calendar/page.tsx`, `src/components/features/CycleCalendarClient.tsx`, `src/components/features/PlannedSessionActions.tsx:29-126`.

Data (`calendar/page.tsx`): all cycles with slots (`:26`), completed session dates of the last year (`:27`), dated sessions of weekday cycles from `listPlanned` (`:60`), the programs of slots and sessions (`:76`). With the endurance switch and a dated range: `sessionCompliance`, the workouts library (`:64-67`) and the heavy-legs notes (`:72`).

Month grid (`CycleCalendarClient.tsx:273-327`): per day the number, a cycle-colour tint, a dot (full when the date has a completed workout session, `:312`) and a label of at most 6 characters from the slot label or the first word of the program name (`:286-289`). A path B session has no program name, so the cell shows its label or no text.

Day sheet (tap a day, `:295`, `:368-536`):

| Element | Content | file:line |
|---|---|---|
| Header | date, "Today" badge, "✓ Workout completed" when the date has a completed workout session | `:373-385` |
| Cycle row | cycle name and status | `:390-399` |
| Program row | link to `/programs/<id>` with name and slot label; or "No program assigned" | `:402-422` |
| Per dated session | name (only with more than one session, or skipped) | `:426-435` |
| | heavy-legs lines (endurance) | `:436-441` |
| | workout summary, band or state (endurance) | `:442-445` |
| | Yes and Missed when the state is unconfirmed (endurance) | `:446-455` |
| | "Use a workout" when the state is planned (endurance) | `:456-468` |
| | Move, Skip, Plan again, Back to the template | `:471-478` |
| Exercise list | the first session's program: exercise name and set summary (`buildRunSetSummary` for cardio, `buildSetSummary` otherwise) | `:484-500` |
| Rotation notice | "Rotation cycle — exact program depends on your completion history." | `:503-509` |
| Notes | the slot or session note | `:512-517` |
| No cycle | "Rest day" or "Unscheduled workout" | `:519-525` |

Buttons:

| Label | Action | file:line |
|---|---|---|
| Previous month, Next month | change the month in state | `:254-260` |
| Day cell | opens the day sheet | `:295` |
| Program row | link to `/programs/<id>` | `:403-416` |
| Yes | closes the day sheet and opens the answer sheet (`AnswerSheets`) | `:447-454`, `:538` |
| Missed | `updatePlannedSession({ op: "miss", id })` | `SessionAnswers.tsx:92`, `:109-110` |
| Use a workout | opens the picker; a pick calls `updatePlannedSession({ op: "set_workout", id, workoutId })` | `:236-248`, `:541-566` |
| Move <name> | shows a date input (min today, max the block's last day); Save calls `updatePlannedSession({ op: "move", id, date })` | `PlannedSessionActions.tsx:68-92`, `:103-105` |
| Skip <name> | `updatePlannedSession({ op: "skip", id })` | `PlannedSessionActions.tsx:106-108` |
| Plan <name> again | skipped and not past: `updatePlannedSession({ op: "unskip", id })` | `:95-100` |
| Back to the template | a changed day from today on: `updatePlannedSession({ op: "reset", id })` | `:111-115`; `src/lib/utils/cycle-detail.ts:73-76` |
| Close | closes the sheet | `CycleCalendarClient.tsx:528-533` |

A done session has no move or skip actions (`PlannedSessionActions.tsx:47`).

Per training type:

| Type | Day sheet |
|---|---|
| Strength | Program row, exercise list with set summaries, Move and Skip. |
| Path A | Program row, exercise list with `buildRunSetSummary`. With the endurance switch: band or state, "Use a workout", Yes and Missed when unanswered. |
| Path B | "No program assigned" (`:417-421`). The session name is the program name, else the label, else "Session" (`:426`); the workout name is not used. The summary line shows (`:444`). No exercise or step list. No link to `/planned/<id>`. No start button. |
| Brick | No brick mark. Each session lists alone. |
| Rest | "No program assigned" for a template rest slot inside a cycle; "Rest day" outside any cycle. |
| Rotation cycle | Tint only. The sheet shows the rotation notice. No dated sessions (`:152-167`). |
| Not-active weekday cycle | The template's program for the weekday. Dated sessions show only for the active cycle (`:114`, `:133-135`). |

The calendar has no start button for any session type.

### 2.4 Plan list `/cycles`

Files: `src/app/cycles/page.tsx`, `src/components/features/CyclesListClient.tsx`, `src/components/features/SeasonsSection.tsx`, `src/lib/plan-list.ts`, `src/lib/utils/plan-list.ts`.

Data: `loadPlanList(userId, enduranceEnabled)` (`cycles/page.tsx:14`), the count of deleted plans (`:16`).

| Element | Content | file:line |
|---|---|---|
| Hero card | the current or next cycle. Weekday cycle: seven days, each with a dot and a short word. Rotation: one chip per slot with Done, Next, Skipped, Swapped | `CyclesListClient.tsx:75-150` |
| Hero day word | "Rest" or the day label; "Brick" when a session of the day has a brick link; the sport word; "Multi" for a session with several sports; "Lift"; "+N" for more sessions | `src/lib/utils/plan-list.ts:186-193` |
| Hero key dot | brand colour when a session of the day is key; only with the endurance switch | `CyclesListClient.tsx:101`; `plan-list.ts:81`, `:92`; `utils/plan-list.ts:199` |
| Season cards | name, "Race in N days" or days left, phase bar, phases, the A race | `SeasonsSection.tsx:35-85` |
| Up next, Past cycles, Past seasons | rows | `CyclesListClient.tsx:415-447` |

Buttons:

| Label | Action | file:line |
|---|---|---|
| Hero card | link to `/cycles/<id>` | `CyclesListClient.tsx:77` |
| Cycle row | link to `/cycles/<id>` | `:157-159` |
| Season card, race row | link to `/seasons/<id>` | `SeasonsSection.tsx:39`, `:75` |
| Phase row | link to `/cycles/<id>` | `SeasonsSection.tsx:65` |
| + | opens a sheet: "New cycle" to `/cycles/new`, "New season" to `/seasons/new` | `CyclesListClient.tsx:49-52`, `:386-392`, `:457-463` |
| Select | select mode; Delete calls `deleteManyTrainingCycles` after a confirm | `:247-257`, `:380-382`, `:339-367` |
| Recently deleted (N) | link to `/cycles/deleted` | `:260-264` |

The hero days are not links to a session. The whole card opens the cycle.

### 2.5 Cycle detail `/cycles/[id]`

Files: `src/app/cycles/[id]/page.tsx`, `src/components/features/CycleSessionsClient.tsx`, `src/components/features/PlannedSessionActions.tsx:198-499`, `src/components/features/CycleDetailClient.tsx`, `src/components/features/CycleCompletionBanner.tsx`, `src/lib/utils/cycle-detail.ts`.

The page first calls `getActiveCycleForUser()` (`cycles/[id]/page.tsx:60`), with the same writes as home.

Data: the cycle with slots, programs, periodization (`:61-65`); the season of the cycle, sync limit warnings, the endurance switch, the dated sessions from `listPlanned` (`:81-91`). `showEndurance` is true only for an endurance user on a weekday cycle with dates that is not completed (`:113`). Then `sessionCompliance` and the workouts library load (`:116`).

Page elements:

| Element | Content | Condition | file:line |
|---|---|---|---|
| Name, sub line | length, "Same days each week" or "Rotation", week | always | `:191-192` |
| Season pill | "Phase N of M · <season>", link to `/seasons/<id>` | the cycle is a phase | `:193-204` |
| "This week breaks a training limit" | the stored warnings of this week's sync | active cycle with warnings | `:85`, `:208-217` |
| Periodization card | headline, percent, note | periodization exists, not completed | `:219-227` |
| Completion banner, "Programs in this cycle" | links to `/programs/<id>/history` | completed | `:229-246` |
| Start card | Start or scheduled start | draft | `:248-256` |
| Progress bar | weeks, "Started", "Ends" | active rotation | `:258-273` |
| Week list (`CycleWeek`) | one week at a time | weekday cycle with dates | `:275-290` |
| Template week | Monday to Sunday from the slots with a program | draft weekday cycle with no dates | `:292-304` |
| Rotation order | slots in order | rotation, not completed | `:306-320` |

`TemplateWeek` lists only slots with `programId != null` (`:298`). A workout slot is not listed there.

Week list row (`CycleSessionsClient.tsx:187-220`):

| Part | Content | file:line |
|---|---|---|
| Day column | weekday and date | `:142-151` |
| Brick icon | when `brickParentId` is set; label "Brick, linked to the ride" | `:193`; `cycles/[id]/page.tsx:144` |
| Name | label, else workout name, else program name, else "Session" | `cycles/[id]/page.tsx:133` |
| Sub line | state ("Did you do it?", Done, Skipped, Missed, "Moved from Tue", "Changed"), then the workout summary, else the first three exercise names | `src/lib/utils/cycle-detail.ts:86-103`; `cycles/[id]/page.tsx:44-49`, `:136-137` |
| Key mark | when the priority is key (endurance only) | `:199`; `cycles/[id]/page.tsx:143` |
| Rest row | "Rest" or the day's label; "Moved to <day>" when a session left the day | `:155-185` |

`key`, `brick`, `summary` and `answer` come from `sessionCompliance`, which loads only with `showEndurance` (`cycles/[id]/page.tsx:116`, `:128-146`).

Buttons on the page:

| Label | Action | file:line |
|---|---|---|
| Back | back, fallback `/cycles` | `cycles/[id]/page.tsx:185` |
| ⋯ menu | Edit details (`/cycles/<id>/edit`), Change history (`/cycles/<id>/history`), Restart cycle (`restartTrainingCycle`, after a confirm), Delete cycle (`deleteTrainingCycle`, after a confirm) | `CycleDetailClient.tsx:189`, `:202`, `:226-238` |
| Start <name> | `startTrainingCycle(cycle.id)` after a confirm | `CycleDetailClient.tsx:104`, `:137-159` |
| Previous week, Next week | change the shown week | `CycleSessionsClient.tsx:125-136` |
| Session row | opens the answer sheet when unanswered, else the session sheet. No action for a done session or a past skipped one. | `:204-219`; `cycle-detail.ts:56-61` |
| Labelled rest row | opens a sheet with the label, the note and "Edit weekly template" | `:170-180`, `:244-256` |
| Edit weekly template | link to `/cycles/<id>/template` | `:223-228` |
| Rotation row | link to `/programs/<id>` | `:353-356` |
| Rotation ⋯ | opens the rotation sheet (active cycle, coming session) | `:360-369` |
| Edit order | link to `/cycles/<id>/template` | `:329-331` |
| Completion banner | "Start" the next cycle (`startTrainingCycle`), link to the next cycle, "New cycle" (`/cycles/new`), "Not now" | `CycleCompletionBanner.tsx:58-64`, `:82`, `:99`, `:106`, `:116-117` |

Session sheet (`PlannedSessionSheet`, `PlannedSessionActions.tsx:198-499`):

| Element | Condition | Action | file:line |
|---|---|---|---|
| Kicker | always | day and state, Key mark | `:288-293` |
| Title | always | name, or "name · summary" | `:294` |
| See program › | session has a program | link to `/programs/<programId>` | `:297-301` |
| Note | session has a note | text | `:320` |
| Move to <day> | a missed key session with a suggested day | `updatePlannedSession({ op: "move", id, date, suggested: true })` | `:321-330` |
| Reason text | a missed key session with no free day | text | `:331` |
| Exercise list | today, planned, has a program | name and set summary per exercise | `:332`; `CycleSessionsClient.tsx:52-58` |
| Start workout | today, planned, `programId != null` | link to `/programs/<programId>/workout?planned=<id>` | `:333-340` |
| Move to another day | not skipped | a grid of the week's days; past days and days outside the block are closed; "Move to <day>" calls `updatePlannedSession({ op: "move", id, date })` | `:344-398` |
| Swap program | not skipped | pick list; `updatePlannedSession({ op: "change", id, programId })` | `:399-404`, `:448-457` |
| Use a workout | not skipped, library passed (endurance) | pick list; `updatePlannedSession({ op: "set_workout", id, workoutId })` | `:405-412`, `:459-468` |
| Label and note | not skipped | form; `updatePlannedSession({ op: "change", id, label, notes })` | `:413-426`, `:470-493` |
| Back to the template | a changed day from today on | `updatePlannedSession({ op: "reset", id })` | `:429-434` |
| Skip this session, Plan again | by status | `op: "skip"` or `op: "unskip"` | `:435-443` |
| Footer | always | "Only this day changes. The template stays the same." | `:313` |

Rotation sheet (`CycleSessionsClient.tsx:394-525`): exercise list, "Start workout" to `/programs/<id>/workout` when it is today's session (`:482-489`), Swap program, Back to <program>, Skip this session, Plan again. All call `updateRotationSession` (`:429`).

Per training type:

| Type | Row and sheet |
|---|---|
| Strength | Row: name and the first three exercise names. Sheet: exercise list and "Start workout" on its day; move, swap, label, skip. |
| Path A | The same as strength. The exercise list uses `buildRunSetSummary` for cardio exercises (`CycleSessionsClient.tsx:56`). With the endurance switch: Key mark, "Did you do it?" row state, "Use a workout". |
| Path B | Row: workout name and the `describeWorkout` summary on up to two lines (`:197`). Sheet title "name · summary". No "See program" link, no exercise or step list, no "Start workout" (`PlannedSessionActions.tsx:333`), no link to `/planned/<id>` (the file has none). Actions: move, swap program, use a workout, label and note, skip. |
| Brick, path B | The linked session shows a link icon. The sheet shows no brick information. |
| Brick, path A | One row for the program. |
| Rest | "Rest" row, no action. A labelled day opens the label sheet. |
| Done | Row with "Done". No action. |
| Missed | With the endurance switch a session of the last 7 days with a sport shows "Did you do it?" and opens the answer sheet. A missed key session of this week shows "Move to <day>" in the sheet (`cycles/[id]/page.tsx:122-126`). |
| Rotation cycle | No key mark, no brick, no "Did you do it?", no "Use a workout" (`showEndurance` needs a weekday cycle, `cycles/[id]/page.tsx:113`). |

### 2.6 Cycle template `/cycles/[id]/template` and the cycle forms

- `/cycles/[id]/template` (`src/app/cycles/[id]/template/page.tsx`, `src/components/features/CycleScheduleBuilder.tsx`): the weekly template or the rotation order. Each slot saves as it is set.
  - Weekday builder: per weekday a chip per session and "+" to add one. A day holds at most 3 sessions ("3 of 3", `CycleScheduleBuilder.tsx:491-492`).
  - "+" opens `ProgramPickerSheet`: search, "Rest day", the programs, "new program" by name (`createProgram`) (`:109-250`). The picker lists programs only. It has no workout list.
  - A chip opens the slot sheet (`:290-372`): "Program" with Change; "Key session" switch (endurance, `:521`); "Link to the session before (brick)" switch (endurance, and the slot before is not a rest, `:522`); "Complete automatically" with the text "For days you track on Garmin" (endurance, or already on, `:520`, `:339`); "Label and note"; Done; Remove.
  - A slot that holds a workout (set over MCP) shows its label, else the word "Workout" (`:59-62`, `:328`).
  - Rotation builder: reorder, add program, add rest, the same slot sheet without Key and brick (`:597-770`).
- `/cycles/new` (`src/app/cycles/new/page.tsx`): two steps. Step 1 makes a draft (name, schedule type, length, start). Step 2 is the same builder, and its last button starts or schedules the cycle (`:4-9`, `:94-100`).
- `/cycles/[id]/edit` (`src/app/cycles/[id]/edit/page.tsx`): "Edit details" form (`EditCycleForm`). It takes the endurance flag (`:36`).
- `/cycles/[id]/history` (`src/app/cycles/[id]/history/page.tsx`): change history with restore (`PlanHistoryPage`).
- `/cycles/deleted` (`src/app/cycles/deleted/page.tsx`): deleted cycles, phases and seasons with restore.
- `/cycles/triathlon` redirects to `/seasons/new?plan=triathlon` (`src/app/cycles/triathlon/page.tsx:8`).

### 2.7 Seasons `/seasons/[id]`

Files: `src/app/seasons/[id]/page.tsx`, `src/components/features/SeasonDetailClient.tsx`. `/seasons` redirects to `/cycles` (`src/app/seasons/page.tsx:5`).

Data: `getSeasonDetail` (season, races, the A race, phases, taper fit, the next phase, the re-plan flag) (`seasons/[id]/page.tsx:21`, `:36-66`).

Shows: name, dates, goal, next goal; a re-plan or taper banner; the A race with days left; the phase bar; the phases; the races.
A season shows no sessions. A phase opens a sheet with "Open cycle" (`/cycles/<id>`) and "Edit the week" (`/cycles/<id>/template`) (`SeasonDetailClient.tsx:657-661`).

| Button | Action | file:line |
|---|---|---|
| ⋯ menu | Edit details (`/seasons/<id>/edit`), Change history (`/seasons/<id>/history`), Delete season (`deleteSeasonAction`) | `:260`, `:490-504` |
| Fit the taper, Keep as it is | taper fix; `clearReplanAction` | `:347-352` |
| Race plan › | link to `/races/<id>/plan`. Only with the endurance switch, for an A race that is a triathlon of distance half or full | `:365-368` |
| Phase row | opens the phase sheet: phase type chips (endurance, `:664-669`), length, Save phase, Remove from season, Open cycle, Edit the week | `:412-416`, `:645-661` |
| + Add phase | link to `/seasons/<id>/phases/new` | `:422` |
| Resume, Start | starts or resumes the next phase | `:433-440` |
| Race row | opens the race sheet (Save race, Remove race). Disabled without the endurance switch | `:455`, `:545-575` |
| + Add race | endurance switch only | `:474-481` |

The Races section shows with the endurance switch, or when the season already has races (`:178`). Race writes are refused without the switch (`src/lib/seasons.ts:330`, `:443`).
`/seasons/[id]/phases/[cycleId]/week` is step 2 of "Add a phase": the same schedule builder (`src/app/seasons/[id]/phases/[cycleId]/week/page.tsx:70`).

### 2.8 Planned session `/planned/[id]`

Files: `src/app/planned/[id]/page.tsx`, `src/lib/planned-view.ts`.

Endurance switch only: without it the page redirects to `/` (`planned/[id]/page.tsx:24`). `plannedSessionView` returns null when the session has no workout, so a program session gives a 404 (`src/lib/planned-view.ts:65-70`; `planned/[id]/page.tsx:28`).

| Element | Content | Source | file:line |
|---|---|---|---|
| Kicker | date, priority, band | `oneSession` (`sessionCompliance` for the day) | `page.tsx:39-42` |
| Title | workout name | `planned_sessions.workout` | `:43-45` |
| Totals | time ("at least" when not complete, "time open" when zero), distance, "load about N" with "(estimate)" | `estimateWorkout`, `workoutPlannedLoad` with the user's thresholds | `:46-50`; `planned-view.ts:78-79` |
| Threshold warning | "Set <kinds> to see these targets in your own numbers." with a link to `/more/thresholds` | `resolveWorkout(...).missingAnchors` | `:51-58`; `planned-view.ts:80` |
| Step list | one row per expanded step: step word, round "i/n", text, target text | `plannedRows` | `:61-74`; `planned-view.ts:76` |

Buttons:

| Label | Condition | Action | file:line |
|---|---|---|---|
| Back | always | back, fallback `/week` | `:36` |
| Thresholds | a threshold is missing | link to `/more/thresholds` | `:54-56` |
| Resume, Save results | not done, a saved player run for this session | link to `/planned/<id>/play` or `/planned/<id>/results?from=player` | `:77`; `SavedRunLink.tsx:35-36` |
| Start guided | not done, bike or run | link to `/planned/<id>/play` | `:78-82` |
| Pool view | swim, done or not | link to `/planned/<id>/pool` | `:83-87` |
| Step results, Add step results, Log results by hand | always; the label depends on stored results and the done state | link to `/planned/<id>/results` | `:88-90` |

Not on this page: the session label and note, the workout description, the step note, cadence, the sport as a word, a brick link, move or skip actions, a "Did you do it?" answer, the paired Garmin activity. The page file reads none of them.

### 2.9 Workouts library `/more/workouts`

Files: `src/app/more/workouts/page.tsx`, `src/components/features/WorkoutsLibraryClient.tsx`. Endurance switch only (redirect to `/more`, `page.tsx:15`).

Data: `listWorkouts(userId)` live and deleted (`page.tsx:16`). Shows the workouts by sport (Swim, Bike, Run) with name and the one-line summary (`WorkoutsLibraryClient.tsx:64-86`).

| Button | Action | file:line |
|---|---|---|
| Workout row | opens a sheet with name and summary | `:71-82`, `:115-121` |
| Duplicate | `manageWorkout({ op: "duplicate", id })` | `:141-143` |
| Rename, Save name | `manageWorkout({ op: "rename", id, name })` | `:131-137`, `:144-146` |
| Delete workout, Delete for sure | `manageWorkout({ op: "delete", id })` | `:154-166` |
| Restore | `manageWorkout({ op: "restore", id })` | `:97-104` |

The library has no step view, no create button and no step editor. The empty state reads "No workouts yet. Ask your assistant to create workouts." (`:59-63`). The sheet has no "put on a day" action; a workout goes onto a day from the calendar or the cycle session sheet.

### 2.10 Race plan `/races/[id]/plan`

Files: `src/app/races/[id]/plan/page.tsx`, `src/components/features/nutrition/RacePlanClient.tsx`. Endurance switch only (redirect to `/more`, `page.tsx:18`).

Data: `getRacePlan(userId, raceId)` (`page.tsx:19`). Shows the race name and date; the timeline and total minutes; the swim pace; bike watts, IF range and HR ceiling; the run pace range and HR ceiling; transitions; the fuel schedule; race morning; safety lines (`page.tsx:25-46`). An unsupported distance shows a message (`:47`).

| Button | Action | file:line |
|---|---|---|
| Back | back, fallback `/seasons/<seasonId>` | `page.tsx:52` |
| Edit | opens the inputs form | `RacePlanClient.tsx:71-72` |
| Fuel every <minutes>, Save plan | `saveRacePlanAction({ raceId, expectedVersion, change })` | `:224`, `:251-269` |

### 2.11 Strength-only screens (pointers)

| Route | Purpose | file |
|---|---|---|
| `/programs` | The program list: create, rename, delete, import, export, recently deleted. Rows link to `/programs/<id>`. | `src/app/programs/page.tsx`, `src/components/features/ProgramListClient.tsx:330` |
| `/programs/[id]` | A program's exercises with set summaries, the "Last session" card, Edit, Change history. The page runs `syncActiveCyclePeriodization()` first (`src/app/programs/[id]/page.tsx:22`). It has no start button; `ProgramDetailClient.tsx` holds no `/workout` link. A path A endurance program shows here with `buildRunSetSummary` (`src/components/features/ProgramDetailClient.tsx:95-97`). | `src/components/features/ProgramDetailClient.tsx` |
| `/programs/[id]/exercises/...`, `/sets/...`, `/add-exercise` | Exercise and set editors. | `src/app/programs/[id]/**` |
| `/programs/[id]/history` | Change history with restore. | `src/app/programs/[id]/history/page.tsx` |
| `/new-workout` | Pick a program to start. With a cycle program today it shows a card with "Start" (`/programs/<id>/workout`), "Skip today" and "Different program". The list holds programs only; a workout cannot be started from here. | `src/app/new-workout/page.tsx`, `src/components/features/NewWorkoutClient.tsx:43-54`, `:72-84` |

### 2.12 Before-training facts that look like gaps

Facts only. Each is read from the code at the cited line.

Sessions with no detail or no start:

1. A program session (strength and path A) has no detail page. `plannedSessionView` returns null without a workout (`src/lib/planned-view.ts:68`). On `/week` its row is a `div` with no action (`src/app/week/page.tsx:206-209`).
2. A path B session has no "Start" on the cycle detail sheet. "Start workout" needs `programId != null` (`src/components/features/PlannedSessionActions.tsx:333`). The sheet has no link to `/planned/<id>` and no step list.
3. A path B session on the calendar reads "No program assigned" (`src/components/features/CycleCalendarClient.tsx:417-421`). The sheet has no link to `/planned/<id>`, no step list and no start. Its name there never uses the workout name (`:426`).
4. `/planned/<id>` is linked from two places only: the Endurance today card and a path B row on `/week` (`EnduranceTodayCard.tsx:34`, `week/page.tsx:203`). The Endurance today card lists today only (`src/lib/home/core.ts:54-56`). So a future path B session opens only through `/week`.
5. `/week` has no entry in the tab bar or the More menu. It is reached from the Endurance today card, the Training load widget (hidden by default) and Back from `/planned/<id>`. The Endurance today card renders nothing on a day with no path B session (`endurance-today/View.tsx:18-20`), so on such a day the default home has no link to `/week`.
6. `/programs/<id>` has no start button. The calendar's program row and "See program ›" lead there.
7. The calendar has no start button for any session.

Two cards and the rest-day text:

8. The Today hero does not list path B sessions (`src/lib/planned-sessions.ts:521`). On a day whose only session is a path B session the hero reads "Rest Day" or "No program today" with "Start a Workout →" (`src/lib/home/core.ts:191`, `today/View.tsx:99-101`, `:192-195`). Read from code, not run.
9. A path A endurance session starts the strength logger from the Today hero (`today/View.tsx:160`). A path B session starts the guided player or the pool view (`EnduranceTodayCard.tsx:47`). The same sport has two different start flows by storage path.
10. A day with a strength session and a path B session shows as one session on the Today hero and one row on the Endurance today card. "N sessions today" counts program sessions only (`today/View.tsx:100`).

Data shown on one screen and not on another:

11. The HR zone of a path A set is on no before-training screen audited here. The Today plan read does not select it (`core.ts:73-84`).
12. The Today plan counts and lists working sets only (`src/lib/home/today-plan.ts:58-67`). Warm-up sets of a path A run do not show in "N sets" or in the exercise line.
13. The workout summary is one truncated line on home and on `/week` (`EnduranceTodayCard.tsx:36`, `week/page.tsx:190`), two lines on the cycle detail (`CycleSessionsClient.tsx:197`), and full steps only on `/planned/<id>`.
14. `/planned/<id>` does not show the session label, the session note, the step note, cadence or the workout description (`src/app/planned/[id]/page.tsx:38-74`). The session note shows on the cycle sheet and the calendar sheet (`PlannedSessionActions.tsx:320`, `CycleCalendarClient.tsx:512-517`).
15. The key mark shows on the plan hero, the cycle detail rows and the template chips. `/week` and `/planned/<id>` print the priority as a word (`week/page.tsx:194`, `planned/[id]/page.tsx:40`). The Today hero, the Endurance today card and the calendar show no priority.
16. The brick link shows only as an icon on the cycle detail row and as the word "Brick" on the plan hero (`CycleSessionsClient.tsx:193`, `src/lib/utils/plan-list.ts:193`). Home, `/week`, the calendar, the session sheet and `/planned/<id>` contain no brick code.
17. The heavy-legs note shows only on the calendar day sheet (`CycleCalendarClient.tsx:436-441`).
18. The sync limit warning shows only on the cycle detail (`src/app/cycles/[id]/page.tsx:208-217`).
19. The Garmin readiness score is a home widget that is hidden by default and needs Garmin access (`src/lib/home/widgets/garmin-readiness.ts:14-15`). The low-readiness card shows only when a swap applies (`src/lib/readiness-swap.ts:49-53`). No other audited screen shows readiness.
20. Planned load shows on `/week` (sum per sport) and on `/planned/<id>`. It is computed only for sessions with a workout (`week/page.tsx:68`). A path A session has no planned load.
21. The home week strip and the calendar mark a day done from completed `workout_sessions` rows (`src/lib/home/core.ts:174-176`, `week/View.tsx:99`, `CycleCalendarClient.tsx:209`, `:312`). `sessionCompliance` can mark a session done by a Garmin activity with no logged session (`src/lib/session-compliance.ts:326-327`). `/week` and the cycle detail use `sessionCompliance`. So the same day can read done on `/week` and not done on the home strip. Read from code, not run.

Differences between sports or forms:

22. A path A brick (one program with bike and run exercises) has `sport == null` (`session-compliance.ts:129`). `/week` counts it under "Strength" and adds nothing to the Bike and Run totals (`week/page.tsx:59-61`).
23. A path B brick is two sessions. A path A brick is one. The screens show them differently (one start against two).
24. Swim opens "Pool view"; bike and run open "Start guided" (`EnduranceTodayCard.tsx:47-50`, `planned/[id]/page.tsx:78-87`). "Pool view" stays on a done swim; "Start guided" hides on a done bike or run (`planned/[id]/page.tsx:78`, `:83`).
25. A missed strength session gets "Make up" and "Decline" on home. A missed endurance session gets "Did you do these?" and, for a key session, "Move to <day>" (`Notices.tsx:30-63`, `DidYouDoIt.tsx:32-61`, `planned-sessions.ts:608`).
26. A rotation cycle gets no key mark, no brick, no "Did you do it?", no "Use a workout" and no `/week` rows. `sessionCompliance` reads weekday cycles only (`session-compliance.ts:226-228`) and `showEndurance` needs a weekday cycle (`cycles/[id]/page.tsx:113`).
27. Rest and recovery have no session type. A rest day is a day with no session. A named day (such as "Mobility") is a template slot with a label and no program or workout (`src/lib/utils/cycle-detail.ts:107-121`). It shows on the cycle detail, the plan hero and the template. `/week` shows "Rest" for it (`week/page.tsx:180-181`). Home shows "Rest Day".

Authoring limits on these screens:

28. The template builder picks programs only (`CycleScheduleBuilder.tsx:109-250`). A workout slot cannot be made in the app; it shows as its label or "Workout" (`:59-62`).
29. A draft weekday cycle with no dates lists only slots with a program (`cycles/[id]/page.tsx:298`). A workout slot is missing from that view.
30. The library has no step view and no create or edit of steps (`WorkoutsLibraryClient.tsx:18-23`).
31. "Use a workout" on a session replaces what the session runs with a library workout (`PlannedSessionActions.tsx:464`). It is offered on any planned session, a strength one included (`:405-412`).

Buttons with no write, and unused code:

32. "Skip today" on `/new-workout` only navigates to `/` (`src/components/features/NewWorkoutClient.tsx:43-48`). It writes nothing.
33. The Race countdown empty state links to `/seasons`, which redirects to `/cycles` (`widgets/race-countdown/View.tsx:24`, `src/app/seasons/page.tsx:5`).
34. `src/components/features/WeeklyGoalProgress.tsx` is imported by no file under `src/` (grep for the name returns only its own file).
35. The low-readiness card has no dismiss (`ReadinessSwapCard.tsx:8-9`).

Flags that hide things:

36. Endurance switch off: no Endurance today, Race countdown or Training load widget (unless Garmin access); `/week`, `/planned/*`, `/more/workouts` and `/races/*/plan` redirect; no Athlete profile, Workouts or Nutrition in More; no band, answers, "Use a workout" or heavy-legs lines on the calendar; no key, brick or "Did you do it?" on the cycle detail; no Key, brick or "Complete automatically" switch in the template (unless already on); no races on a season without races; no sick, return, readiness, "Did you do these?" or missed-key notices.
37. Garmin access (admin only): the Garmin readiness widget, the Garmin entry in More, the Garmin source of the training load, and the pairing of sessions to Garmin activities in `sessionCompliance` (`session-compliance.ts:233`, `:280-298`). Without it an endurance session of a past day is "not answered" until the user answers.
38. The readiness swap needs both the endurance switch and a Garmin readiness flag for today (`readiness-swap.ts:26-29`).

## 3. During

### 3.1 Strength logger (short pointer)

| Step | Route | File |
|---|---|---|
| Start with no cycle | `/new-workout` | `app/new-workout/page.tsx:15-42`, `components/features/NewWorkoutClient.tsx:44-77`, `components/features/home/StartBar.tsx:12-18` |
| Session create and restore | layout of `/programs/[id]/workout/*` | `app/programs/[id]/workout/layout.tsx:22-46`, `components/features/WorkoutSessionInitializer.tsx:117-171` |
| Exercise list | `/programs/[id]/workout` | `app/programs/[id]/workout/page.tsx:24-80`, `components/features/WorkoutSessionClient.tsx`, `WorkoutExerciseList.tsx` |
| Set list | `/programs/[id]/workout/exercises/[peId]` | `components/features/WorkoutSetsClient.tsx`, `WorkoutSetsList.tsx` |
| Set edit, new set | `.../sets/[setId]`, `.../sets/new` | `components/features/SetEditView.tsx`, `NewSetView.tsx` |
| Add exercise | `/programs/[id]/workout/add-exercise` | `components/features/WorkoutAddExerciseClient.tsx:33` |
| Finish | `/programs/[id]/workout/finish` | `app/programs/[id]/workout/finish/page.tsx` |

Facts that also apply to endurance sets in the logger:

- Opening any workout route creates a `workout_sessions` row at once (`isCompleted=false`, `programId`, optional `intendedDate` from `?makeup=`, optional `plannedSessionId` from `?planned=`). `WorkoutSessionInitializer.tsx:32-43`, `:117-136`; `lib/actions/workout-sessions.ts:51-102`.
- The active workout lives in `localStorage` (`activeWorkout`, `restTimerEnds`, `workoutOverrides`, `workoutReadiness`) for 8 hours. `contexts/workout-session-context.tsx:37`, `:100-146`.
- A readiness sheet (1 to 5) opens once per session. It writes `workout_sessions.readiness`. `WorkoutSessionClient.tsx:89-93`, `:319-326`; `contexts/workout-session-context.tsx:277-297`; `lib/actions/workout-sessions.ts:386-410`.
- A set tap writes one `workout_sets` row through `logWorkoutSet` (upsert, PR detection in the same transaction). `lib/actions/workout-sets.ts:292`, `:440-442`, `:489-507`. A second tap deletes it through `unlogWorkoutSet` (`:555`).
- Rest timer: starts from the rest item after the set, counts down every second from a stored end time, and sends a browser notification "Rest complete!". `WorkoutSetsList.tsx:541-562`, `:692-715`; `contexts/workout-session-context.tsx:153-177`; `lib/notifications.ts:26-33`.
- Exercise timer for timed sets: full-screen countdown with Cancel and Done. `WorkoutSetsList.tsx:1237-1250`, `:1784-1785`.
- Offline: set log, set un-log, program set update, plan flush and session complete go to a `localStorage` queue and replay on `online`. Backoff 5 s to 10 min, 6 attempts. `contexts/pending-queue-context.tsx:67-71`, `:237-245`; `lib/utils/pending-queue.ts:17-24`.
- Sessions left open are closed by sweeps: more than 1 hour old on the next start, more than 10 hours old on home load. `lib/actions/workout-sessions.ts:73-75`, `:226-235`.
- Header controls on the exercise list: Finished, Edit or Done, "+" (Add Exercise), dismiss of the last-session note. `WorkoutSessionClient.tsx:158-193`, `:227-233`, `:302-313`, `:335-349`.

### 3.2 Endurance sets inside the strength logger (path A)

Route and files are those of 3.1. An exercise is "running" when its name is "Running" or it has a discipline (`app/programs/[id]/workout/page.tsx:66`). The same flag is used for bike and swim.

| Control | Where | On tap | Saved |
|---|---|---|---|
| Exercise circle on the list | `WorkoutExerciseList.tsx:296-302` | Nothing. For a running exercise it is a `div`, not a button. | Nothing |
| Exercise row | `WorkoutExerciseList.tsx:329-340` | Opens the set list. The summary is `buildRunSetSummary`. (`:128-129`) | Nothing |
| Set toggle (not logged) | `WorkoutSetsList.tsx:1782-1783` | Opens `LogRunModal` | Nothing yet |
| Set toggle (logged) | `WorkoutSetsList.tsx:1786-1788`, `:502-519` | Un-logs the set | Deletes the `workout_sets` row |
| Set row | `WorkoutSetsList.tsx:1737-1740` | Opens the set edit page | Nothing |
| HR zone badge "Z1" to "Z5" | `WorkoutSetsList.tsx:1877-1885` | Display only | Nothing |

`LogRunModal` (`components/features/LogRunModal.tsx`):

| Field | Default | Line |
|---|---|---|
| Distance (presets and a text field, unit by discipline) | The planned distance, else 1500 m swim, 40 km bike, 5 km run | `:55-57`, `lib/utils/discipline.ts:62`, `:79`, `:95` |
| Duration (minutes and seconds) | The planned duration, else 0 | `:58-60` |
| Incline | The planned incline. Shown for run only (`showIncline`) | `:62`, `lib/utils/discipline.ts:64`, `:81`, `:97` |
| HR zone Z1 to Z5, tap again to clear | The planned zone | `:64`, `:277` |
| Effort (RPE) 6, 7, 8, 9, 10 | 7, always | `:10`, `:60`, `:297-312` |
| Cancel | Closes | `:112` |
| Confirm | Calls `confirmRunLog` | `:102`, `:320` |

- The title is "Log Interval N of M" when the exercise has more than one set, else "Log Run", "Log Ride" or the swim verb. `LogRunModal.tsx:98-100`.
- `confirmRunLog` writes one `workout_sets` row: `actualReps=0`, `weightKg=0`, `distanceMeters`, `durationSeconds` (only when above 0), `inclinePercent`, `heartRateZone`, `rpe`, `restTimeSeconds`, `isCompleted=true`. It then starts the rest timer of the next rest item. `WorkoutSetsList.tsx:642-687`.
- There is no power, pace target, cadence or bpm field in the modal or on the set. `LogRunModal.tsx:20-31`.
- RPE options start at 6. A value of 1 to 5 cannot be entered here. `LogRunModal.tsx:10`.
- The set edit page for a running set has a Distance or Time mode, duration, incline and a target HR zone. In a workout it stores a session override and re-logs the set. `SetEditView.tsx:327-354`, `:480-492`, `:649`.
- `toggleExercise` holds a branch that logs every running set with its planned distance and duration and no RPE (`WorkoutExerciseList.tsx:70-83`). The UI gives no control that reaches it for a running exercise (`:296-302`).
- Long-press (the miss sheet) is off for running sets. `WorkoutSetsList.tsx:1745-1746`.
- Finish is the same screen as strength: Feeling (4 choices, default "Good"), Notes, Save, Discard. `app/programs/[id]/workout/finish/page.tsx:54`, `:217-230`, `:251-271`.

What differs per type on path A: only the unit, the default distance, the presets, the pace format and the incline field (`lib/utils/discipline.ts:56-106`). Bike and swim have no field that run lacks.

### 3.3 autoComplete days

- A cycle slot can have `autoComplete`. For a weekday cycle, `weekdayToday` writes a completed `workout_sessions` row with `source='auto'`, no sets, start and end at 12:00, for each due session. `lib/planned-sessions.ts:504`, `:554-562`; `lib/auto-sessions.ts:17-39`. Rotation cycles do the same in `getActiveCycleForUser` (`lib/actions/training-cycles.ts:267-286`).
- With the endurance switch on, a session whose program holds any endurance sport is left out of auto-complete. It goes to Garmin pairing or "Did you do it?". `lib/planned-sessions.ts:542-557`.
- So auto-complete applies to: strength-only programs with the flag, and every flagged program for a user with the endurance switch off.
- "I skipped it" (`SkipAutoDayButton`) deletes the auto row through `skipAutoCompletedDay`. It shows on home. `components/features/SkipAutoDayButton.tsx:16-34`; used in `components/features/home/widgets/today/View.tsx:182`, `TodayMore.tsx:36`, `TodaySessionsList.tsx:27`.
- Finishing a real workout of the same program and day, or of the same planned session, deletes the auto row. `lib/actions/workout-sessions.ts:176-193`.
- MCP `confirm_session` can also write an auto row (`lib/mcp/tools/sessions.ts:225`, `:262`).

### 3.4 Guided player (path B, bike and run; also the swim send-off clock)

Route `/planned/[id]/play`. Files: `app/planned/[id]/play/page.tsx`, `components/features/guided/GuidedPlayer.tsx`, `useGuidedPlayer.ts`, `lib/utils/workout-player.ts`, `lib/audio-cues.ts`, `lib/wake-lock.ts`. The page redirects to `/` when the endurance switch is off (`play/page.tsx:14`). It 404s for a session with a program and no workout (`lib/planned-view.ts:68`).

Ready screen:

| Control | On tap | Line |
|---|---|---|
| "Save its results" | Opens `/planned/<other id>/results?from=player`. Shows when a finished run of another session or an older workout version is in `localStorage`. | `GuidedPlayer.tsx:63-77` |
| "Discard it", then "Keep it" or "Discard the run" | Removes the saved run from `localStorage` | `:78-99`, `useGuidedPlayer.ts:291-293` |
| "Test sound" | Unlocks audio | `:112-118` |
| "Start" | Starts step 1. Disabled while an unsaved run blocks it. | `:119-126`, `useGuidedPlayer.ts:234-241` |

Running screen:

| Control | On tap | Line |
|---|---|---|
| "Leave", then "Stay" or "Leave" | Goes to `/planned/[id]`. The run keeps its time. | `:146-148`, `:191-209` |
| "Tap to turn sound back on" | Unlocks audio again | `:151-155` |
| "N steps passed while the app was closed" | Dismisses the notice | `:161-165` |
| "Pause" or "Resume" | Pauses or resumes the step clock | `:216-224` |
| "Lap" | Ends a step that has no planned seconds. Shown in place of "+30 s". | `:225-228` |
| "+30 s" | Extends the step by 30 s. Limits: 600 s per tap, 3600 s per step. | `:229-233`, `lib/utils/workout-player.ts:115-116` |
| "Skip" | Marks the step skipped and moves on | `:234-236` |
| "Finish", then "Stay" or "Finish" | Ends the run. The remaining steps count as not done. Opens the results page. | `:237-239`, `:194`, `:35` |

Display: step count, step type, round, a large clock (remaining, or elapsed for a lap step), the step text, one target text, the step note, and the next step. `GuidedPlayer.tsx:142-189`. One target only (`:182-186`).

Other facts:

- The clock ticks every 250 ms. A beep plays at 3, 2 and 1 seconds, and a different tone at each step change. `useGuidedPlayer.ts:35`, `:178-191`; `lib/audio-cues.ts:51-55`.
- A distance step has no planned seconds. It waits for Lap. The screen says "tap Lap when done". `GuidedPlayer.tsx:175-177`; `components/features/guided/types.ts:11`.
- The screen wake lock is asked for. When refused, a hint tells the user to set Auto-Lock to Never. `GuidedPlayer.tsx:156-160`; `lib/wake-lock.ts:17-24`.
- The ready screen states: "cues stop when the phone locks. The time goes on." `GuidedPlayer.tsx:108`.
- The run is saved only in `localStorage` key `guidedWorkout`. An unfinished run expires after 24 hours. A finished run never expires. `lib/utils/workout-player.ts:247-249`, `:285-288`.
- The player writes nothing to the database. The server is called first on the results page. `app/planned/[id]/play/page.tsx:8-10`; `GuidedPlayer.tsx:35`.
- The player needs no network after the page load (`play/page.tsx:8-10`).
- At most 400 play steps (`lib/utils/workout-player.ts:25`).
- The player records time per step only. It reads no power, HR, pace or distance. `lib/utils/workout-player.ts:75`.

### 3.5 Pool view (path B, swim)

Route `/planned/[id]/pool`. Files: `app/planned/[id]/pool/page.tsx`, `components/features/guided/PoolList.tsx`. Redirects to `/` when the endurance switch is off (`pool/page.tsx:17`).

| Control | On tap | Line |
|---|---|---|
| "Back" | Link to `/planned/[id]` (a plain link, not `BackLink`) | `PoolList.tsx:34-36` |
| The whole block area | Next block. On the last block it does nothing. | `:41-46` |
| "Previous" | Previous block. Disabled on the first block. | `:66-73` |
| "Start send-off clock" | Opens `/planned/[id]/play` | `:74-79` |

- One block per top-level step or repeat. It shows the block text, each target, equipment and notes in large type. `pool/page.tsx:24-33`; `PoolList.tsx:47-63`.
- The header shows the pool length or "Open water". `PoolList.tsx:30`.
- The pool view saves nothing and holds no state across a reload (`PoolList.tsx:28`).
- The pool view has no link to the results page and no "done" control. `PoolList.tsx:32-81`.
- In the player, a swim rep with a send-off counts down "to the next send-off", and rounds read "Rep". `GuidedPlayer.tsx:170`, `:178`.
- The home card sends a swim to the pool view and bike or run to the player. `components/features/guided/EnduranceTodayCard.tsx:47-50`. The detail page hides "Start guided" for swim. `app/planned/[id]/page.tsx:78-87`.

### 3.6 Other timers

No other timer exists in the scope. The elapsed clock on the exercise list is display only (`WorkoutSessionClient.tsx:99-109`, `:199`).

### 3.7 A session recorded only on the Garmin watch

| Session type | Screens that need input during the session | What the app has when the user stops the watch |
|---|---|---|
| Path B workout (bike, run, swim) | None. The player and pool view are optional. | Nothing until the Garmin sync runs (4.5) |
| Path A endurance program, endurance switch on | None, if the user does not open the logger | Nothing until the Garmin sync runs. Auto-complete is off for it (`lib/planned-sessions.ts:542-557`). |
| Path A endurance program, endurance switch off | None when the slot has `autoComplete` | An auto row for the day (3.3) |
| Strength | The logger. A Garmin strength activity does not clear a planned strength session (4.5). | The logged sets |

If the user opens a path A workout route to read the plan, a `workout_sessions` row is created (3.1). A later sweep closes it as completed with no sets (`lib/actions/workout-sessions.ts:73-75`, `:226-235`; `lib/ghost-sessions.ts:1-16`).

## 4. After

### 4.1 Finish screen (logger only)

Route `/programs/[id]/workout/finish` (`app/programs/[id]/workout/finish/page.tsx`).

| Control | On tap | Saved |
|---|---|---|
| Feeling: 4 buttons from `WORKOUT_FEELINGS` (Tired, OK, Good, Awesome), default Good | Selects | `workout_sessions.feeling` on save (`:54`, `:217-230`) |
| Notes, max 1000 | Text | `workout_sessions.notes` (`:238-245`) |
| "Save Workout", then "Yes, save" | `flushWorkoutPlan` (set overrides back to the program), then `completeWorkoutSession` | `endTime`, `notes`, `feeling`, `isCompleted=true`; deletes a matching auto row; then goes to `/` (`:60-147`; `lib/actions/workout-sessions.ts:148-205`) |
| "Discard Workout", then "Yes, discard" | `deleteWorkoutSession` | Deletes the session and its sets, rebuilds PRs (`:161-182`; `lib/actions/workout-sets.ts:849-898`) |

- Offline: the save is queued when the session already exists. With no session id it refuses. `finish/page.tsx:77-94`.
- The screen asks no RPE, no distance and no duration. The duration is end minus start. `finish/page.tsx:49-52`.
- The path B flows never reach this screen. Their end is the results page (4.6).

### 4.2 "Did you do it?"

Shown only with the endurance switch on (`components/features/DidYouDoIt.tsx:7-8`; `app/more/calendar/page.tsx:64-70`).

When a session is "unconfirmed" (`lib/utils/session-compliance.ts:425-449`): the endurance switch is on, the session has a sport (a mixed one counts, `lib/session-compliance.ts:317-318`), its date is before today and at most 7 days back (`PROMPT_DAYS`, `:419`), the status is still `planned`, and no link, pick, app match or Garmin match exists. Older than 7 days it becomes "missed". A session without a sport (strength) goes straight to "missed" with no prompt (`:444-447`).

Where it shows:

| Screen | Component | Line |
|---|---|---|
| Home notice "Did you do these?" | `DidYouDoItCard` | `components/features/DidYouDoIt.tsx:23-66`; `components/features/home/Notices.tsx:77`; data from `homeEndurance` (`lib/session-answers.ts:138-151`) |
| Calendar day sheet | `AnswerButtons` under the band label | `components/features/CycleCalendarClient.tsx:445-456`, `:538` |
| Cycle detail row | `DidYouDoItSheet` | `components/features/CycleSessionsClient.tsx:257`; `components/features/SessionAnswers.tsx:328-446` |

Choices:

| Choice | Form | Writes |
|---|---|---|
| "Yes" | Sheet: Time (required, minutes or h:mm), Distance (optional, m for swim, km else), RPE 1 to 10 (optional), Notes, "I was sick", Save | `confirmPlannedDone` → `confirmDone`: one completed `workout_sessions` row on the session's date, start 12:00 in the user's zone, `plannedSessionId` set, `programId` of the session, `source='app'`, with one `workout_sets` row on the sport's built-in exercise holding `durationSeconds`, `distanceMeters`, `rpe`. `components/features/SessionAnswers.tsx:199-225`, `:254-302`; `lib/actions/workouts-compliance.ts:32-50`; `lib/session-answers.ts:54-87` |
| "Missed" | None | `updatePlannedSession({op:"miss"})`: `planned_sessions.status='missed'`, `missedReason` (the app sends none), `statusOn=today`. `components/features/SessionAnswers.tsx:88-100`, `:344`; `lib/planned-sessions.ts:1051-1054` |
| "I was sick" | Opens the sick-period sheet with the session's day as the first day | `manageIllness` (`components/features/IllnessSheet.tsx:60`) |

- The "Yes" time field is filled with the planned time (`components/features/answer-session.ts:10`, `:18`).
- `confirmDone` refuses a future day, a done session, a skipped session and a strength session ("Log a strength session in the app or with log_session."). `lib/session-answers.ts:58-63`.
- A mixed session (path A brick, or bike and swim) logs all its time on its first sport. `lib/session-answers.ts:61-62`.
- A missed key session of this week gets a "Move to <day>" button on home. It writes `op:"move"` with `suggested:true`, which the server checks again. `components/features/DidYouDoIt.tsx:73-100`; `lib/session-answers.ts:109-127`; rule in `lib/utils/session-compliance.ts:277-300`.
- The app has no control for `unmiss`, for a Garmin `pick`, or for a brick link. The validator states they are MCP only. `lib/validators/planned-sessions.ts:32-35`.

### 4.3 RPE

| Where asked | Scale | Required | Stored | Line |
|---|---|---|---|---|
| `LogRunModal` (path A set) | 6 to 10, default 7 | Always sent | `workout_sets.rpe` | `components/features/LogRunModal.tsx:10`, `:60`; `WorkoutSetsList.tsx:683` |
| Strength set | RIR 0 to 5+, RPE derived as 10 minus RIR | Optional | `workout_sets.rir`, `rpe` | `SetEditView.tsx:827-848`; `lib/actions/workout-sets.ts:331-333` |
| "Yes, I did it" sheet | 1 to 10 | Optional | `workout_sets.rpe` of the one set | `components/features/SessionAnswers.tsx:263-273` |
| Results page, session RPE | 1 to 10 | Optional. Text: "Without RPE this session may have no load." | `workout_sets.rpe` of the session's set | `components/features/guided/StepResultsForm.tsx:142-156`; `lib/step-results.ts:157`, `:169`, `:206` |
| Results page, per work step | 1 to 10 | Optional | `workout_step_results.steps[].rpe` | `StepResultsForm.tsx:223-234` |
| Garmin watch RPE and feel | Garmin's `directWorkoutRpe`, `directWorkoutFeel` | From the watch | Inside the stored activity JSON | Shown as the tile "How it felt" only (`lib/garmin/charts/activity.ts:116-118`). No other code reads `directWorkoutRpe`. |
| Finish screen | Feeling, 4 words. No RPE. | Default Good | `workout_sessions.feeling` | `app/programs/[id]/workout/finish/page.tsx:54` |

Where RPE is shown: history session detail per set as "RIR n" or "RPE n" (`components/features/SessionDetailClient.tsx:274-277`); the results form on reopen (`app/planned/[id]/results/page.tsx:19`). Where it is used: app load (4.8).

### 4.4 Step results

Route `/planned/[id]/results` (`app/planned/[id]/results/page.tsx`, `components/features/guided/StepResultsForm.tsx`). Redirects to `/` with the endurance switch off (`results/page.tsx:12`). Only for sessions with a structured workout (`lib/step-results.ts:83-84`).

Ways in: "Step results", "Add step results" or "Log results by hand" on `/planned/[id]` (`app/planned/[id]/page.tsx:88-90`); "Results" on the home card for a done session (`EnduranceTodayCard.tsx:39-42`); "Save results" for a finished run on this phone (`SavedRunLink.tsx:35-36`); the player's Finish (`GuidedPlayer.tsx:30-35`).

Sources (`workout_step_results.source`):

| Source | How the form is filled | Line |
|---|---|---|
| `player` | From the finished run in `localStorage`: per step status and active seconds | `StepResultsForm.tsx:54-71`, `:98`; `lib/utils/step-results.ts:117-124` (`resultsFromRun`) |
| `manual` | Every step "done" with its planned time and distance | `StepResultsForm.tsx:44`; `lib/utils/step-results.ts:127-134` (`resultsAsPlanned`) |
| `assistant` | MCP `log_step_results`, same server path | `lib/step-results.ts:2-4`, `:88` |
| Garmin | None. No code makes step results from Garmin laps or streams. | `lib/step-results.ts:88`; BACKLOG item named in the endurance brief 5 |

Form:

| Field | Notes | Line |
|---|---|---|
| Session RPE 1 to 10 | Tap again to clear | `:143-155` |
| Distance, optional | m for swim, km else | `:159-168` |
| Per step: status select | Done, Part, Skipped, Not done | `:23`, `:192-203` |
| Per work step: "Add a value or note" | Average value only when the target unit is W, bpm or rpm; RPE; Note (280) | `:175`, `:205-245` |
| Save / Retry / "Save as one session" | `saveStepResultsAction` | `:87-118`, `:262-269` |

- A step with a pace target has no field for a measured value (`StepResultsForm.tsx:175`).
- Only work steps can take a value, an RPE or a note (`:205`).
- The form has no field to change a step's time or distance. A hand entry keeps the planned time for every step that stays "done". `StepResultsForm.tsx:192-245`; `lib/utils/step-results.ts:127-134`.
- The comparison per step (`compareStep`, `lib/utils/step-results.ts:104-114`): band from done time over planned time, else distance, with the session band thresholds (4.6). "skipped" and "not_done" give red. A measured value against the target bounds gives "in range", "below" or "above". The band and hit show in the form line (`StepResultsForm.tsx:185-190`).
- Save: when a completed app or assistant session is already linked to the planned session, the results attach to it. Otherwise a new completed `workout_sessions` row is written (`source='app'`, `plannedSessionId`, one set with duration, distance and RPE) with the results row (`wroteSession=true`). `lib/step-results.ts:116-216`.
- Date of the new session: the start day for a player run; the planned day, or today when the planned day is in the future, for a hand entry. `lib/step-results.ts:185-187`.
- The results row stores a copy of the workout and of the thresholds at save time (`lib/step-results.ts:103-114`).
- A repeated `clientKey` returns the first save (`:89-95`).
- A failed save keeps the form and retries when the phone is online again, for a player run only (`StepResultsForm.tsx:120-126`).
- After save the user returns to `/planned/[id]` (`:117`).
- The detail page `/planned/[id]` does not render the saved results. It uses `v.results` only for the button label. `app/planned/[id]/page.tsx:61-74`, `:89`.
- The actual load of the logged session is computed in `getStepResults` (`lib/step-results.ts:257`, `:269`). No file under `app/planned` or `components/features/guided` reads it. MCP reads it (`lib/mcp/tools/endurance-app.ts`).

### 4.5 Garmin pairing (`pairGarmin`)

Where: `sessionCompliance` in `lib/session-compliance.ts:230-372`, rule in `lib/utils/session-compliance.ts:397-416`.

When it runs: on every read. Nothing is stored for an automatic pair. Each caller of `sessionCompliance` computes it again (the header lists home, calendar, MCP and the weekly sync, `lib/session-compliance.ts:5-6`; also `/week`, `/planned/[id]` through `oneSession`, `lib/session-answers.ts:36-45`).

Conditions:

- The endurance switch and Garmin access are both on. `lib/session-compliance.ts:232-233`, `:290`.
- Only weekday cycles with dated sessions (`:227-228`).
- Session side (`:293`): has a single sport (`v.sport` not null), status `planned`, no app match, no linked workout, no stored pick, and date today or earlier.
- Activity side: `garmin_activities` rows of the user in the range, up to today (`:263`, `:280`). The day is the date part of `startTimeLocal` (`:222`). The sport comes from `sportOf(activityType)` (`:222`).
- Activities already used are left out: a stored pick, and one activity per logged app workout of the same sport and day (`:281-289`, `:296`).

Sport mapping (`lib/garmin/analytics/sport.ts:8-15`): a type key that contains "swim" is swim; "cycling", "biking", "bike" or `virtual_ride` is bike; "running", `run`, "trail" or "track_running" is run; "strength" is strength; all else is other.

Matching rule (`lib/utils/session-compliance.ts:397-416`):

- Same sport and same day. There is no time-of-day window and no tolerance in days.
- Sessions are taken in order of date, then position, then id.
- With several activities, the one with the smallest gap wins: the absolute log of done over planned duration, else of distance, else 0. Ties go to the lower id.
- Each activity is used once.
- There is no minimum duration and no maximum gap. Any activity of the sport on the day pairs.

What it gives: state "done", `matchedBy='garmin'`, `garminActivityId`, `done` = the activity's `duration` and `distance` from its summary JSON, then the ratio and band. `lib/session-compliance.ts:313-336`, `:222`.

What is written: nothing. `planned_sessions.garminActivityId` is written only by the `pick` operation (`lib/planned-sessions.ts:1060-1079`).

Manual pair and unpair:

- `pick` sets `planned_sessions.garminActivityId` and resets a missed status. It refuses an activity another live session already holds (`lib/planned-sessions.ts:1060-1079`). It is reachable through MCP only (`lib/mcp/tools/workouts-compliance.ts:187`, `:206`; `lib/validators/planned-sessions.ts:33`).
- A pick wins over the status and over auto pairing (`lib/utils/session-compliance.ts:437-438`).
- No operation named unpick exists in the operation list (`lib/planned-sessions.ts:797`). The `reset` case (`:1139-1166`) does not set `garminActivityId`.
- The app has no screen that shows which Garmin activity a session was paired with. No file under `components/` or `app/` reads `garminActivityId`, `matchedBy` or `loggedSessionId` of a session. MCP returns `matchedBy` (`lib/mcp/tools/planned-sessions.ts:90`).

How the activity arrives:

- The background worker ticks every 60 s and pulls recent summaries when the last sync is older than 30 minutes. `lib/garmin/worker.ts:40-42`, `:120`.
- FIT files, laps and streams are fetched after the summary (`lib/garmin/sync.ts:140-141`, `:177-200`). Pairing needs the summary only (`lib/session-compliance.ts:207-223`).
- The refresh button on `/more/garmin` forces a sync. It revalidates `/more/garmin` only. `components/features/garmin/GarminShell.tsx:48-56`; `lib/actions/garmin.ts:38-61`.
- No refresh control exists on home, `/week` or `/planned/[id]` (`EnduranceTodayCard.tsx`, `app/planned/[id]/page.tsx`).

Not paired by this rule:

- A session with more than one sport or with a sport plus lifts (`sport` null). A path A brick program (bike and run in one program) is such a session. `lib/session-compliance.ts:129`, `:293`. It becomes "unconfirmed" and waits for "Did you do it?" (`:317-318`).
- A strength session. A Garmin strength activity is matched to a logged app strength session for load only, by 50 % time overlap (`lib/garmin/analytics/daily.ts:27`, `:100-117`).
- Rotation cycles (`lib/session-compliance.ts:227-228`).
- A user without admin role (`lib/garmin/access.ts:15-17`).

A second, separate pairing exists for load: `pairWithGarmin` pairs app endurance sessions with Garmin activities by sport, local date and closest duration, so the app session adds no load. `lib/utils/training-load.ts:200-218`; `lib/garmin/analytics/daily.ts:156-172`.

### 4.6 State and compliance bands

State, first match wins (`lib/utils/session-compliance.ts:425-449`): linked workout → done; pick → done; status skipped → skipped; status missed → missed; app match → done; Garmin match → done; inside a sick period → illness (past) or sick (today or later); past day → unconfirmed (sport, 7 days) or missed; else planned.

App match (`matchEndurance`, `lib/utils/session-compliance.ts:330-387`): a workout linked to the session; else a workout of the same program on the day; else a workout with a set of the session's discipline on the day. A workout with sets of two disciplines can clear one session of each.

Ratio (`complianceRatio`, `:23-32`): done over planned by duration; else by distance; else none. Power, pace and HR are not in the ratio.

Band (`complianceBand`, `:42-54`), on the ratio rounded to a whole percent:

| Band | Rule | Text on screen |
|---|---|---|
| green | 80 to 120 % | "On plan" |
| yellow | 50 to 79 % or 121 to 150 % | "Partly" |
| orange | under 50 % or over 150 % | "Far off plan" |
| red | state missed | "Missed" |
| done | done with no ratio | "Done" |
| illness | past day inside a sick period | "Sick" |

Text from `app/planned/[id]/page.tsx:15`. Planned amount: for a workout, the estimate when it is complete; for a program, the sum of the endurance sets when the program has one sport, else none (`lib/session-compliance.ts:129-132`, `:247-250`).

Where the band shows: `/planned/[id]` header (`app/planned/[id]/page.tsx:39-42`); `/week` session rows (`app/week/page.tsx:196`); calendar day sheet (`components/features/CycleCalendarClient.tsx:445`); MCP. All behind the endurance switch (`app/more/calendar/page.tsx:64-70`).

Consistency: share of the last 12 full weeks with at least 80 % of counted sessions done (`lib/utils/session-compliance.ts:93-95`, `:117`).

### 4.7 Training load

App formulas (`lib/utils/training-load.ts`), scale 100 = one hour at threshold (`:4-5`):

| Sport | Method | Inputs | Line |
|---|---|---|---|
| Run | hours × IF² × 100, IF = speed over threshold speed | Logged duration and distance, threshold pace. Not used with an incline, under 400 m or under 300 s. | `:34`, `:55-65` |
| Swim | hours × IF³ × 100, IF = speed over CSS | Duration (moving time from step results when complete), distance, CSS | `:35`, `:68-74`; `lib/training-load.ts:72-83` |
| Bike | minutes × RPE × 0.22 only | Duration and RPE. No power method in the app path. | `:29`, `:96-110` |
| Any, fallback | minutes × RPE × 0.22 | Needs RPE, else no load (`needs_rpe`) | `:109-110` |
| Strength | Session RPE from working-set RPE and feeling, wall time minus endurance time, max 180 min | `lib/training-load.ts:28`, `:113-119` |

- Auto rows have no load (`lib/training-load.ts:37`, `:44`).
- Planned load of a workout: per step, hours × IF^n × 100 with IF from the target or a default per step type (`lib/utils/training-load.ts:115-122`, `:171-187`).
- One source per user: with Garmin access and Garmin daily metrics, the series is the Garmin one (which adds unpaired app sessions). Otherwise the app series. Never both. `lib/training-load.ts:149-179`; `lib/utils/training-load.ts:221`.
- Garmin activity load method is power or HR (TRIMP), shown as the tile "App load" (`lib/garmin/charts/activity.ts:100`).

Where load shows:

| Screen | What | Line |
|---|---|---|
| `/week` load card | Fitness, fatigue, form, per-sport done load against planned load, sessions with no load, "How load is counted" | `app/week/page.tsx:99-170` |
| `/planned/[id]` | "load about N" (planned only) | `app/planned/[id]/page.tsx:49` |
| Home widget "training load" | Form label, ramp | `components/features/home/widgets/training-load/load.ts:37` |
| `/more/garmin` Overview and Training tabs | CTL, ATL, TSB, ramp, per sport fitness | `components/features/GarminLoadTab.tsx:180-238`; `GarminOverviewTab.tsx:207-220` |
| Garmin activity page | Tiles "App load", "Garmin load" | `lib/garmin/charts/activity.ts:100-102` |

### 4.8 History

`/history` (`app/history/page.tsx`, `components/features/HistoryClient.tsx`): every completed `workout_sessions` row, newest first (`lib/actions/workout-sets.ts:968-1053`). One search field filters by program or exercise (`HistoryClient.tsx:40-44`). Each row links to `/history/[id]` (`:67`).

| Row type | What the list shows | Line |
|---|---|---|
| Logged in the app | Duration, set count, exercise count, total kg when above 0 | `HistoryClient.tsx:83-110` |
| Auto row | "Done · automatic", no duration | `:90-92`; `lib/actions/workout-sets.ts:1040-1041` |
| No sets | "No sets tracked" | `:94-97` |
| Logged by MCP | "By your assistant" | `:111-113` |
| "Yes, I did it" or results save | An app session with 1 set on the sport's built-in exercise | `lib/session-answers.ts:68-85`; `lib/step-results.ts:190-209` |
| Garmin-only activity | Not in the list. The list reads `workout_sessions` only. | `lib/actions/workout-sets.ts:993-997` |

`/history/[sessionId]` (`components/features/SessionDetailClient.tsx`):

- Header: date, program name, "logged by your assistant", feeling pill, notes (`:142`, `:160-164`, `:200-201`).
- Sets by exercise. An endurance set shows distance, duration, and "% incline" and "Z n" when set (`:250-254`). Effort shows as "RIR n" or "RPE n" (`:274-277`). Set note (`:282-284`).
- Edit: date and notes of the session through `updateWorkoutSession` (`:91-92`); a set through `updateLoggedSet` with weight, reps, failed flag and note (`:404-405`). For a run set only the flag and note change (`:357`).
- Delete with a confirm (`:128-129`, `:333`). Not editable for an auto row (`:54`).
- The page shows no link to the planned session, no step results, no band, no load, no readiness and no Garmin activity. The query returns `plannedSessionId` and `readiness` (`lib/actions/workout-sets.ts:1071-1073`); the component does not read them.

### 4.9 Metrics, PRs, exercise history (short pointer)

- `/more/metrics` (`app/more/metrics/page.tsx:28-112`, `components/features/MetricsClient.tsx`): tabs All time, Records, Cycle (`app/more/metrics/page.tsx:70-71`). Cardio and triathlon sections read `workout_sets` joined to `workout_sessions` (`lib/actions/metrics.ts:684-700`, `:862-880`). `lib/actions/metrics.ts` has no Garmin read. A Garmin-only session adds nothing here.
- PRs: detected on each set log, strength and endurance (distance and pace per bracket). `lib/actions/workout-sets.ts:489-507`; brackets in `lib/utils/discipline.ts:66-103`. Feed in `components/features/PrFeedList.tsx`; `/more/prs` redirects to the Records tab.
- Exercise history: `/exercises/[id]` (`components/features/ExerciseDetailClient.tsx`), linked from the set list title (`WorkoutSetsClient.tsx:836`).

### 4.10 Garmin pages

All need Garmin access; else 404 (`app/more/garmin/page.tsx:28`). Shell: back link, refresh button with the last sync time, "Stored data" icon, six pill tabs (`components/features/garmin/GarminShell.tsx:48-56`, `:93-114`; `components/features/garmin/tabs.ts:3`).

| Tab | Data shown | Controls |
|---|---|---|
| Overview | Readiness with a 7-day strip, top insight, intensity minutes, fitness/fatigue/form, last session, this week against the plan, race demands, race strip | Each block is a link to a tab, the activity, `/cycles` or the race page (`GarminOverviewTab.tsx:59-70`, `:97-123`, `:162-278`) |
| Day | Readiness (signals out of 6), heart rate day and night, HRV through the night, last 7 days, the day, body battery, insights | Previous day, next day, back to latest, "show all" insights (`GarminTodayTab.tsx:73-88`, `:102-134`, `:153-362`) |
| Training | CTL, ATL, TSB, ramp; fitness per sport; this week done against plan; long-session ladder; race demands; intensity distribution; "Plan suggestion" | Range and sport chips, unit toggle, "Apply N % to this week" (`applyWearablePlanSuggestion`), link to the race page (`GarminLoadTab.tsx:66-84`, `:157-168`, `:180-332`) |
| Recovery | Load and recovery 90 days, what moves HRV, sleep timing, sleep against need, stages, HRV 90 days, resting HR, stress | None beyond chart selection (`GarminSleepTab.tsx:117-231`) |
| Activities | List: sport, name, PR badge, date, duration, distance, average HR, HR sparkline | Sport filter chips, clear day, row link to the activity (`GarminActivitiesTab.tsx:43-60`, `:149-166`) |
| Trends | FTP estimate, critical speed, LTHR, VO2 max; power curve; run pace curve; thresholds over time; efficiency and decoupling; weight and W/kg; fitness age | Sport toggle, link to an activity (`GarminTrendsTab.tsx:107`, `:183-322`) |
| Stored data (`?tab=data`) | Raw stored day and activity JSON | Day stepper, expand rows (`GarminDataExplorer.tsx:92-199`) |

Activity detail `/more/garmin/activity/[id]` (`components/features/GarminActivityView.tsx`):

- Header with sport, date, name and a one-line verdict (`:260-267`). Stat tiles: app load, Garmin load, training effect, primary benefit, stamina, body battery, recovery HR, breathing, temperature, "How it felt" (watch feel and RPE), "Workout compliance" (Garmin's own `directWorkoutComplianceScore`), calories (`lib/garmin/charts/activity.ts:100-122`).
- Cards: fastest splits, streams with a selection tool, route by HR zone, HR zones, power zones, aerobic decoupling (`:184`, `:285-328`).
- "Fuel and fluid" form for swim, bike or run above a minimum duration. Saves a `fuel_logs` row through `saveFuelLogAction` (`:86-101`, `:356`).
- Laps table: number, time, distance, HR, and pace (run), power (bike) or speed. A lap tap selects its span on the charts (`:358-389`).
- "Sets on the watch" for strength, with "Open the LogEveryLift session" when a strength session matched by overlap (`:393-404`).
- The page has no link to the planned session the activity was paired with, shows no planned-against-done comparison, and has no control to pair or unpair. `matchedSessionId` is set for strength matches only (`lib/garmin/queries.ts:498-504`; `lib/garmin/analytics/daily.ts:144`).

Race page `/more/garmin/race` (`components/features/GarminRaceView.tsx`): links to `/cycles`, the cycle edit race anchor, activities and their fuel section (`:66`, `:89`, `:171`, `:230`).

### 4.11 Calendar as a history view

`/more/calendar` (`app/more/calendar/page.tsx`, `components/features/CycleCalendarClient.tsx`): completed dates of the last year from `getCompletedSessions` (`page.tsx:22-39`). With the endurance switch on, each dated session of a weekday cycle shows its workout summary, its band or state label, and Yes/Missed when unconfirmed (`page.tsx:64-70`; `CycleCalendarClient.tsx:442-456`). Without the switch there is no band and no answer control (`page.tsx:62-63`). A day done only by a Garmin pairing has no `workout_sessions` row, so it is not in `completedDates` (`page.tsx:38-40`).

### 4.12 What the user must do after training, per type

Assumes the endurance switch and Garmin access are on, a weekday cycle, and the watch as the recorder.

| Type | To count as done | Feedback then shown |
|---|---|---|
| Strength | Log sets in the app and save the finish screen. Or MCP `log_session`. A Garmin strength activity alone does not clear it; a past strength day becomes "missed" with no prompt (`lib/utils/session-compliance.ts:444-447`). | History row and detail, PRs, metrics, strength load, band "Done" (no ratio: a strength session has no planned amount, `lib/session-compliance.ts:132`) |
| Run, bike or swim, path B workout | Nothing. After the sync, an activity of the same sport on the same day pairs. | Band on `/planned/[id]`, `/week`, calendar. "Results" button on the home card (`EnduranceTodayCard.tsx:39-42`). Garmin load in the series. The activity page. No history row. No step results unless the user adds them by hand. |
| Run, bike or swim, path A program with one sport | Nothing. Same pairing (the session has a sport, `lib/session-compliance.ts:129`). | Band where shown. No `/planned/[id]` page (`lib/planned-view.ts:65-68`). No history row. |
| Brick, path B (two linked sessions) | Nothing. Each leg pairs with its own activity of its sport. | A band per leg. |
| Brick, path A (one program, bike and run) | Answer "Did you do it?" within 7 days, or log it in the logger. Garmin does not pair it (`lib/session-compliance.ts:293`). "Yes" logs all the time on the first sport (`lib/session-answers.ts:61-62`). | Band from the one logged set. History row with 1 set. |
| No Garmin activity synced (watch not synced, or sport type maps to "other") | Answer "Yes" (time, optional distance and RPE), or save step results, or MCP. After 7 days the session reads "missed". | History row with 1 set; app load when RPE or a pace anchor allows. |
| Rest day | No session exists for the day. Nothing to do. | Garmin Overview and Day tabs show readiness. No "rest day done" record. |
| Recovery session | A normal session of its sport. Same as run, bike or swim above. | Same. |

With Garmin access off, every endurance session needs "Did you do it?", the logger, the player with results, or MCP. With the endurance switch off, path A sessions use auto-complete (3.3) and no band, prompt, player or results page exists.

### 4.13 During and after facts that look like gaps

1. An automatic Garmin pairing is never stored and never shown. No screen names or links the paired activity (`components/`, `app/`: no read of `garminActivityId` or `matchedBy`). MCP returns it.
2. Manual pair (`pick`), `unmiss` and brick links are MCP only (`lib/validators/planned-sessions.ts:32-33`). The Garmin activity page has no pair control.
3. `pairGarmin` has no time window, no minimum duration and no maximum gap. Any activity of the sport on the day marks the session done (`lib/utils/session-compliance.ts:397-416`).
4. A path A brick (one program with bike and run) and any mixed program never pair with Garmin. They need a hand answer, and "Yes" puts all the time on the first sport.
5. A planned strength session is not cleared by a Garmin strength activity and gets no "Did you do it?" prompt.
6. Step results have no Garmin source. Laps and streams are stored and shown on the activity page but are not compared with the planned steps.
7. Saved step results are not shown on `/planned/[id]` or in history. They show again only inside the results form. The actual load computed in `getStepResults` reaches MCP only.
8. The results form cannot take a measured pace, cannot change a step's time, and takes a value, RPE or note on work steps only (`StepResultsForm.tsx:175`, `:205`).
9. A session done by Garmin pairing has no `workout_sessions` row. It is absent from `/history`, from `/more/metrics` and from the calendar's completed dates.
10. The history session detail shows no planned session link, band, load, step results or readiness, though the query returns `plannedSessionId` and `readiness`.
11. The compliance ratio uses duration or distance only. Power, pace and HR against target are not scored at session level.
12. Bike app load is session RPE only. Run and swim have a pace model.
13. RPE scales differ: 6 to 10 with a default of 7 in `LogRunModal`; 1 to 10 and optional in the "Yes" sheet and the results form; a 4-word feeling on the finish screen. The watch RPE is shown as a tile and used nowhere else.
14. The pool view has no way to the results page and no done control. The last block tap does nothing.
15. The guided player keeps a run only in `localStorage`. Nothing reaches the server before the results save.
16. Opening a path A workout route creates a `workout_sessions` row at once; a sweep later closes it as completed with no sets.
17. Swim, bike and run differ in entry point (pool view against player) by code in the home card and the detail page. Path A gives bike and swim the run modal with unit changes only.
18. The exercise-level check circle is inert for endurance exercises, while `toggleExercise` still holds a branch for them.
19. Refresh from Garmin exists only on `/more/garmin` and revalidates only that path.
20. Flags: the endurance switch hides `/planned/*`, the home endurance cards, bands, "Did you do it?", illness banners and the calendar answers. Garmin access (admin role and env key) hides all `/more/garmin` pages and turns pairing off.
21. No operation clears a stored Garmin pick (`lib/planned-sessions.ts:797`, `:1139-1166`).
22. Not read in this part: the `/week` row controls beyond the band and link; `MetricsClient` section details; `BodySignals.tsx`.

## 5. Adapt: what changes future sessions

"Acts alone" means the app writes without a tap. "Asks" means the app shows a prompt and writes on a tap. "AI only" means the app exposes data or an operation over MCP and has no control of its own.

### 5.1 Mechanisms

| Mechanism | Trigger | Input data | What it changes | File:line | Types | Who acts |
|---|---|---|---|---|---|---|
| Readiness swap | A flag exists for today and a hard session of today is not done and not in progress. Read on each home render (`src/lib/home/core.ts:106`) and in `list_planned_sessions` (`src/lib/mcp/tools/planned-sessions.ts:69`). | Garmin daily metrics of today, yesterday and the day before: HRV state `fatigued` or `strained` on two days in a row, and the resting HR flag on the day (`src/lib/utils/training-limits.ts:547-572`, `src/lib/training-limits.ts:267-287`). Only today's reading counts (`utils/training-limits.ts:638`). | Today's first hard session with a sport becomes one step at 60-70% of max HR for the planned time, at most 60 minutes (`utils/training-limits.ts:606-623`, `:636-652`). A stored `key` priority is cleared (`src/lib/readiness-swap.ts:94`). In a taper phase the text adds a note to keep the plan if the user feels well (`readiness-swap.ts:51-53`, `utils/training-limits.ts:629`). | `src/lib/readiness-swap.ts:25-54`, `:65-102`; `src/lib/actions/readiness.ts:18-41` | Swim, bike, run. A strength session has no sport and is never picked (`utils/training-limits.ts:639`). A mixed session has `sport` null and is never picked (`readiness-swap.ts:43`). | Asks. User taps "Make it easy" (`ReadinessSwapCard.tsx:28`), writer `apply`, limits as warnings. AI: `apply_readiness_swap`, writer `assistant`, limits checked (`readiness-swap.ts:99`). Needs the endurance switch and Garmin (`readiness-swap.ts:26`, `src/lib/training-limits.ts:344-349`). |
| Wearable volume suggestion | Read when the Garmin training tab renders (`src/app/more/garmin/page.tsx:57`). | Newest measured Garmin day, at most 3 days old: HRV state, resting HR flag, sleep debt hours, CTL ramp, 4-week ACWR from daily load (`src/lib/periodization-sync.ts:369-407`). Plus adherence, pre-workout readiness and RPE. | A new `adaptationPct` for this week: 88 (HRV fatigued, or strained with resting HR flag), 92 (ACWR over 1.3 or ramp over 8), 95 (sleep debt over 6 h) (`src/lib/utils/periodization.ts:348-361`). Applying it rescales this week's peak-anchored sets. | `wearableSuggestion`, `src/lib/periodization-sync.ts:416-434`; `applyWearableSuggestion`, `:437-457`; `applyWearablePlanSuggestion`, `src/lib/actions/training-cycles.ts:1014-1025` | Path A endurance sets with a peak anchor. | Asks. The weekly sync never uses the wearable ("suggest first", `periodization-sync.ts:411-414`). The user applies it in `GarminLoadTab.tsx:71`. |
| Sleep | none of its own | Sleep debt is read only by the wearable suggestion above (`src/lib/periodization-sync.ts:381`, `src/lib/utils/periodization.ts:358`). | Nothing else. | | | The readiness flag does not read sleep (`src/lib/utils/training-limits.ts:557-562`). |
| HRV and resting HR | as the two rows above, plus the limit `hard_after_low_readiness` | Garmin `hrv` and `restingHr` in `garmin_daily_metrics.metrics` (`src/lib/training-limits.ts:273-285`) | See those rows. | | | |
| Body Battery | none | Not read by any file under `src/lib` outside `src/lib/garmin/`. The other files that name it are UI components. | Nothing. | | | Display only. |
| Pre-workout readiness check-in (1-5) | The user answers the sheet at session start (`src/contexts/workout-session-context.tsx:290`). | Stored on `workout_sessions.readiness` (`src/lib/actions/workout-sessions.ts:386-412`). | Two readers. The weekly sync: average readiness of 2 or less eases volume 8% (`src/lib/utils/periodization.ts:367-369`). The strength progression engine: per exercise `progressionReadiness` of ignore, hold or reduce (`src/db/schema/programs.ts:112-116`, `src/lib/utils/progression.ts:245`, `:1118-1122`). | as cited | Sync: path A endurance sets. Progression: strength. | Acts alone (sync). The progression result is a suggestion in the workout. |
| Illness period | The user or the AI adds a period (`manageIllness`, `src/lib/actions/workouts-compliance.ts:53-77`; `IllnessSheet.tsx:60-190`; MCP `manage_illness`, `src/lib/mcp/tools/workouts-compliance.ts:223`). | `illness_periods` (`src/db/schema/illness.ts:14-32`) | No session row changes: "nothing is stored on the sessions" (`illness.ts:3-5`). On read, a session inside a period has state `illness` (past) or `sick` (today or later) (`src/lib/utils/session-compliance.ts:443`). The move suggestion skips sick days (`:264`). The home shows a return rule for 7 days or until the first done endurance session (`:192-230`). "The app shows the rule; it never changes the plan" (`:197`). | `src/lib/illness.ts:43-96` | States apply to every session when the switch is on. | Exposes only. Side effect: illness sessions count as not done in the adherence of the weekly sync (`src/lib/periodization-sync.ts:138-142`), so a sick week can ease the next week 10% (`src/lib/utils/periodization.ts:363-365`). |
| Session priority | Stored on a slot or session, else derived on read. | Stored `priority`; `hard`; planned duration (`src/lib/utils/session-compliance.ts:463-488`) | Derived: key when hard, or the longest bike or run of its week at 90 minutes or more; else support. A session with no sport is support. | `effectivePriorities`, `src/lib/utils/session-compliance.ts:468-488` | Key by length: bike and run only. | App: a "key" toggle on a template slot only (`CycleScheduleBuilder.tsx:299`, `:310`). AI: slot and dated session (`set_priority`). Priority feeds the missed-key move, the heavy-legs rule and the readiness swap. `optional` has no reader that treats it differently from `support` in the files read. |
| Missed key session: suggested day | A key session has stored status `missed` in this week (`src/lib/session-answers.ts:117-118`, `:144`). | The week's sessions, the profile's `availableDays`, sick periods (`session-answers.ts:89-93`, `:117-127`) | Suggests the earliest day after the missed day, today or later, same Monday to Sunday week, an available day, not sick, with no key or hard session on it or next to it, under the cap of three (`src/lib/utils/session-compliance.ts:254-298`). With no such day the text is "No free day this week. Skip it and go on." (`:297`). | `moveSuggestion`, `src/lib/session-answers.ts:96-99`; `checkSuggestedMove`, `:109-114` | Any session with priority key. | Asks. The user taps the move (`DidYouDoIt.tsx:77`, `PlannedSessionActions.tsx:325`). The server checks the day again (`src/lib/actions/planned-sessions.ts:48`). A moved missed session becomes planned again (`src/lib/planned-sessions.ts:1007-1008`). AI reads the suggestion (`src/lib/mcp/tools/planned-sessions.ts:78`, `workouts-compliance.ts:213`). |
| "Did you do it?" | A session with a sport, in the last 7 days, with no match and no answer has state `unconfirmed` (`src/lib/utils/session-compliance.ts:418-419`, `:444-446`). | Planned session, logged workouts, Garmin activities | "Yes" writes a completed workout linked to the session, with duration, optional distance and RPE (`src/lib/session-answers.ts:54-87`). "Missed" stores `status = missed` (`src/lib/planned-sessions.ts:1051-1055`). | `confirmPlannedDone`, `src/lib/actions/workouts-compliance.ts:32-50`; `SessionAnswers.tsx:92`, `:211`, `:344` | Endurance and mixed sessions. Strength: "Log a strength session in the app or with log_session" (`session-answers.ts:63`). | Asks. No future session changes by itself. The answer feeds adherence and RPE in the weekly sync. |
| Missed list and make-up (switch off, or no-sport sessions) | A past planned session with no match, in the last 7 days (`src/lib/planned-sessions.ts:515-518`, `:606-610`). User opt-out `users.missedWorkoutsEnabled` (`src/lib/actions/training-cycles.ts:212-219`, `:409-434`). | Planned sessions, completed workouts | A make-up is a workout with `intendedDate` set. The matcher counts it for the missed day (`src/db/schema/workout-sessions.ts:63-66`, `src/lib/utils/planned-sessions.ts:284-289`). | `weekdayToday`, `src/lib/planned-sessions.ts:504-612` | With the switch on, sessions of programs that hold any endurance sport leave this list and go to "Did you do it?" (`:542-552`, `:608`). | Asks. |
| Decline a make-up | User taps Decline (`DeclineMakeupButton.tsx:20`). | Date, optional session id | The session, or every planned session of that date, gets `status = skipped`. A `dismissed_makeups` row is written when the day is clear (`src/lib/planned-sessions.ts:1305-1350`). | `dismissMissedWorkout`, `src/lib/actions/training-cycles.ts:381-402` | All. | User. |
| Auto session | On each read of the active cycle. Weekday: a planned session with `autoComplete` that is not done, in the last 7 days (`src/lib/planned-sessions.ts:554-565`). Rotation: today's slot only (`src/lib/actions/training-cycles.ts:267-287`, `src/lib/utils/cycle-position.ts:324-329`). | `autoComplete` flag | Inserts a completed `source='auto'` workout with no sets (`src/lib/auto-sessions.ts:17-40`). | as cited | With the endurance switch on, a session whose program holds any endurance sport is left out (`src/lib/planned-sessions.ts:542-552`, `:557`). With the switch off, any `autoComplete` session. MCP `confirm_session` also writes one (`src/lib/mcp/tools/sessions.ts:225`, `:262`). | Acts alone. |
| "I skipped it" on an auto day | User tap (`SkipAutoDayButton.tsx:19`). | The auto workout | The planned session is skipped, the auto row is deleted, the dismissal row is written (`src/lib/planned-sessions.ts:1358-1390`). | `skipAutoCompletedDay`, `src/lib/actions/training-cycles.ts:325-366` | Auto days. | User. |
| Ghost sessions | Owner-run script only (`src/lib/ghost-sessions.ts:8-10`). | Completed `app` sessions with no sets, notes or feeling, older than 7 days (`:22-35`) | Deletes them (`:77-91`). | `src/lib/ghost-sessions.ts` | Logged sessions, not the plan. | Manual. It changes no future session. |
| Weekly periodization sync | The first read in a new cycle week: `getActiveCycleForUser` (`src/lib/actions/training-cycles.ts:205-207`), `syncDueCycle` (`src/lib/periodization-sync.ts:47-60`) from the program pages (`src/app/programs/[id]/page.tsx:22`, `src/app/programs/[id]/workout/page.tsx:32`), and `periodizationShare` (`periodization-sync.ts:74`). Also after a restore, with the current nudge kept (`src/lib/plan-revisions.ts:1805-1827`). | Curve by phase type, goal and level (`periodization-sync.ts:269-279`). Adaptation signals of the last 7 days: adherence, average pre-workout readiness, average RPE (`:104-118`, `:144-167`, `:170-228`). | For each live set with a peak anchor in the cycle's programs: `distanceMeters` and `durationSeconds` = peak x curve x adaptation. For sets with `sessionRole = work`, also `targetHeartRateZone` and `restTimeSeconds` by phase, except in a transition phase (`periodization-sync.ts:308-347`). Stores `lastSyncedWeek`, `adaptationPct`, `adaptationNote` (`:351-358`). Adaptation: 90 when adherence is under 0.6; 92 when readiness is 2 or less; 105 when adherence is 0.9 or more, readiness 4 or more or absent, and RPE 6 or less or absent; else 100. Neutral in week 1 or with no signal (`src/lib/utils/periodization.ts:362-380`, `periodization-sync.ts:108`, `:175`). | `syncPeriodizedTargets`, `src/lib/periodization-sync.ts:246-365` | Path A endurance sets only. A cycle with no peak anchors gets only the week marker (`:234-235`). `planned_sessions.workout` is not read or written by it. | Acts alone, writer `sync`. Limits run as warnings, stored on the revision (`:287-290`, `:360`). The warnings show on the cycle page and in `get_training_cycle` (`src/lib/training-limits.ts:868-891`, `src/app/cycles/[id]/page.tsx:85`). |
| Volume percent by the AI | MCP `manage_training_cycle` operation `set_volume` (`src/lib/mcp/tools/cycles.ts:144`). | pct | The same rewrite as the sync, with the given percent, for this week (`periodization-sync.ts:254-263`). | as cited | Path A endurance sets. | AI only. The app has no control for it. |
| Cycle completion | A read after the block's last day (`src/lib/actions/training-cycles.ts:192-198`). | Start date and length | `status = completed`, writer `sync`. | as cited | All. | Acts alone. The next block starts only by a user tap (`CycleCompletionBanner.tsx:58`), a scheduled start, or a season chain. |
| Scheduled start and season chain | A read on or after `scheduledStartDate` (`src/lib/plan-revisions.ts:1070-1116`). After a long absence, up to 60 chained phases start in order (`:1104-1116`). | Scheduled day | The draft becomes active with that day as start. The running cycle completes. Dated sessions are generated. | as cited | All. | Acts alone, writer `sync`. |
| Season re-plan flag | A race change: a date change, an A race added or removed, a priority change to or from A (`src/lib/utils/seasons.ts:264-269`). | Races | Sets `replanFlaggedAt` and `replanReason` on the season. "The app never reshapes the phases itself; the user or the assistant clears it" (`src/db/schema/seasons.ts:38-41`). | `src/lib/utils/seasons.ts:269`; clear: `SeasonDetailClient.tsx:254`, `:351`; MCP `manage_season` `clear_replan` (`src/lib/mcp/tools/seasons.ts:181`) | Seasons with races (endurance). | Exposes only. "Fit taper" changes the length of the phase before the taper on a tap (`src/lib/seasons.ts:822-830`). |
| Template edit | Any slot or cycle write. | Template | Untouched sessions from this week's Monday follow it (section 1.0). | `src/lib/plan-revisions.ts:473-498` | All. | Acts alone, inside the same write. |
| Library workout edit | `updateWorkout`, `deleteWorkout`. | Library entry | Untouched sessions of active and scheduled weekday cycles whose slots use it get the new copy (`src/lib/workouts.ts:96-129`). A session can also pull the newest copy with `update_from_library`, MCP only (`src/lib/planned-sessions.ts:1015-1024`). | as cited | Swim, bike, run workouts. | Acts alone on a library write. |
| Strength progression (pointer) | A completed strength session. | Logged sets, RIR, readiness | A suggestion for the next session. With `progressionApplyToPlan` on, accepting it rewrites the planned sets (`src/db/schema/programs.ts:125-131`, `applyProgressionToPlan`, `src/lib/actions/programs.ts:552`, `WorkoutSetsClient.tsx:508`). | `src/lib/utils/progression.ts:664`, `:1328`; `docs/progression-revamp-plan.md` | Strength. Advance axes `duration` and `distance` also exist (`programs.ts:100-102`). The generator sets endurance exercises to `manual` (`src/lib/utils/triathlon-plan.ts:299`). | Asks. |
| Weight-stack learning (pointer) | Session completed or swept. | Logged weights | `program_exercises.weightStack` (`src/db/schema/programs.ts:70-73`). | `src/lib/weight-stack-learning.ts:35` | Strength on cable or machine. | Acts alone. |
| Coach memory | AI or user writes entries. | Free text | Nothing in the plan. "Not checked by the training limits: memory is context, not a plan change. Not sent to the in-app AI" (`src/lib/coach-memory.ts:8-10`). | `src/lib/coach-memory.ts` | n/a | Exposes only, to the connected assistant. |

### 5.2 Training limits

Who is checked: only an assistant's plan write. "A user's own edit in the app is never checked" (`src/lib/training-limits.ts:1-6`). The app's own writes (weekly sync, applied Garmin suggestion, scheduled start, readiness swap by the user) run the rules in `warn` mode: nothing is refused and the broken rules are stored as warnings on the revision (`src/lib/training-limits.ts:1260-1287`). In `check` mode a broken rule that is not overridden throws and the write rolls back (`:1288-1300`). The assistant can override a rule with a reason (`:1112`, `:1204`). A rule is broken only when the write makes things worse (`src/lib/utils/training-limits.ts:5-7`). With the endurance switch off no rule runs (`src/lib/training-limits.ts:1125-1126`).

Call sites in `check` mode: `manage_planned_session` (`src/lib/mcp/tools/planned-sessions.ts:189-190`), `edit_cycle_slot` and `manage_training_cycle` (`src/lib/mcp/tools/cycles.ts:297`, `:343`, `:373`, `:504-509`), program tools (`src/lib/mcp/tools/programs.ts:394-398`, `:538-545`), `manage_workout` update (`src/lib/mcp/tools/workouts-compliance.ts:153`, `src/lib/workouts.ts:161`), restore (`src/lib/mcp/revisions.ts:273`, `:282`), season resume (`src/lib/mcp/tools/seasons.ts:289`).

| Rule | What it checks | Needs | Not checked when | File:line |
|---|---|---|---|---|
| `long_run_cap` | A planned run longer than 1.10 x the longest run of the last 30 days, by duration and by distance | Run history: Garmin runs plus runs logged in the app (`src/lib/training-limits.ts:319-322`); app runs alone when Garmin is absent (`:304-308`) | No run history at all (`:125-126`, `:1140`) | `src/lib/utils/training-limits.ts:39-48`, `:133-148` |
| `hard_sessions_per_week` | More than 3 hard sessions in a Monday to Sunday week, and more than before the write | The plan only | Rotation cycles, or a change outside an active, scheduled or starting weekday cycle (`src/lib/training-limits.ts:1158-1165`) | `src/lib/utils/training-limits.ts:150-194` |
| `hard_after_low_readiness` | A write that adds a hard session on the low-readiness day or the next day | Garmin HRV of today or yesterday | No Garmin, or no HRV reading from today or yesterday (`src/lib/training-limits.ts:127-128`, `:316-326`, `:1177-1178`) | `src/lib/utils/training-limits.ts:574-604` |
| `heavy_legs_before_key` | A session with 3 or more heavy leg sets 1-2 days before a key bike or run, or earlier the same day | The plan only | The write touches no weekday cycle day (`src/lib/training-limits.ts:1166-1171`) | `src/lib/utils/training-limits.ts:265-289`, `:355-414` |
| `strength_per_week` | Strength sessions per week move away from the default for the strength goal and phase | `athlete_profiles.strengthGoal` and a cycle `phaseType` | No strength goal, or no phase type (`src/lib/training-limits.ts:129`, `:191`, `:1186-1188`) | `src/lib/utils/training-limits.ts:436-506` |
| `weekly_load_ramp` | Planned 7-day rise of endurance CTL over 8, or over 6 while CTL is 45 or less, and above the ramp before | 42 days of endurance load history from Garmin or the app (`src/lib/training-limits.ts:139-157`) | No endurance load, or fewer than 42 days (`:130-132`, `:150`, `:1195`) | `src/lib/utils/training-limits.ts:654-669`, `:737-765` |

Who sees the result:

- The assistant gets the check in the tool result (`src/lib/mcp/tools/planned-sessions.ts:179`).
- Each revision stores it in `plan_revisions.limitCheck` (`src/db/schema/plan-revisions.ts:58-60`, `src/lib/plan-revisions.ts:546`).
- The user sees sync warnings on the cycle page (`src/app/cycles/[id]/page.tsx:85`).
- The heavy-legs rule also shows as a line in the calendar and in `list_planned_sessions`, with no check of the user's edit (`src/lib/training-limits.ts:895-918`, `src/app/more/calendar/page.tsx:72`, `src/lib/mcp/tools/planned-sessions.ts:70`).

### 5.3 Plan revisions

- One row per change to a plan object, with the whole object after the change (`src/db/schema/plan-revisions.ts:1-7`).
- Object types: program, cycle, memory, athlete, threshold, injury, season, planned_session, workout, illness, race_plan (`:21`).
- Writers: user, assistant, progression, sync, apply (`:23`). Actions: create, update, delete, restore, baseline, conflict (`:22`).
- An assistant write needs a `reason` (`:45-46`) and a version check (`expectedVersion`, `src/lib/mcp/tools/planned-sessions.ts:186`). The app sends no version for session changes (`src/lib/actions/planned-sessions.ts:4-7`).
- Dated sessions regenerated from the template write no revision of their own: "the cycle's own revision holds the template" (`src/lib/planned-sessions.ts:129-132`).
- Undo: `restoreRevision` (`src/lib/plan-revisions.ts:1838`) and `restoreChangeSet` for a whole assistant change set (`:1869`). App: `PlanHistoryClient.tsx:77`, `AssistantChangesClient.tsx:50`, `RecentlyDeleted.tsx:26`, `PlanItemDeleted.tsx:29`. A rejected (conflict) write can be applied later (`PlanHistoryClient.tsx:90`).
- A session restore is refused for a logged, started or past session (`src/lib/planned-sessions.ts:814-851`).
- Retention: a daily purge drops revisions older than the retention time except each object's newest, and deletes for good the plans deleted more than 90 days ago (`src/lib/plan-revisions.ts:2195-2203`, `src/instrumentation.ts:54`).


## 6. MCP inventory

Repo `logeverylift`, `main` at feafb9f. Paths are relative to the repo root. `T` = `src/lib/mcp/tools`.
Every line cited was opened. Nothing was run.

### 6.1 Endpoint, access, flags

- Endpoint: `/api/mcp`, Streamable HTTP (`src/app/api/[transport]/route.ts:1-7`, `:140`).
- Auth: OAuth bearer token, checked on every request by `requireMcpAuth` (`route.ts:9-15`, `:144`). The user id comes from the token subject and is never a tool parameter (`route.ts:71`).
- Access = token scopes narrowed by the user's stored consent for that client (`src/lib/mcp/access.ts:22-38`, `src/lib/mcp/scopes.ts:30-34`). No consent row gives a 401 (`route.ts:101`). No mcp scope gives a 403 (`route.ts:102-105`).
- Two scopes: `mcp:read` and `mcp:write` (`scopes.ts:17-18`). Access is `read` or `write` (`scopes.ts:37-41`). The user picks it on the consent page (`scopes.ts:4-5`).
- A tool is a read tool only when it has `readOnlyHint: true`. All other tools need write access (`scopes.ts:10-11`, `:53-55`).
- With read access, write tools stay in the list. Their handler refuses with a fixed text and does not run (`scopes.ts:66-79`, `:23-24`).
- Any user with a valid token and consent can connect. No role check exists in `access.ts`.
- Flag `endurance` = `users.enduranceEnabled` (`src/lib/endurance.ts:18-24`). Only an admin can set it (`endurance.ts:5-6`).
- Flag `garmin` = env key `GARMIN_KEY_ENCRYPTION_KEY` is set and the user role is `admin` (`src/lib/garmin/access.ts:15-23`).
- Registration by flag (`route.ts:115-137`):

| Group | Register function | Condition |
|---|---|---|
| Profile, programs (and revisions), cycles, seasons, workout history, sessions, planned sessions, exercises, coach memory, compliance | `route.ts:115-125`, `:133` | always |
| `get_athlete_profile`, `manage_thresholds` | `route.ts:126` | always |
| `manage_athlete_profile`, `manage_injuries` | `T/athlete-profile.ts:257` | endurance |
| Workout library, `confirm_planned_session`, `manage_illness` | `route.ts:128` | endurance |
| `get_training_load`, `get_step_results`, `log_step_results` | `route.ts:130` | endurance |
| Nutrition and race plan tools | `route.ts:132` | endurance |
| Garmin tools | `route.ts:134` | garmin |
| 3 resources | `route.ts:135` | always |
| Prompt `intake_interview` | `route.ts:137` | always (the text changes without endurance, `T/athlete-profile.ts:356-362`) |

Count: 54 tools when both flags are on. 34 tools with both flags off (minus 2 athlete writes, 5 library and answer tools, 3 load tools, 6 nutrition tools, 4 Garmin tools).

### 6.2 Rate limits and size limits

| Limit | Value | Where |
|---|---|---|
| Requests per user | 120 per 60 s, in memory, per process | `src/lib/mcp/rate-limit.ts:10-13`, checked at `route.ts:85` before the consent check |
| Over the limit | HTTP 429, "Rate limit exceeded. Please slow down." | `route.ts:86-93` |
| `reason` on writes | 1 to 500 characters | `src/lib/mcp/revisions.ts:43-47` |
| `overrideReason` | 10 to 500 characters, needed with `overrideLimits` | `src/lib/mcp/limits.ts:20-25`, `:34` |
| Assistant change set window | 30 minutes | `src/lib/utils/plan-revisions.ts:769`, `instructions.ts:42` |
| `list_planned_sessions` range | 93 days | `src/lib/utils/planned-sessions.ts:13`, `T/planned-sessions.ts:57` |
| `recent_workouts` | 1 to 90 days, default 14 | `T/workouts.ts:86` |
| `exercise_history` | 1 to 20 sessions, default 10; 25 name candidates | `T/workouts.ts:153`, `:171` |
| `personal_records` | 1 to 100, default 30 | `T/workouts.ts:235` |
| `weekly_volume` | 1 to 52 weeks, default 8 | `T/workouts.ts:280` |
| `get_compliance` | 1 to 52 weeks, default 12 | `T/workouts-compliance.ts:295`, `src/lib/utils/session-compliance.ts:93` |
| `get_training_load` | 7 to 365 days, default 90 | `T/endurance-app.ts:50`, `:55` |
| `get_nutrition` fuel logs | 1 to 90 days, default 28 | `T/nutrition.ts:56`, `:62` |
| `list_garmin_activities` | 1 to 100, default 20 | `T/garmin.ts:116`, `:121` |
| `get_garmin_trends` | fixed 12 weeks of thresholds, 90 days of best efforts, no parameter | `T/garmin.ts:83`, `:88`, `:91` |
| `log_session` | up to 60 days back, 1 to 100 sets | `T/sessions.ts:34`, `:84-87` |
| `log_step_results` | 1 to 400 steps | `T/endurance-app.ts:127` |
| Program sets per call | 50 | `T/programs.ts:350` |
| `search_exercises` | 1 to 50, default 20 | `T/exercises.ts:53` |
| Sessions per day | 3 (position 1-3, daySlot 1-3) | `T/planned-sessions.ts:142`, `T/cycles.ts:424` |
| Cycle length | 1 to 52 weeks | `src/lib/validators/training-cycles.ts:8-9` |
| Scheduled start | up to 120 days ahead | `src/lib/utils/cycle-start.ts:15` |
| `set_volume` pct | 50 to 110 | `T/cycles.ts:55-56` |
| Season | 30 phases, 20 races, text 500 | `src/lib/utils/seasons.ts:382`, `src/lib/seasons.ts:56-60` |
| Coach memory | 200 entries, 1000 characters each | `src/lib/plan-revisions.ts:1511`, `src/lib/coach-memory.ts:31` |
| Weight history in `get_profile` | newest 50 | `T/profile.ts:42` |
| Fuel products | 100 | `T/nutrition.ts:182` |

### 6.3 Shared write rules

- Plan writes take `reason` and `expectedVersion`. An older version is refused with the list of changes since (`revisions.ts:65-100`, `:104`).
- A write is refused while the user has an open workout on that plan (`revisions.ts:106-108`).
- Each plan write is a revision with writer `assistant` and the OAuth client id (`revisions.ts:60-62`, `route.ts:116-117`).
- Training limits: six rules (`src/lib/utils/training-limits.ts:18-25`). They run for users with endurance on (`limits.ts:28-29`). A refusal returns `applied: false`, the broken rules, numbers and evidence (`limits.ts:39-65`). A resend with `overrideLimits` and `overrideReason` passes (`limits.ts:12-26`). Each checked write returns `checked`, `notChecked`, `passed`, `overridden`, `warnings` (`limits.ts:68-77`).
- Results are JSON text. Internal errors return a generic message (`src/lib/mcp/result.ts:15-40`).

### 6.4 Tools per file

"Rev" = the write makes a plan revision that `restore_revision` or the app can restore.

#### `T/profile.ts`

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `get_profile` | 22 | R | `users` (name, gender, birthYear, heightCm, weightKg, goals, experienceLevel, timeZone, distanceUnit, swimUnit, enduranceEnabled, homeLayout), `user_weight_entries` | none | 50 weight entries (`:42`) | - |
| `update_profile` | 73 | W | `users`; adds a `user_weight_entries` row when weight changes (`:125-133`) | name, gender, birthYear, heightCm, weightKg, goals (max 5), experienceLevel, timeZone, distanceUnit, swimUnit | Cannot set endurance (`:77`) | no |
| `manage_weight` log | 142, `:157` | W | inserts `user_weight_entries`, sets `users.weightKg` | weightKg, recordedAt | not in the future (`:160`) | no |
| `manage_weight` delete | `:175` | W | deletes one `user_weight_entries` row | entryId | - | no |

#### `T/programs.ts` (also registers the revision tools, `:166`)

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `list_programs` | 169 | R | `programs` (live) | none | - | - |
| `get_program` | 191 | R | `programs`, `program_exercises`, `exercises`, `program_sets` | programId | - | - |
| `create_program` | 222 | W | inserts `programs` | name, reason | - | yes (`:230-233`) |
| `update_program` | 243 | W | renames `programs` | programId, name, reason, expectedVersion | - | yes |
| `delete_program` | 270 | W | soft delete through `deletePrograms` | programId, reason, expectedVersion | restorable 90 days; refused with an open workout (`:273`) | yes |
| `edit_program_exercise` add | 293, `:373` | W | inserts `program_exercises` and `program_sets` | programId, exerciseId, orderIndex, notes, progression fields, sets[] | limits checked (`:398`); 50 sets | yes |
| `edit_program_exercise` update | `:455` | W | updates `program_exercises`; sets matched by id then setNumber; unnamed sets are soft deleted (`:571-617`) | programExerciseId, any slot field, sets[] | limits checked (`:545`); zone and rest on a sync-owned "work" set are refused (`:589-597`) | yes |
| `edit_program_exercise` remove | `:628` | W | soft deletes the slot (`:638`) | programExerciseId | - | yes |

Set fields the tool accepts (`:81-100`): setNumber, targetReps, repRangeMin, repRangeMax, targetRir (0-5), weightKg, durationSeconds, distanceMeters, inclinePercent (0-30), targetHeartRateZone (1-5), sessionRole (`work` or null), startDelaySeconds (0-60), restTimeSeconds, setType (`working`, `warmup`). An unknown key fails the call (`:101`).

#### `src/lib/mcp/revisions.ts`

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `list_revisions` | 205 | R | `plan_revisions` for one object, or the assistant's change sets | objectType (program, cycle, memory, athlete, threshold, injury, season, planned_session, workout, illness, race_plan), objectId | athlete, injury, workout, illness, race_plan need endurance (`:202`, `:224`) | - |
| `restore_revision` | 247 | W | `restoreRevision` or `restoreChangeSet` | revisionId or changeSetId, reason | limits run as warnings only, never a refusal (`:254`, `:182-183`); refused with an open workout | yes (the restore is a revision, `:252`) |

#### `T/cycles.ts`

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `list_training_cycles` | 75 | R (starts a due scheduled cycle first, `:86`) | `training_cycles`, race per cycle | none | - | - |
| `get_training_cycle` | 100 | R (same side effect, `:110`) | cycle, slots with program, race, `touchedFutureSessions`, `limitWarnings` (`:124-127`) | cycleId | - | - |
| `manage_training_cycle` create | 134, `:184` | W | inserts `training_cycles` | name, durationWeeks, scheduleType, endAction, endMessage, raceDate, raceDistance, goal, athleteLevel | race, goal, level need endurance (`:181-183`) | yes |
| update | `:216` | W | updates `training_cycles` | name, durationWeeks, endAction, endMessage, status, endurance fields, scheduledStartDate null | status `active` refused, use start (`:238`); race and length refused on a season phase (`:227-234`); limits checked when length, goal or level change on a running or scheduled cycle (`:287-306`) | yes |
| delete | `:319` | W | `deleteCycles` | cycleId | restorable 90 days (`:142`) | yes |
| start | `:367` | W | `activateCycle` or `scheduleCycle` | cycleId, startDate | up to 120 days ahead; first week checked by limits (`:373-377`) | yes |
| set_volume | `:331` | W | `syncPeriodizedTargets` with a pct for this week | cycleId, pct 50-110 | active cycle only (`:340`); lasts one week (`:144`); limits checked (`:343-348`) | yes |
| `edit_cycle_slot` upsert | 403, `:441` | W | `training_cycle_slots`; regenerates untouched dated sessions (`:513`) | trainingCycleId, dayOfWeek or orderIndex, daySlot 1-3, label, programId, notes, autoComplete, workoutId, priority, brickWithNext | workoutId, priority, brickWithNext need endurance (`:482-483`) and a weekday cycle (`:409`); limits checked (`:509`) | yes |
| remove | `:526` | W | removes the slot, regenerates sessions | slotId, cycleId | - | yes |

#### `T/seasons.ts`

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `list_seasons` | 108 | R | seasons with A race, re-plan flag, phase count | none | - | - |
| `get_season` | 142 | R | season, races, phases with dates, taperFit, chainPaused (`:64-105`) | seasonId | - | - |
| `manage_season` | 165 | W | operations create, update, delete, clear_replan, add_phase, remove_phase, move_phase, set_phase, fit_taper, resume (`:181`) | seasonId, name, goal, nextGoal, startDate, endDate, cycleId, cycleVersion, position, phaseType, durationWeeks, durationDays, takeStart | phaseType is endurance only (`:171`); `resume` runs the limits on the next phase's first week (`:281-294`); 30 phases | yes |
| `manage_race` | 305 | W | add, update, remove a race on a season | seasonId, raceId, name, date, discipline, distance, distanceMeters, priority A/B/C | description says endurance only (`:309`); 20 races; a date or A-race change flags a re-plan (`:312`) | yes |

#### `T/workouts.ts` (history, all read only, `:31`)

| Tool | Line | Reads | Key parameters | Returns |
|---|---|---|---|---|
| `recent_workouts` | 81 | `workout_sessions` (completed), `programs`, `workout_sets`, `exercises` | days 1-90 | date, program, durationMinutes, feeling, readiness, notes, sets per exercise (`:126-138`). No session id in the output. |
| `exercise_history` | 146 | sets of one exercise, `exercise_notes` | exercise (name part), sessions | sets per session, the user's exercise note |
| `personal_records` | 230 | `exercise_prs` (not superseded) | limit | type, value, weightKg, distanceMeters, date, unverified |
| `weekly_volume` | 275 | sessions and kg x reps per week | weeks | weekStart, sessions, volumeKg |
| `summary_stats` | 316 | totals, average minutes, lifetime kg, streak weeks | none | 4 numbers |

Set fields returned: setNumber, setType, reps, weightKg, durationSeconds, distanceMeters, heartRateZone, rir, rpe, isFailed, notes (`:54-67`).

#### `T/sessions.ts`

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `log_session` | 67 | W | `writeLoggedSession` with source `assistant` (`:143-153`) | date, programId, plannedSessionId, startTime, durationMinutes, feeling, notes, sets[] (exerciseId, setNumber, reps, weightKg, durationSeconds, distanceMeters, heartRateZone, rir or rpe, notes, setType) | today or up to 60 days back; planned session only on its own day (`:121`); refused on a duplicate (`:155`); the assistant cannot edit or delete it later (`:74`) | no (`:3-4`) |
| `confirm_session` | 166 | W | `insertAutoSessions`: an auto session with no sets (`:225`, `:262`) | date and programId, or plannedSessionId | active cycle only (`:212`); not in the future (`:218`); refused for an endurance program when endurance is on (`:200-204`); a planned session with no program returns "Planned session not found" (`:184`) | no |

#### `T/planned-sessions.ts`

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `list_planned_sessions` | 42 | R | `listPlanned`, `sessionCompliance`, loads, `readinessSwapFor`, `heavyLegsNotes`, `moveSuggestion` (`:61-78`) | from, to, cycleId | 93 days; plannedLoad, load, readinessSwap and heavyLegs fields only with endurance (`:65-70`, `:95-106`) | - |
| `manage_planned_session` | 116 | W | `applySessionOp`, `applyRotationOp`, `applyReadinessSwap` | operation (14 values, `:133`), id, cycleId, rotationPosition, date, position, programId, label, notes, skipReason, workout, workoutId, priority, brickParentId, reason, expectedVersion | see the operation table | yes |

Operations of `manage_planned_session`:

| Operation | Needs | Limits checked | Notes |
|---|---|---|---|
| move | id, date, expectedVersion | yes (`:190`) | today to the end of the block, never a past day (`:121`) |
| skip | id | no | optional skipReason |
| unskip | id | yes | from today on |
| change | id; programId, label, notes, position | yes | |
| reset | id | yes | back to the template |
| remove | id | no | only a session added by hand (`:121`) |
| add | cycleId, date, and programId or workout or workoutId (`:182-183`) | yes | weekday cycle; 3 sessions a day (`:122`) |
| set_workout | id, workout or workoutId | yes | endurance only (`:127`); schema check cannot be overridden |
| clear_workout | id, programId (`:191`) | yes | endurance only |
| update_from_library | id | yes | endurance only |
| set_priority | id, priority or null (`:192`) | no | endurance only |
| link_brick | id, brickParentId (`:193`) | no | endurance only; same day, earlier position (`:127`) |
| unlink_brick | id | no | endurance only |
| apply_readiness_swap | id, expectedVersion (`:174-176`) | returns limits | endurance only; the app reads the suggestion again and refuses when it no longer holds (`:128`) |
| Rotation cycle (cycleId and rotationPosition) | skip, unskip, change (programId) only (`:157-162`) | not checked (`:172`) | a rotation session cannot move (`:123`) |

#### `T/workouts-compliance.ts`

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `list_workouts` | 49 | R | `listWorkouts` (library) | sport, q, deleted | endurance | - |
| `get_workout` | 73 | R | library workout or a planned session's copy; resolved steps from current thresholds, missingAnchors, estimate, plannedLoad (`:84-96`) | workoutId or plannedSessionId | endurance; a program session is refused (`:93`) | - |
| `manage_workout` create | 103, `:131` | W | `createWorkout` | workout (JSON), priority | endurance; schema check | yes |
| update | `:149` | W | `updateWorkout`; rewrites untouched slot-made sessions from this week's Monday (`:109`) | workoutId, workout, priority, name, expectedVersion | limits checked (`:153`) | yes |
| duplicate | `:138` | W | `duplicateWorkout` | workoutId | - | yes |
| delete | `:144` | W | `deleteWorkout` (soft) | workoutId, expectedVersion | user can restore (`:108`) | yes |
| `confirm_planned_session` done | 169, `:196` | W | `confirmDone`: logs a session linked to the planned one, source `assistant` (`:198`) | plannedSessionId, durationSeconds (60-86400), distanceMeters, rpe 1-10, notes | endurance | yes for miss, unmiss and pick; the done path writes logged data |
| done with garminActivityId | `:206` | W | `applySessionOp` op `pick` | garminActivityId, expectedVersion | needs Garmin access (`src/lib/planned-sessions.ts:1064-1065`); same day or one day either side (`:174`) | yes |
| missed | `:207` | W | op `miss` | missedReason, expectedVersion | returns `suggestedMoveTo` for a key session (`:213-214`) | yes |
| unmiss | `:209` | W | op `unmiss` | expectedVersion | - | yes |
| `manage_illness` | 222 | W | add, update, end, delete a sick period (`:233`); returns sessions read as illness and returnInfo (`:272-277`) | illnessId, startedOn, endedOn, severity, notes | endurance; periods never overlap (`:228`); the plan does not change by itself (`:226`) | yes |
| `get_compliance` | 287 | R | `sessionCompliance`, `consistency`; bands and done-by-sport counts (`:303-318`) | weeks | every user (`:285`) | - |

#### `T/endurance-app.ts` (endurance only)

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `get_training_load` | 41 | R | `getTrainingLoad`: per day load, ctl, atl, tsb per sport and total; ramp; noLoad list; methods (`:55-67`) | days | source is `garmin` or `app`, never both (`:46`) | - |
| `get_step_results` | 75 | R | `getStepResults`: per step planned text, seconds, meters, target, result, band, targetHit; session RPE, time, distance, load, plannedLoad (`:86-108`) | plannedSessionId or workoutSessionId | null when none logged (`:87`) | - |
| `log_step_results` | 116 | W | `saveStepResults` with writer `assistant` (`:137-141`) | plannedSessionId, steps[] (key, status, activeSeconds, distanceMeters, value, rpe, notes), sessionRpe, distanceMeters, notes | creates the logged session when none exists, else attaches and replaces earlier results (`:122`) | no (`:122`) |

Step status values: done, skipped, partial, not_done (`:31`). `value` is one number in watts, bpm, m/s or rpm (`:34`).

#### `T/nutrition.ts` (endurance only)

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `get_nutrition` | 48 | R | carb rules, gut training, fluid, sodium, sweat tests, products, fuel logs (`:64-103`) | days | - | - |
| `log_fuel` | 110 | W | `saveFuelLog` (replaces the log of that session) | workoutSessionId or garminActivityId, carbsG, fluidMl, sodiumMg, caffeineMg, giScore 0-10, items, notes, clear | garminActivityId needs Garmin (`:130`) | no (`:117`) |
| `manage_sweat_tests` | 142 | W | add or delete a sweat test | durationMinutes 30-240, preKg, postKg, fluidMl, urineMl, temperatureC, sport, sweatSodiumMgL, testedOn | typo checks on the server (`:147`) | no |
| `manage_fuel_products` | 178 | W | add, update, delete a product | name, carbsG, sodiumMg, caffeineMg, fluidMl | 100 products | no |
| `get_race_plan` | 212 | R | `getRacePlan`: inputs, timeline, pacing per leg, fuel schedule, caffeine, race morning (`:216`) | raceId (default: next A race) | half or full triathlon only (`:226`) | - |
| `update_race_plan` | 236 | W | `saveRacePlan` | raceId, startTime, swim/bike/run minutes, t1, t2, swimOffsetSecondsPer100m, fuelIntervalMinutes 15 or 20, caffeine, raceTemperatureC, notes | expectedVersion after the first save (`:255`) | yes |

#### `T/athlete-profile.ts`

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `get_athlete_profile` | 98 | R | thresholds (current per kind, age, stale after 8 weeks), warnings, history, Garmin suggestions; with endurance also profile, race, injuries, sick periods with return rule, strength default and table, interview state (`:111-177`) | history, includePast | endurance part only with the flag (`:124`); Garmin suggestions only with Garmin (`:104`) | - |
| `manage_thresholds` | 184 | W | add, update, delete a threshold row | kind (ftp, lthr_bike, lthr_run, max_hr, run_threshold_pace, swim_css), watts or bpm or paceSecondsPerKm or paceSecondsPer100m, measuredOn, source (manual, test, garmin), protocol, testData, notes | every user (`:6`); a test value is computed by the server (`:190`) | yes |
| `manage_athlete_profile` | 259 | W | `saveAthleteProfile` | enduranceLevel, availableDays, hoursPerWeek 1-40, longestDayMinutes 30-720, longDay, strengthGoal, completeInterview | endurance | yes |
| `manage_injuries` | 291 | W | add, update, resolve, delete an injury | area, side, description (500), avoid (300), status (active, managed, past), startedOn, endedOn | endurance | yes |
| Prompt `intake_interview` | 349 | - | returns the 8 interview steps as text (`:84-93`) | none | text says the interview is off without endurance (`:362`) | - |

#### `T/coach-memory.ts`

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `get_coach_memory` | 17 | R | `listCoachMemory`: id, kind, text, date, active, version, lastWrittenBy | includeInactive | - | - |
| `manage_coach_memory` | 45 | W | add, update, deactivate, activate, delete | kind (preference, limit, observation, decision), text, date | 200 entries, 1000 characters | yes |

#### `T/exercises.ts`

| Tool | Line | R/W | Reads or writes | Key parameters | Limits, flags | Rev |
|---|---|---|---|---|---|---|
| `search_exercises` | 42 | R | `exercises` (built-in and the user's own) | query, category, discipline, muscleGroup, equipment, limit | 50 | - |
| `create_exercise` | 86 | W | `createCustomExerciseFor` | name, category, discipline (swim, bike, run), isTimed, bodyArea, muscleGroup, equipment, movementPattern, exerciseType | name must be new (`:90`) | no |

#### `T/garmin.ts` (Garmin flag only, all read only)

| Tool | Line | Reads | Returns |
|---|---|---|---|
| `get_garmin_status` | 35 | `getOverviewData`, `getVolumeData`, `getLoadSeries`, `getSessionInsights`, `getRaceProjection`, `readinessSwapFor` (`:45-47`) | readiness score, band, contributors; body signals (value, date, normal band, state); fitness, fatigue, form; this week's hours per sport and planned hours; race, phase, projection; demands checklist; insights; readinessSwap (`:49-70`) |
| `get_garmin_trends` | 77 | `getTrendsData` | weekly FTP, CP, critical speed, LTHR run and bike, watch LTHR; VO2 max (app, Garmin run, Garmin bike); best 5 min, 20 min, 1 h power and run speed (`:94-105`) |
| `list_garmin_activities` | 112 | `getActivitiesData` | id, date, sport, name, durationMin, distanceKm, load, avgHr (`:123-132`) |
| `get_garmin_activity` | 140 | `getActivityDetail` | verdict, duration, distance, avgHr, load and method, intensity seconds, decoupling, best efforts, laps (time, distance, avgHr, avgPower), fuel (`:152-167`) |

The file header states: derived numbers only, no raw streams, no GPS, no clock times of day (`:3-4`).

### 6.5 Resources

Declared in `src/lib/mcp/resource-docs.ts:9-34`. Served as `text/markdown` with a version line `<date>+<hash>` on top (`src/lib/mcp/resources.ts:21`, `:29-38`). Read once per process (`resources.ts:51-58`).

| Name | URI | Source file | Content |
|---|---|---|---|
| `endurance-training-reference` | `logeverylift://docs/endurance-training-reference` | `docs/research/endurance-training-reference.md` | Training rules with an evidence label on each (`resource-docs.ts:15-16`) |
| `app-rules` | `logeverylift://docs/app-rules` | `docs/mcp/app-rules.md` (284 lines) | The data model, who owns which field (`:177`), limits of the app (`:192`), not in the app yet (`:272`), access (`:280`) |
| `workout-steps` | `logeverylift://docs/workout-steps` | `docs/mcp/workout-steps.md` (196 lines) | JSON shape of a workout, targets table (`:50-67`), swims (`:74`), examples, common errors |

Targets in `workout-steps.md:57-67`: power (% FTP 30-200, zone 1-5, or watts), hr (% LTHR 50-110 or zone, % max HR, or bpm), pace (% threshold speed for run, % CSS or offset seconds per 100 m for swim, or m/s), cadence (rpm, bike and run).

### 6.6 What `instructions.ts` tells the AI

Sent as the server instructions on every connection, in this order: app, owners, limits, revisions, missing, access, review, resources (`src/lib/mcp/instructions.ts:64-67`).

App section (`:19-36`):

- The app is a training log, strength first, with endurance sessions too (`:19`).
- Programs hold exercises with planned sets: reps or rep range, weight, rest; or duration, distance and HR zone (`:20`).
- Cycles run programs by weekday (up to 3 slots a day) or as a rotation, with a periodization curve and a weekly sync (`:21`).
- Seasons sit above cycles. Phases are cycles with a phase type. Races have priority A, B, C. The app never reshapes phases. The AI re-plans and clears the flag (`:22`).
- `takeStart=true` needs the user's yes first (`:22`).
- Dated sessions: one per slot for the whole block. Each can be moved, skipped or changed. A template edit rewrites untouched ones from this week's Monday. Rotation sessions can only be skipped, unskipped or changed (`:23`).
- Structured workouts need endurance. A session runs a program or a workout, never both. A brick is two sessions on one day linked by `link_brick`. The weekly sync never changes a workout. Read the step doc before the first workout write (`:24`).
- Planned vs done: an endurance session is matched to a logged workout of its sport, or for admins a Garmin activity of that day. A past one with no match is `unconfirmed`. A missed easy session is skipped. A missed key session gets `suggestedMoveTo`. "Never stack sessions." (`:25`).
- Training load: Garmin series when present, else app sessions. Never added. No RPE and no threshold means no load. The models are inference and the AI must say so (`:26`).
- Fueling and race day: numbers are guides with evidence labels and not medical advice. Hard caps: 90 g/h without a proved higher tolerance, 120 g/h ever, fluid not above sweat rate, sodium not above 1,000 mg/h. Pacing is never a finish prediction (`:27`).
- Sick periods: after one, give the IOC 2022 return rule. Do not plan intensity until the athlete reports a normal test. Change the plan only when the user asks (`:28`).
- Exercises: search or create; set discipline on an endurance exercise (`:29`).
- Workout sessions: the AI can read them, log one (`log_session`) and mark a planned day done (`confirm_session`). It cannot edit or delete a session (`:30`).
- Thresholds are for every user. The athlete profile is endurance only (`:32-33`).
- Strength in an endurance plan follows the strength goal; the default count can be changed only with a reason (`:34`).
- Coach memory is kept between conversations and the user sees and edits it (`:35`).
- Settings: time zone decides "today"; every tool value is metric; `enduranceEnabled` is set by an admin only (`:36`).

Owners section (`:38`): the progression engine owns target reps and weight on strength sets. The weekly sync owns distance and duration on sets with a peak anchor, and zone and rest on "work" sets with a peak anchor. For a lighter or harder week use `set_volume`.

Limits section (`:40`): six limits, each with its rule. A refused write changes nothing. Resend with `overrideLimits` and `overrideReason`; the user sees the reason. Restores and the app's own writes are never refused; they carry warnings. On a low-readiness morning `readinessSwap` shows on today's hard session; apply it "when the athlete agrees".

Revisions section (`:42`): every change is a revision. Every write takes a reason and `expectedVersion`. Writes within 30 minutes form one change set. A restore never changes logged workouts.

Missing section (`:44-46`): "Strength frequency by phase is a default only; no code refuses another count yet." "The app has no step editor for workouts and no guided player yet."

Access line (`:59-62`): read-only connections give advice only. Write connections "Change only what the user asks for."

Weekly review (`:48-54`): 1. Read coach memory, seasons, athlete profile, profile, active cycle, planned sessions of last and coming weeks, `recent_workouts`, `weekly_volume`, `personal_records`, and the Garmin tools if listed. 2. Compare week and plan. 3. Report in short points with the rules cited. 4. Propose changes with a reason each; apply only what the user asks for. 5. After each write, say what changed. 6. Save each agreed change as a decision entry in coach memory.

Resources line (`:56`): read the rules before the first change in a conversation.

### 6.7 Per training type

Strength

- Plan and change: `create_program`, `edit_program_exercise` (reps, weight, RIR, rest, progression axes, `T/programs.ts:293-306`), `edit_cycle_slot` programId, `manage_planned_session` add, change, move, skip, reset.
- Read and log: `recent_workouts`, `exercise_history`, `personal_records`, `weekly_volume`, `summary_stats`, `list_planned_sessions`, `get_compliance` (key `strength`, `T/workouts-compliance.ts:313`), `log_session`, `confirm_session`.

Run

- Plan, path A (program sets, every user): a set takes durationSeconds, distanceMeters, targetHeartRateZone 1-5, inclinePercent 0-30, sessionRole `work`, restTimeSeconds (`T/programs.ts:92-98`). No pace, bpm or cadence field (`T/programs.ts:81-100`).
- Plan, path B (structured workout, endurance flag): `manage_workout` create, then `manage_planned_session` set_workout or add with workout or workoutId (`T/planned-sessions.ts:127`), or `edit_cycle_slot` workoutId on a weekday slot (`T/cycles.ts:409`). Targets: pace as % of threshold speed or m/s, HR as % LTHR, zone, % max HR or bpm, cadence in rpm (`docs/mcp/workout-steps.md:59-65`).
- Limits on the write: `long_run_cap` applies to runs only (`instructions.ts:40`). The app finds runs by the exercise discipline (`T/exercises.ts:90`).
- Read before: `get_workout` gives each step target in the user's numbers, the estimate, missingAnchors and plannedLoad (`T/workouts-compliance.ts:77`). `list_planned_sessions` gives sport, priority, hard, workoutSummary, planned duration and distance, plannedLoad (`T/planned-sessions.ts:50`).
- Read after: `list_planned_sessions` state, matchedBy, ratio, band, done, load with method `run_pace` or `srpe` (`T/planned-sessions.ts:50`). `get_step_results` per step (`T/endurance-app.ts:79`). `get_training_load` (`T/endurance-app.ts:45-48`). `recent_workouts` sets with distance, duration, HR zone, RPE (`T/workouts.ts:54-67`). With Garmin: `list_garmin_activities`, `get_garmin_activity` (laps, decoupling, best run speed, `T/garmin.ts:152-167`), `get_garmin_trends` critical speed and run LTHR (`T/garmin.ts:95`).
- Answer after: `confirm_planned_session` done with time, distance, RPE; or a Garmin activity id (Garmin flag); or missed (`T/workouts-compliance.ts:174-176`). `log_step_results` (`T/endurance-app.ts:120-123`). `log_session` with sets (`T/sessions.ts:71-74`). `confirm_session` refuses an endurance program when endurance is on (`T/sessions.ts:200-204`).
- Change: set_workout, clear_workout, update_from_library, set_priority, move, skip, unskip, reset (`T/planned-sessions.ts:121-127`). Path A volume for one week: `manage_training_cycle` set_volume 50-110 % (`T/cycles.ts:144`). The weekly sync never changes a workout (`instructions.ts:24`).

Bike

- Plan, path A: the same set fields as run. HR zone is the only intensity field (`T/programs.ts:92-96`).
- Plan, path B: the same tools as run. Targets: power as % FTP (30-200), power zone 1-5 or watts; HR; cadence (`docs/mcp/workout-steps.md:59-65`).
- Limits: `long_run_cap` does not apply. `hard_sessions_per_week`, `hard_after_low_readiness`, `heavy_legs_before_key` (key bike or run) and `weekly_load_ramp` apply (`instructions.ts:40`).
- Read before and after: the same tools as run. `get_training_load` lists the app methods run_pace, swim_css, srpe and strength_srpe; no power method for app sessions is named (`T/endurance-app.ts:47`). With Garmin: `get_garmin_activity` laps with avgPower and best power efforts (`T/garmin.ts:164-165`), `get_garmin_trends` FTP, CP and bike LTHR by week and best 5 min, 20 min, 1 h power (`T/garmin.ts:95`, `:102`).
- Answer and change: the same as run. A step result `value` is in watts for a power target (`T/endurance-app.ts:34`).

Swim

- Plan, path A: the same set fields (duration, distance, HR zone).
- Plan, path B: the same tools. Targets: pace as % of CSS speed, or an offset in seconds per 100 m from CSS pace; HR by % max HR or bpm (`docs/mcp/workout-steps.md:62-64`). Pool rule: every distance is a whole number of lengths. A send-off workout sets `sendOffSeconds` and has no rest step in that repeat (`workout-steps.md:74-78`). Power, LTHR-based HR and cadence are not listed for swim (`workout-steps.md:59-65`).
- Threshold: `swim_css` through `manage_thresholds` paceSecondsPer100m (`T/athlete-profile.ts:189`).
- Read after: the same tools. App load method `swim_css` (`T/endurance-app.ts:47`). `get_garmin_trends` returns no swim value (`T/garmin.ts:94-105`).
- The pool view (`/planned/[id]/pool`) has no MCP tool. No tool file names it.
- Answer and change: the same as run.

Brick days

- A brick is two sessions on one day, the run linked to the ride (`instructions.ts:24`).
- Plan on the template: `edit_cycle_slot` brickWithNext true on the ride slot, weekday cycle, endurance flag (`T/cycles.ts:409`). A day holds up to 3 slots (`T/cycles.ts:408`).
- Plan on a date: `manage_planned_session` link_brick with brickParentId (the ride, same day, earlier position), or add with brickParentId (`T/planned-sessions.ts:127`).
- Read: `list_planned_sessions` returns brickParentId on the run (`T/planned-sessions.ts:86`). Each session has its own state, band and load. No tool returns one combined result for the brick.
- Change: unlink_brick. A move of the first session moves the brick. The later session cannot move alone (`T/planned-sessions.ts:127`).
- Answer: each session is answered alone with `confirm_planned_session` (one plannedSessionId per call, `T/workouts-compliance.ts:181`).
- Path A brick: one program with a bike and a run exercise is possible through `edit_program_exercise`. It is one session, with no brick link (`T/programs.ts:293-303`).

Rest and recovery days

- Plan: `edit_cycle_slot` upsert on a day with no programId and no workoutId. "A rest day is the only slot of its day" (`T/cycles.ts:408`). A label and notes can be set (`T/cycles.ts:425-427`).
- No tool has a "rest" or "recovery" session type. `manage_planned_session` add needs a programId, a workout or a workoutId (`T/planned-sessions.ts:183`).
- A recovery session is a normal session: a program or a workout with easy targets, and priority `optional` or `support` (`T/planned-sessions.ts:136`).
- Recovery weeks: the cycle's `athleteLevel` sets a recovery week every 3rd or 4th week (`T/cycles.ts:141`). `set_volume` lowers one week to 50 % at the least (`T/cycles.ts:55`). Phase types `taper` and `transition` lower the curve (`T/seasons.ts:176`). Cycle `endAction` can be `deload` or `rest` (`T/cycles.ts:51`).
- Readiness: `get_garmin_status` gives readiness, sleep, HRV, resting HR and body battery against the user's normal (Garmin flag, `T/garmin.ts:39`, `:51-52`). `readinessSwap` shows on today's hard session in `list_planned_sessions` and `get_garmin_status`; `apply_readiness_swap` makes it easy (`T/planned-sessions.ts:51`, `:128`; `T/garmin.ts:69`). It applies to today only.
- Sick days: `manage_illness`. Sessions inside read as missed by illness and the plan does not change by itself (`T/workouts-compliance.ts:226`).
- Skip: `manage_planned_session` skip with skipReason (`T/planned-sessions.ts:121`). A skip before the session's day is a plan change and is not counted in compliance (`T/workouts-compliance.ts:292`).
- `recent_workouts` returns the `readiness` and `feeling` the user logged with a session (`T/workouts.ts:134-135`). No tool writes a rest-day note or a day-level readiness answer.

### 6.8 MCP facts that look like gaps

Facts only.

1. `instructions.ts:46` says the app has "no guided player yet". The route `src/app/planned/[id]/play/page.tsx:7-12` renders `GuidedPlayer`, and `T/endurance-app.ts:3-4` says "The guided player has no tool: it is a device screen".
2. `docs/mcp/app-rules.md:276-279` says the guided player is not in the app and that a workout session does not show on the home today card. `src/components/features/home/widgets/endurance-today/View.tsx:1-19` renders `EnduranceTodayCard`.
3. `instructions.ts:45` says "no code refuses another count yet" for strength frequency. The limits section of the same file lists `strength_per_week` as a checked limit that needs an override (`instructions.ts:40`; rule list `src/lib/utils/training-limits.ts:18-25`).
4. `log_fuel` tells the AI to take `workoutSessionId` "from recent_workouts" (`T/nutrition.ts:114`). `recent_workouts` returns no session id (`T/workouts.ts:126-138`). `list_planned_sessions` returns `loggedSessionId` for linked sessions (`T/planned-sessions.ts:49`).
5. No tool edits or deletes a logged session or a logged set (`instructions.ts:30`, `T/sessions.ts:74`).
6. `confirm_session` cannot confirm a session that runs a workout: it needs a programId (`T/sessions.ts:184`). With endurance on it also refuses every endurance program (`T/sessions.ts:200-204`).
7. All Garmin reads are gated by env key plus admin role (`src/lib/garmin/access.ts:15-17`, `route.ts:134`). Without it the AI has no tool for readiness, sleep, HRV, resting HR, body battery, VO2 max or Garmin activities.
8. Sleep and HRV reach the AI only as today's value with a normal band and state inside `get_garmin_status` (`T/garmin.ts:52`). No tool returns a day-by-day series of sleep, HRV or resting HR.
9. `get_garmin_activity` returns no streams and no GPS (`T/garmin.ts:143`). Laps carry time, distance, avgHr and avgPower only (`T/garmin.ts:165`). No lap pace or cadence field.
10. `get_garmin_trends` has no parameters. The window is fixed at 12 weeks and 90 days (`T/garmin.ts:83-91`).
11. Workout library, `confirm_planned_session`, `manage_illness`, training load, step results, nutrition, race plan, athlete profile writes and injuries register only with the endurance flag (`route.ts:128-132`, `T/athlete-profile.ts:257`).
12. `manage_planned_session` workout, priority and brick operations need endurance (`src/lib/planned-sessions.ts:797`). `edit_cycle_slot` workoutId, priority, brickWithNext need endurance (`T/cycles.ts:483`).
13. Rotation cycles: sessions can only be skipped, unskipped or changed, by position (`T/planned-sessions.ts:159-161`). No training limit runs on them (`T/planned-sessions.ts:172`). Workouts on slots are for weekday cycles only (`T/cycles.ts:409`).
14. `planned_sessions.autoComplete` is returned by `list_planned_sessions` (`T/planned-sessions.ts:49`) but is not a parameter of `manage_planned_session` (`T/planned-sessions.ts:131-149`). It can be set only on the slot (`T/cycles.ts:428`).
15. `program_sets.peakDistanceMeters` and `peakDurationSeconds` are not set fields in the tool (`T/programs.ts:81-100`). They are re-derived from the edited distance or duration (`T/programs.ts:581-583`).
16. Program sets have no power, pace, bpm or cadence field (`T/programs.ts:81-100`). Those exist only in structured workouts (`docs/mcp/workout-steps.md:57-67`).
17. A step result holds one measured `value` per step (`T/endurance-app.ts:34`).
18. `manage_workout` has no restore operation (`T/workouts-compliance.ts:117`). A deleted workout is listed with `list_workouts deleted: true` (`:53`) and comes back through `restore_revision` (`revisions.ts:251`).
19. `log_session`, `confirm_session`, `log_step_results`, `log_fuel`, sweat tests, fuel products, `update_profile`, `manage_weight` and `create_exercise` make no revision (`T/sessions.ts:3-4`, `T/endurance-app.ts:122`, `T/nutrition.ts:4-5`). `restore_revision` cannot undo them.
20. `get_profile` returns `homeLayout` read only (`T/profile.ts:26`, `:57-60`). No tool writes it.
21. `update_profile` cannot set `enduranceEnabled` (`T/profile.ts:77`).
22. `get_race_plan` works for a half or full triathlon only (`T/nutrition.ts:216`, `:226`). `manage_race` accepts other disciplines and distances (`T/seasons.ts:310`).
23. `list_training_cycles`, `get_training_cycle`, `list_seasons`, `get_season` are marked read only but call `startDueScheduledCycle`, which can start a scheduled cycle (`T/cycles.ts:86`, `:110`; `T/seasons.ts:118`, `:155`).
24. The rate limit is per process and in memory (`rate-limit.ts:4-7`).
25. No tool reads or writes user notification settings, friends, gyms, or the in-app AI plan generator. None of the 14 tool files imports those modules (imports read in each file header).
26. The limits run on assistant writes only. The user's own edits in the app are never checked (`docs/mcp/app-rules.md:206-207`).

## 7. Data inventory

Repo `/Users/mnordbye/Documents/Code/github/logeverylift`, `main` at feafb9f. Read only. No code was run.
Paths are relative to the repo root. "MCP" names are tool names in `src/lib/mcp/tools/`.
"Explorer" is the raw data view at `/more/garmin?tab=data` (`src/app/more/garmin/page.tsx:60`,
`getGarminDay` in `src/lib/actions/garmin.ts:202-248`). It shows the stored JSON of every kind for one date.
It is a debug view, so the tables below do not count it as "shown".

### 7.0 How Garmin data comes in

- The client is read only. Nothing is written to Garmin (`docs/privacy/data-inventory.md:57`).
- A background worker ticks every 60 s (`src/lib/garmin/worker.ts:40`). One tick works on one user.
- Range endpoints, snapshots and the activity list: `syncGarmin` (`src/lib/garmin/sync.ts:274-300`). The worker
  calls it when the last sync is more than 30 min old (`worker.ts:42`, `worker.ts:120-123`). The actions
  `refreshGarmin` and `connectGarmin` also call it (`src/lib/actions/garmin.ts:38`, `:93`). The first sync
  reads 30 days back; later syncs read 3 days before the last sync (`sync.ts:37-39`, `:282`).
- Per-day endpoints: today and yesterday, at most every 30 min (`worker.ts:125-128`), plus history.
- History: chunks of 7 days going back (`worker.ts:44`, `:138-142`). It stops 90 days back for a user and
  has no floor for an admin (`worker.ts:45`, `:54-55`).
- Activity files: for each activity with no files yet, the worker gets the detail, the planned workout and
  the FIT ZIP (`sync.ts:177-182`, `worker.ts:130-137`).
- After each tick: derived metrics (`runGarminMetricsStep`, `src/lib/garmin/metrics-job.ts:295`) and the
  weight copy (`syncGarminWeight`, `src/lib/garmin/weight-sync.ts:17`) run (`worker.ts:173`, `:178`).
- Every answer is stored as returned in `garmin_days.data`, one row per user, date and kind
  (`src/db/schema/garmin.ts:67-80`, `sync.ts:77`).
- The Garmin page does not start a sync when it opens (`src/app/more/garmin/page.tsx:26-71` has no sync call).

### 7.1 Table A: Garmin endpoints (`src/lib/garmin/endpoints.ts`)

All rows are stored in `garmin_days` (`src/db/schema/garmin.ts:67`) under the kind in column 1.
All Garmin screens are behind `garminAllowed` (admin plus the encryption key, `src/lib/garmin/access.ts:15-17`).
All Garmin MCP tools are registered only when `garminAllowedFor` is true (`src/app/api/[transport]/route.ts:134`).

| Kind | Path (endpoints.ts line) | Scope | Fields parsed, and by what | MCP | Screen |
|---|---|---|---|---|---|
| `hrv` | `/hrv-service/hrv/daily/{s}/{e}` (:105-111) | range, 28 days | `lastNightAvg`, `baseline.balancedLow`, `baseline.balancedUpper` into the daily series (`metrics-job.ts:210-214`). `status`, `weeklyAvg`, `lastNight5MinHigh`, `baseline.lowUpper` in `getOverviewData` (`queries.ts:706-717`, `:779`). | `get_garmin_status` returns `body.hrv` (value, normal, state) and readiness (`mcp/tools/garmin.ts:51-52`). It does not return `hrvStatus`. | `/more/garmin` overview tab (`garmin/page.tsx:33-38`, `BodySignals.tsx:970`). |
| `sleep` | `/sleep-service/sleep/dailySleepSummariesByDate` (:112-119) | range | Start, end, `sleepTimeSeconds`, `sleepNeed.actual`, `napTimeSeconds` into the daily series (`metrics-job.ts:219-229`). `sleepScores.overall.value`, `averageRespirationValue` (`queries.ts:690-691`). Night stages, `lowestSpO2Value`, `breathingDisruptionSeverity` (`queries.ts:905-910`). 90 nights in `getSleepData` (`queries.ts:317-323`). | `get_garmin_status` returns `body.sleep`, `body.sleepScore`, `body.respiration` only (`garmin.ts:52`). No tool calls `getSleepData` (`garmin.ts:15-25`). | Overview tab; recovery tab (`garmin/page.tsx:51-53`, `GarminSleepTab.tsx`); day tab (`queries.ts:146`). |
| `daily` | `/usersummary-service/v2/dailysummaries` (:120-127) | range | Only `heartRate.restingValue`, as a fallback for resting HR (`metrics-job.ts:217-218`). | Indirect (resting HR in `get_garmin_status` body). | Indirect. |
| `steps` | `/usersummary-service/stats/steps/daily/{s}/{e}` (:128-135) | range | `totalSteps` (`queries.ts:723`, `:824`). | `get_garmin_status` `body.steps`. | Overview tab (`BodySignals.tsx:740-748`). |
| `stress` | `/usersummary-service/stats/stress/daily/{s}/{e}` (:136-143) | range | Not read. The stress tile reads `user_summary.averageStressLevel` (`queries.ts:825-828`). | none | none |
| `hydration` | `/usersummary-service/stats/hydration/daily/{s}/{e}` (:144-151) | range | Not read. | none | none |
| `weight` | `/weight-service/weight/range/{s}/{e}?includeAll=true` (:152-159) | range | `latestWeight.weight`, `.bmi`, `.bodyFat`, `.muscleMass` (`queries.ts:694-701`, `:715-720`, `:830-833`). Weight series for trends (`queries.ts:1128-1132`). | `get_garmin_status` `body.weight` and other body keys. | Overview tab, trends tab (`garmin/page.tsx:47-48`). |
| `weight_entries` | `/weight-service/weight/all/{s}/{e}` (:160-167) | range | Each weigh-in (time, kg) by `garminWeighIns` (`src/lib/garmin/weigh-ins.ts:8`). Copied into `user_weight_entry` when `sync_weight` is on (`weight-sync.ts:22-36`); `users.weightKg` is set to the newest entry (`weight-sync.ts:43-49`). | `get_profile` returns the last 50 weight entries (`mcp/tools/profile.ts:37-42`, `:58-62`). | Account page toggle "Sync weight from Garmin" (`AccountClient.tsx:427`). |
| `weight_goal` | `/goal-service/goal/user/effective/weightgoal/{s}/{e}` (:168-176) | range, stored under the last day when a goal is set | Not read. | none | none |
| `wellness_activity` | `/wellnessactivity-service/activity/summary/range/{s}/{e}` (:177-184) | range | Not read. | none | none |
| `body_battery` | `/wellness-service/wellness/bodyBattery/reports/daily` (:185-192) | range | Day curve and events by `bodyBatteryDay` (`queries.ts:268`). | none (the status tool gives `body.bodyBattery` from `user_summary`, `queries.ts:692`). | Day tab (`GarminTodayTab.tsx:365-367`). |
| `hrv_detail` | `/hrv-service/hrv/{d}` (:193) | day | `hrvReadings` for the night curve (`queries.ts:184`). | none | Day tab. |
| `sleep_detail` | `/sleep-service/sleep/dailySleep?date={d}` (:194) | day | Not read. | none | none |
| `heart_rate` | `/wellness-service/wellness/dailyHeartRate?date={d}` (:195-201) | day | `heartRateValues` (all-day curve, `queries.ts:163`), `restingHeartRate` (`queries.ts:271`, `metrics-job.ts:215-216`). | Resting HR only, in `get_garmin_status` body. | Day tab; overview tab (resting HR). |
| `spo2` | `/wellness-service/wellness/daily/spo2acclimation/{d}` (:202) | day | `spO2HourlyAverages` (`queries.ts:175`), `lastSevenDaysAvgSpO2` (`queries.ts:916-921`). | none | Day tab; overview night card (`BodySignals.tsx:670`). |
| `user_summary` | `/usersummary-service/usersummary/daily?calendarDate={d}` (:203) | day | Steps, active kcal, intensity minutes, stress durations and average, body battery high, low, at wake, charged, drained, waking respiration (`queries.ts:242`, `:272-288`). Step goal, floor goal, BMR (`queries.ts:784-786`). Sedentary time, floors, distance, active time (`queries.ts:829-840`). | `get_garmin_status` body keys only. | Day tab; overview tab (`BodySignals.tsx:986`). |
| `fitness_age` | `/fitnessage-service/fitnessage/v2/{d}` (:204) | day | Fitness age by `parseFitnessAge`, `chronologicalAge` (`queries.ts:693`, `:712`, `:1134-1143`). | `get_garmin_status` `body.fitnessAge`. | Overview tab; trends tab. |
| `food` | `/nutrition-service/food/logs/{d}` (:205-214) | day | Not read. | none | none |
| `menstrual_summary` | `/periodichealth-service/menstrualcycle/summary/{d}` (:215) | day | Not read. | none | none |
| `menstrual_day` | `/periodichealth-service/menstrualcycle/dayview/{d}` (:216-221) | day | Not read. | none | none |
| `profile` | `/userprofile-service/userprofile/settings` (:222) | snapshot, stored under the fetch date | Only `timeZone`, for "today" in Garmin code (`src/lib/garmin/today.ts:11-18`). | none | none |
| `hr_zones` | `/biometric-service/heartRateZones/v2` (:223) | snapshot | The newest row goes into activity metrics (`metrics-job.ts:120-125`). `snapshotZones` accepts `CYCLING` or `DEFAULT` (`analytics/thresholds.ts:30`). It gives LTHR and zone floors (`analytics/thresholds.ts:47-52`, `analytics/activity.ts:57`, `:73`, `:106`). | Indirect: LTHR in `get_garmin_trends` (`garmin.ts:95`), threshold suggestions in `get_athlete_profile` (`athlete-profile.ts:113`). The zone floors in bpm are not returned. | Indirect (activity bands, trends). No screen lists the zones of the snapshot. |

Activities (not in `endpoints.ts`, own pipeline):

| Source | Call | Stored | Parsed, and by what | MCP | Screen |
|---|---|---|---|---|---|
| Activity list | `fetchActivityList` (`client.ts:121`, called at `sync.ts:141-143`) | `garmin_activities.data`, GPS fields removed by `stripActivityLocation` (`sync.ts:153`, `schema/garmin.ts:82-106`) | Name, type, duration, distance, average HR (`queries.ts:520-521`, `session-compliance.ts:207-224`). | `list_garmin_activities` (`garmin.ts:113`, limit 1-100, default 20) | Activities tab (`garmin/page.tsx:49-50`). |
| Activity detail | `/activity-service/activity/{id}` (`sync.ts:180`) | `garmin_activities.detail` | `summaryDTO`: stamina start, end, min (`queries.ts:480`, `:532-538`); `averageTemperature` (`queries.ts:1226`). | `get_garmin_activity` does not return stamina or `dto` (`garmin.ts:152-167`). | `/more/garmin/activity/[id]` (`GarminActivityView.tsx`). |
| Planned workout of the activity | `/activity-service/activity/{id}/workouts` (`sync.ts:181`) | `garmin_activities.workouts` | Not read by any query. Only the raw view returns it (`actions/garmin.ts:371`). | none | none |
| FIT file | `/download-service/files/activity/{id}` (`sync.ts:182`) | `garmin_activity_files.zip` (`schema/garmin.ts:131-145`) | Parsed by `parseFit` (`src/lib/garmin/fit.ts:92`). Kept so a new parser version can parse again (`metrics-job.ts:43-49`). Left out of the export (`account-data.ts:132`). | none | none |

FIT decoding (`src/lib/garmin/fit.ts`, parser version 3 at `:11`), stored in `garmin_activity_streams` (`schema/garmin.ts:147-170`):

| Part | What `fit.ts` keeps | Where it is used | MCP | Screen |
|---|---|---|---|---|
| `streams` | Per record: `t`, `hr`, `power`, `cadence`, `speed`, `altitude`, `distance`, `temperature`, `lat`, `lng`, `verticalOscillation`, `groundContactTime`, `stepLength`, `respirationRate` (`fit.ts:14-28`, `:111-122`) | Activity metrics: load, bands, efforts, decoupling (`metrics-job.ts:126-141`). Activity page charts, cut to a point limit (`queries.ts:494-495`). Mean temperature for the race page (`queries.ts:1176`, `:1226`). | No raw streams (`garmin.ts:143`). Derived only: `intensitySeconds`, `decoupling`, `bestEfforts` (`garmin.ts:162-164`). | `/more/garmin/activity/[id]`. |
| `laps` | All `lapMesgs` fields (`fit.ts:134`) | `getActivityDetail` (`queries.ts:524`); lap rows in `charts/activity.ts:205`, `:290`. | `get_garmin_activity` returns per lap: `timeS`, `distanceM`, `avgHr`, `avgPower` (`garmin.ts:165`). No lap pace, cadence or max HR. | Laps card (`GarminActivityView.tsx:358-371`). |
| `sets` | `setMesgs` (strength sets from the watch, `fit.ts:135`) | Returned by `getActivityDetail` (`queries.ts:525`). | Not returned by `get_garmin_activity` (`garmin.ts:152-167`). | Activity page links a strength activity to its app session (`GarminActivityView.tsx:397-401`). |
| `timeInZone` | `timeInZoneMesgs` (`fit.ts:136`). Holds `hrZoneHighBoundary` and `functionalThresholdPower`. | Thresholds per activity (`analytics/thresholds.ts:43`, `analytics/activity.ts:54`). `hrZoneFloors` for the activity page (`queries.ts:513`, `:526`). | Not returned as zone floors. | Activity page. |
| `session` | The session message plus `garminVo2Max`, `garminVo2MaxUpdated` from message 140 (`fit.ts:67-74`, `:137`) | VO2 max series (`queries.ts:662-668`, `:1118-1124`). | `get_garmin_trends` `vo2max.garminRunning`, `.garminCycling` (`garmin.ts:96-100`). | Overview and trends tabs. |
| `lengths` | Pool lengths: time, strokes, stroke type (`fit.ts:47`, `:138`) | Written only (`sync.ts:204`, `metrics-job.ts:79`). No reader in `src`. | none | none |
| `events` | Timer start and stop events (`fit.ts:49`, `:139`) | Written only (`sync.ts:205`, `metrics-job.ts:80`). No reader in `src`. | none | none |

Derived Garmin tables:

| Table | Filled by | Read by | MCP | Screen |
|---|---|---|---|---|
| `garmin_activity_metrics` (`schema/garmin.ts:173-195`) | `computeActivities` (`metrics-job.ts:117-157`) | `getActivityDetail`, `getTrendsData`, `buildDaily` | `get_garmin_activity`, `get_garmin_trends`, `list_garmin_activities` (load) | Activity page, activities tab, trends tab |
| `garmin_daily_metrics` (`schema/garmin.ts:198-211`) | `buildDaily` (`metrics-job.ts:245-290`). Inputs: Garmin activities, strength sessions, app endurance sessions with no Garmin activity, HRV, sleep, resting HR, and the logged readiness per day (`metrics-job.ts:235-243`, `:253-266`). | `getTodayData`, `getOverviewData`, `getLoadSeries`, `getTrainingLoad` (`src/lib/training-load.ts:158-169`), home readiness widget (`home/widgets/garmin-readiness/load.ts:31`) | `get_garmin_status` (readiness, fitness, fatigue, form), `get_training_load` (`mcp/tools/endurance-app.ts:42-55`) | Overview, day, training tabs; `/week` load card (`src/app/week/page.tsx:50`, `:99-133`); home widgets |
| `garmin_sync_runs` (`schema/garmin.ts:108-129`) | `startRun`, `finishRun` (`sync.ts:229`, `:237`); latest 200 kept (`sync.ts:41`) | Explorer only | none | Explorer |
| `garmin_fuel_logs` (`schema/garmin.ts:218-231`) | Not written any more (`docs/privacy/data-inventory.md:29`) | Export and delete only (`account-data.ts:139`, `garmin/delete-data.ts:31`) | none | none |
| `garmin_connections` (`schema/garmin.ts:34-65`) | `connectGarmin`, `disconnectGarmin` (`actions/garmin.ts:93`, `:131`), `setGarminWeightSync` (`:69`) | Worker, sync | none | Settings row (`SettingsClient.tsx:339`, `GarminSettingsRow.tsx:27`, `:46`) |

### 7.2 Table B: app data

Full depth for endurance data. One short row for strength-only data.

| Data | Table (file:line) | Written by | MCP read | MCP write | Screens |
|---|---|---|---|---|---|
| Thresholds: `ftp`, `lthr_bike`, `lthr_run`, `run_threshold_pace`, `swim_css`, `max_hr` | `athlete_thresholds` (`src/db/schema/athlete-profile.ts:27`, `:88-111`). One row per value with date, source (`manual`, `test`, `garmin`), protocol and test inputs. | `addThresholdValue`, `updateThresholdValue`, `deleteThresholdValue`, `restoreThresholdValue` (`src/lib/actions/athlete-profile.ts:160-209`) through `addThreshold`, `changeThreshold` (`src/lib/athlete-profile.ts:366`, `:396`). Not written by any job. | `get_athlete_profile` for every user: current value per kind, age in weeks, stale flag, `history`, `garminSuggestions` (`mcp/tools/athlete-profile.ts:99-123`) | `manage_thresholds` (`athlete-profile.ts:185`) | `/more/thresholds` for every user (`src/app/more/thresholds/page.tsx:9-33`). Used to resolve targets on `/planned/[id]` (`src/lib/planned-view.ts:71-80`), `/planned/[id]/pool` (`pool/page.tsx:20`) and `/week` (`week/page.tsx:48`, `:68`). `/planned/[id]` links to the thresholds page when a value is missing (`planned/[id]/page.tsx:54`). |
| Garmin threshold estimates | Not stored. `garminSuggestions` works them out from `getTrendsData` (`src/lib/athlete-profile.ts:220-252`). No swim CSS estimate (`:218`). | none | `get_athlete_profile.garminSuggestions`; `get_garmin_trends.thresholdsByWeek` | Taken with `manage_thresholds` | `/more/thresholds` suggestions (`thresholds/page.tsx:30`) |
| Athlete profile: endurance level, available days, hours per week, longest day, long day, strength goal | `athlete_profiles` (`schema/athlete-profile.ts:63-86`) | `saveProfile` (`actions/athlete-profile.ts:125`) through `saveAthleteProfile` (`src/lib/athlete-profile.ts:271`) | `get_athlete_profile.profile`, endurance only (`mcp/tools/athlete-profile.ts:124`, `:136-147`) | `manage_athlete_profile` (`:260`) | `/more/athlete` (endurance only, `actions/athlete-profile.ts:88`, `src/app/more/athlete/page.tsx:16-17`) |
| Athlete interview | `athlete_profiles.interviewCompletedAt` (`schema/athlete-profile.ts:78`) | `finishInterview` (`actions/athlete-profile.ts:142`); `moveMemoryToProfile` (`:301`) | `get_athlete_profile.interview` (complete, missing steps, memory to offer, `mcp/tools/athlete-profile.ts:172-176`). MCP prompt `intake_interview` (`:349-365`). | `manage_athlete_profile` | `/more/athlete/interview` (`src/app/more/athlete/interview/page.tsx`, `InterviewClient.tsx`) |
| Injuries | `athlete_injuries` (`schema/athlete-profile.ts:113-134`) | `addInjuryEntry` ... `restoreInjuryEntry` (`actions/athlete-profile.ts:227-282`) | `get_athlete_profile.injuries` (`mcp/tools/athlete-profile.ts:149-159`) | `manage_injuries` (`:292`) | `/more/athlete` (`athlete/page.tsx:42-56`) |
| Seasons | `seasons` (`src/db/schema/seasons.ts:26-52`), with the re-plan flag (`:38-44`) | `src/lib/actions/seasons.ts:75-227` | `list_seasons`, `get_season` (`mcp/tools/seasons.ts:109`, `:143`) | `manage_season` (`:166`) | `/seasons`, `/seasons/[id]` (`SeasonDetailClient.tsx`) |
| Races | `season_races` (`schema/seasons.ts:54-75`). Also `training_cycles.raceDate`, `raceDistance` for a cycle in no season (`schema/training-cycles.ts:71-73`). | `addRaceAction`, `updateRaceAction`, `removeRaceAction` (`actions/seasons.ts:134-154`); needs endurance (`src/lib/seasons.ts:330`, `:443`) | `get_season`; `get_athlete_profile.race` (`mcp/tools/athlete-profile.ts:148`) | `manage_race` (`seasons.ts:306`) | `/seasons/[id]` (races shown with endurance or when a race exists, `SeasonDetailClient.tsx:178`); race countdown widget (endurance, `src/lib/home/widgets/race-countdown.ts:14`) |
| Race-day plans | `race_plans.plan` jsonb, inputs only (`src/db/schema/nutrition.ts:97-120`). Targets, pacing and the fuel schedule are worked out on read (`docs/privacy/data-inventory.md:25`). Half and full distance triathlon only (`src/lib/race-plans.ts:23`). | `saveRacePlanAction` (`src/lib/actions/nutrition.ts:120`) through `saveRacePlan` (`race-plans.ts:171`) | `get_race_plan` (`mcp/tools/nutrition.ts:213`) | `update_race_plan` (`:237`) | `/races/[id]/plan` (endurance only, `src/app/races/[id]/plan/page.tsx:18-19`); race list on `/more/nutrition` (`nutrition/page.tsx:25`, `:50`) |
| Cycles and phases | `training_cycles` (`schema/training-cycles.ts:35-107`), with `adaptationPct`, `adaptationNote`, `lastSyncedWeek`, `phaseType` | `src/lib/actions/training-cycles.ts:600-939`; weekly sync (`src/lib/periodization-sync.ts:47`, `:246`); `applyWearableSuggestion` (`:437`) | `list_training_cycles`, `get_training_cycle` (`mcp/tools/cycles.ts:76`, `:101`) | `manage_training_cycle` incl. `set_volume` (`:135`, `:144`) | `/cycles`, `/cycles/[id]`, `/cycles/[id]/template`, `/seasons/[id]/phases/[cycleId]/week` |
| Cycle slots | `training_cycle_slots` (`schema/training-cycles.ts:116-145`): program or `workoutId`, `autoComplete`, `daySlot`, `priority`, `brickWithNext` | `upsertCycleSlot`, `removeCycleSlot`, `reorderCycleSlots` (`actions/training-cycles.ts:838-904`). `priority` and `brickWithNext` need endurance (`:865`). | `get_training_cycle` | `edit_cycle_slot` (`cycles.ts:404`; workout fields need endurance, `:483`) | `CycleScheduleBuilder.tsx` (key border, auto, brick only with endurance, `:484`, `:520-522`) |
| Programs, exercises, sets | `programs`, `program_exercises`, `program_sets` (`src/db/schema/programs.ts:30`, `:58`, `:152`). Endurance set fields: `durationSeconds`, `distanceMeters`, `peakDistanceMeters`, `peakDurationSeconds`, `inclinePercent`, `targetHeartRateZone` (`:170-186`). | `src/lib/actions/programs.ts`; weekly sync; progression | `list_programs`, `get_program` (`mcp/tools/programs.ts:169`, `:191`) | `create_program`, `update_program`, `delete_program`, `edit_program_exercise` (`:222-293`) | `/programs`, `/programs/[id]` |
| Planned sessions | `planned_sessions` (`src/db/schema/planned-sessions.ts:26-89`): date, position, program or `workout` jsonb, `workoutId`, `priority`, `brickParentId`, `garminActivityId`, status, `skipReason`, `missedReason`, `statusOn`, `touchedAt` | `updatePlannedSession`, `updateRotationSession` (`src/lib/actions/planned-sessions.ts:40`, `:66`); template regeneration and the ops in `src/lib/planned-sessions.ts` (skip `:1012`, miss `:1054`, pick `:1060-1079`) | `list_planned_sessions` (`mcp/tools/planned-sessions.ts:43`) | `manage_planned_session` (`:117`), `confirm_planned_session` (`mcp/tools/workouts-compliance.ts:170`) | Home (`src/lib/home/core.ts:54`), `/week`, `/more/calendar`, `/cycles/[id]`, `/planned/[id]` (endurance only, `planned/[id]/page.tsx:24`) |
| Workout library | `workouts` (`src/db/schema/workouts.ts:16-34`): name, sport (swim, bike, run), steps jsonb, default priority | `manageWorkout` (`src/lib/actions/workouts-compliance.ts:80`) through `src/lib/workouts.ts:131-196` | `list_workouts`, `get_workout` (`mcp/tools/workouts-compliance.ts:50`, `:74`), endurance only (`route.ts:128`) | `manage_workout` (`:104`) | `/more/workouts` (endurance only, `src/app/more/workouts/page.tsx:15`); library picker on `/more/calendar` (`calendar/page.tsx:96`) and `/cycles/[id]` (`cycles/[id]/page.tsx:116`) |
| Logged sessions | `workout_sessions` (`src/db/schema/workout-sessions.ts:48-88`): date, start, end, notes, `feeling`, `readiness`, `intendedDate`, `source` (app, auto, assistant), `plannedSessionId` | App logger (`src/lib/actions/workout-sessions.ts:51`, `:148`); `writeLoggedSession` (`src/lib/logged-sessions.ts:90`); auto sessions (`src/lib/auto-sessions.ts:17`) | `recent_workouts`, `summary_stats`, `weekly_volume` (`mcp/tools/workouts.ts:82`, `:276`, `:317`) | `log_session`, `confirm_session` (`mcp/tools/sessions.ts:68`, `:167`) | `/history`, `/history/[sessionId]` (`SessionDetailClient.tsx`) |
| Logged sets | `workout_sets` (`src/db/schema/workout-sets.ts:51-119`): reps, kg, `durationSeconds`, `distanceMeters`, `inclinePercent`, `heartRateZone`, `rir`, `rpe`, notes, failed, easy | `src/lib/actions/workout-sets.ts`; `writeLoggedSession` | `recent_workouts`, `exercise_history` (`workouts.ts:43-45`, `:147`) | `log_session` (sets take `heartRateZone`, `rir` or `rpe`, `sessions.ts:48-50`, `:73`) | `/history/[sessionId]` (RIR or RPE shown at `SessionDetailClient.tsx:274-277`) |
| Session answers ("did you do it?") | No table. `confirmDone` writes one `workout_sessions` row and one set with duration, distance and RPE (`src/lib/session-answers.ts:54-88`). A miss or a Garmin pick is stored on `planned_sessions` (`src/lib/planned-sessions.ts:1054`, `:1079`). | `confirmPlannedDone` (`actions/workouts-compliance.ts:32`) | `list_planned_sessions` (state, `matchedBy`, `missedReason`, `planned-sessions.ts:90-93`) | `confirm_planned_session` (`workouts-compliance.ts:170-206`) | `DidYouDoIt.tsx`, `SessionAnswers.tsx`; home notice (`home/Notices.tsx:77`) |
| Garmin activity paired to a session | `planned_sessions.garminActivityId` (`schema/planned-sessions.ts:67`). Written by op `pick` (`src/lib/planned-sessions.ts:1060-1079`, Garmin check at `:1065`). An activity can also match on read without a stored id (`src/lib/utils/session-compliance.ts:442`). | Only `confirm_planned_session` builds op `pick` (`mcp/tools/workouts-compliance.ts:206`). No client component sends it (no `"pick"` in `src/components` or `src/app`). | `list_planned_sessions.matchedBy` | `confirm_planned_session` with `garminActivityId` (`:187`) | State and band where compliance shows |
| RPE | Session RPE of an answer: `workout_sets.rpe` on the one set (`session-answers.ts:83`). Step RPE: inside `workout_step_results.steps`. Strength: `workout_sets.rir` or `rpe` (`schema/workout-sets.ts:100-106`). | See rows above | `recent_workouts`, `get_step_results` | `log_session`, `confirm_planned_session`, `log_step_results` | `/history/[sessionId]`; step RPE input in `StepResultsForm.tsx:227` |
| Step results | `workout_step_results` (`src/db/schema/step-results.ts:19-54`): source (`player`, `manual`, `assistant`, `:17`), workout as run, anchors, steps, start, finish, paused seconds | `saveStepResults` (`src/lib/step-results.ts:88`) from `saveStepResultsAction` (`src/lib/actions/step-results.ts:15`) | `get_step_results` (`mcp/tools/endurance-app.ts:76`) | `log_step_results` (`:117`) | `/planned/[id]/results` (`results/page.tsx:15`, `StepResultsForm.tsx:92`, `:188`) |
| Compliance and consistency | Not stored. `sessionCompliance` works it out on read (`src/lib/session-compliance.ts:230`; rule in `src/db/schema/planned-sessions.ts:6-7`). | none | `list_planned_sessions` (`planned-sessions.ts:62`); `get_compliance` for every user (`workouts-compliance.ts:288-303`, `route.ts:133`) | none | `/week` (`week/page.tsx:46`, `:196`), `/cycles/[id]` (`:116`), `/more/calendar` (`calendar/page.tsx:66-69`), `/planned/[id]` (`:41`), consistency line on `/more/athlete` (`athlete/page.tsx:25-30`, `:60`) |
| Training load, fitness, fatigue, form | From `garmin_daily_metrics` when the user has Garmin rows, else worked out from app sessions and not stored (`src/lib/training-load.ts:149-176`) | Garmin metrics job, or none | `get_training_load` (endurance only, `endurance-app.ts:42`, `route.ts:130`); `get_garmin_status.fitness` | none | `/week` load card (`week/page.tsx:99-145`); home training-load widget (`home/widgets/training-load/load.ts:30`, available with endurance or Garmin, `src/lib/home/widgets/training-load.ts:14`); Garmin training tab (`garmin/page.tsx:54-58`) |
| Training limits | No table. Checked on writes (`src/lib/training-limits.ts:1115`, `:1265`). The result of an assistant write is stored in `plan_revisions.limit_check` (`src/db/schema/plan-revisions.ts:58-60`). | Revision layer | `get_training_cycle` shows what the weekly sync broke (`mcp/tools/cycles.ts:125`); write tools return `limits` (`cycles.ts:364`) | Overrides on write tools | Plan history shows an override line (`PlanHistoryPage.tsx:47`). Heavy-legs notes on `/more/calendar` (`calendar/page.tsx:72`). |
| Priorities (key, support, optional) | `planned_sessions.priority` (`schema/planned-sessions.ts:63`), `training_cycle_slots.priority` (`schema/training-cycles.ts:143`), `workouts.priority` (`schema/workouts.ts:27`). Null means derived. | `upsertCycleSlot`; `manage_planned_session` | `list_planned_sessions` (`planned-sessions.ts:50`) | `manage_planned_session` `set_priority` (`:133`), `edit_cycle_slot` | `CycleScheduleBuilder.tsx:484`, `:521` (endurance only) |
| Readiness check-in (1-5, before a workout) | `workout_sessions.readiness` (`schema/workout-sessions.ts:60-62`) | `setSessionReadiness` (`actions/workout-sessions.ts:386`), asked in `WorkoutSessionClient.tsx:90` | `recent_workouts` (`workouts.ts:98`, `:135`) | none found in `log_session` schema lines read (`sessions.ts:82` has `feeling`) | Progress page (`MetricsClient.tsx:1108-1132`). Also an input of the Garmin daily series (`metrics-job.ts:235-243`). |
| Garmin readiness and the readiness swap | Not stored. `readinessToday` (`src/lib/training-limits.ts:344-349`) and `readinessSwapFor` (`src/lib/readiness-swap.ts:25`) read `garmin_daily_metrics`. Needs endurance (`readiness-swap.ts:26`) and Garmin (`training-limits.ts:345`). | `makeSessionEasy` (`src/lib/actions/readiness.ts:18`) rewrites the planned session | `get_garmin_status.readinessSwap` (`garmin.ts:69`), `list_planned_sessions.readinessSwap` (`planned-sessions.ts:99`) | `manage_planned_session` `apply_readiness_swap` (`:174`) | Home notice (`home/Notices.tsx:75`, `ReadinessSwapCard.tsx:28`); home Garmin readiness widget (`home/widgets/garmin-readiness/load.ts:19`) |
| Wearable volume suggestion | Not stored until applied. `wearableSuggestion` (`src/lib/periodization-sync.ts:416`). Applying sets `training_cycles.adaptationPct` and `adaptationNote` (`periodization-sync.ts:437`). | `applyWearablePlanSuggestion` (`actions/training-cycles.ts:1014`) | not returned as a suggestion by a tool read here | `manage_training_cycle` `set_volume` (`cycles.ts:144`) | Garmin training tab only (`garmin/page.tsx:57`, `GarminLoadTab.tsx:71`) |
| Illness | `illness_periods` (`src/db/schema/illness.ts:14-32`): start, end, severity, notes | `manageIllness` (`actions/workouts-compliance.ts:53`) through `src/lib/illness.ts:43-89` | `get_athlete_profile` (open period, last 90 days, return rule; `mcp/tools/athlete-profile.ts:125-132`, `workouts-compliance.ts:327-329`) | `manage_illness` (`workouts-compliance.ts:223`) | `/more/athlete` (`athlete/page.tsx:24`, `:59`, `AthleteProfileClient.tsx:177`); home banner (`home/Notices.tsx:73`); `SessionAnswers.tsx:156` |
| Fuel logs | `fuel_logs` (`schema/nutrition.ts:41-70`): carbs, fluid, sodium, caffeine, GI score, items, notes; linked to an app session or a Garmin activity | `saveFuelLogAction` (`actions/nutrition.ts:30`; an app-session log needs endurance, `:34`) | `get_nutrition` (`mcp/tools/nutrition.ts:49-63`); `get_garmin_activity.fuel` (`garmin.ts:166`) | `log_fuel` (`nutrition.ts:111`) | `/more/nutrition` (`nutrition/page.tsx:21-39`, `NutritionClient.tsx:189-195`); Garmin activity page (`GarminActivityView.tsx:97-101`) |
| Fuel products | `fuel_products` (`schema/nutrition.ts:22-39`) | `manageFuelProduct` (`actions/nutrition.ts:58`) | `get_nutrition` (`nutrition.ts:63`) | `manage_fuel_products` (`:179`) | `/more/nutrition` (`NutritionClient.tsx:317-323`) |
| Sweat tests | `sweat_tests` (`schema/nutrition.ts:74-95`) | `manageSweatTest` (`actions/nutrition.ts:90`) | `get_nutrition` | `manage_sweat_tests` (`:143`) | `/more/nutrition` (`nutrition/page.tsx:40-48`) |
| Body weight and weigh-ins | `user_weight_entry` (`src/db/schema/weight-history.ts:4-11`), `users.weightKg` (`schema/users.ts:38`) | `logWeightEntry`, `deleteWeightEntry` (`src/lib/actions/profile.ts:91`, `:122`); `syncGarminWeight` (`weight-sync.ts:35`) | `get_profile` (weight and last 50 entries, `mcp/tools/profile.ts:37-62`) | `manage_weight`, `update_profile` (`profile.ts:143`, `:74`) | Account page (`src/app/more/account/page.tsx`); body-weight widget (`src/lib/home/widgets/body-weight.ts:13`) |
| Coach memory | `coach_memory` (`src/db/schema/coach-memory.ts:22-43`): kind, text, date, active | `src/lib/actions/coach-memory.ts:56-97` | `get_coach_memory` (`mcp/tools/coach-memory.ts:18-27`) | `manage_coach_memory` (`:46`) | `/more/coach-memory` (`coach-memory/page.tsx:11`) |
| Plan revisions | `plan_revisions` (`schema/plan-revisions.ts:29-70`). Object types: program, cycle, memory, athlete, threshold, injury, season, planned_session, workout, illness, race_plan (`:21`). Writers: user, assistant, progression, sync, apply (`:23`). | The revision layer (`src/lib/plan-revisions.ts`) on every plan write | `list_revisions` (`src/lib/mcp/revisions.ts:206`; endurance types need the switch, `:224`) | `restore_revision` (`:248`) | `/programs/[id]/history`, `/cycles/[id]/history`, `/seasons/[id]/history` (`PlanHistoryPage.tsx`); `/more/assistants/changes` (`AssistantChangesClient.tsx`) |
| Dismissed make-ups | `dismissed_makeups` (`src/db/schema/dismissed-makeups.ts:13-28`) | `dismissMissedWorkout` (`actions/training-cycles.ts:381`, insert at `src/lib/planned-sessions.ts:1348`) | none | none | Hides a day in "Missed this week" (`planned-sessions.ts:246`); button `DeclineMakeupButton.tsx:20` |
| AI Setup plans and generations | `ai_setup_plans`, `ai_generations`, `ai_plan_cache` (`src/db/schema/ai-setup-plans.ts:14`, `ai-generations.ts:4`, `ai-plan-cache.ts:9`) | `src/lib/actions/ai-generate.ts` (AI consent needed, `:163`) | none | none | `/more/ai-setup` |
| Feedback | `feedback` (`src/db/schema/feedback.ts:4`) | `src/lib/actions/feedback.ts` | none | none | `/more/feedback`, `/more/admin/feedback` |
| Friends, nudges, reactions, program shares | `friendships`, `nudges`, `workout_reactions`, `program_shares` | friends actions | none | none | `/more/friends` |
| Exercise PRs (strength, one row) | `exercise_prs` (`src/db/schema/exercise-prs.ts:28`) | `src/lib/workout-records.ts:235`, `:382` | `personal_records` (`workouts.ts:231`) | none | Progress records tab |
| Exercise notes (one row) | `exercise_notes` (`src/db/schema/exercise-notes.ts:14`) | exercise actions | `exercise_history` (`workouts.ts:211`) | none | Exercise detail |
| Custom weights, weight-stack learning (one row) | `custom_weight_usage` (`schema/custom-weight-usage.ts:16`), `program_exercises.weightStack` (`schema/programs.ts:73`) | `src/lib/weight-stack-learning.ts` | none | none | Logger weight picker |
| Gyms (one row) | `gyms` (`src/db/schema/gyms.ts:9`), `users.primaryGymId` (`schema/users.ts:71`) | `src/lib/actions/gyms.ts`, `src/lib/gym-import.ts` | none | none | `/more/gyms` |

User settings, every key:

| Key | Stored | Set by | MCP | Screen |
|---|---|---|---|---|
| `timeZone` | `users.timeZone` (`schema/users.ts:52`) | `setTimeZone` (`src/lib/actions/user-settings.ts:12`); filled once from the browser (`UserSettingsHydrator.tsx:40`) | `get_profile` (`profile.ts:56`); write through `update_profile` (`docs/privacy/data-inventory.md:58`) | Settings (`UnitsAndTimeSettings.tsx:136`, `:153`) |
| `distanceUnit` (km, mi), `swimUnit` (m, yd) | `users` (`schema/users.ts:56-57`) | `setDisplayUnits` (`user-settings.ts:39`) | `get_profile` (`profile.ts:57-58`) | Settings (`UnitsAndTimeSettings.tsx:106`, `:121`) |
| `enduranceEnabled` | `users` (`schema/users.ts:65`) | Admin only, `setUserEndurance` (`src/lib/actions/admin.ts:859`) | `get_profile`, read only (`profile.ts:59`) | Settings shows "Endurance features: on/off" (`UnitsAndTimeSettings.tsx:169`); admin users page (`AdminUsersClient.tsx:149`) |
| `homeLayout` | `users.homeLayout` jsonb (`schema/users.ts:61`) | `saveHomeLayout` (`src/lib/actions/home-layout.ts:52`) | `get_profile`, read only (`profile.ts:60-63`) | Home edit mode (`home/HomeGrid.tsx:3`) |
| `missedWorkoutsEnabled` | `users` (`schema/users.ts:47`) | `setMissedWorkoutsEnabled` (`actions/training-cycles.ts:409`) | Not in `get_profile` output (`profile.ts:49-63`) | Settings (`SettingsClient.tsx:117`) |
| `showActivityToFriends` | `users` (`schema/users.ts:41`) | `updateActivityPrivacy` (`AccountClient.tsx:342`) | Not in `get_profile` output | Account |
| `gender`, `birthYear`, `heightCm`, `weightKg`, `goals`, `experienceLevel` | `users` (`schema/users.ts:35-40`) | `updateUserProfile` (`actions/profile.ts:29`) | `get_profile` (`profile.ts:50-55`), `update_profile` (`profile.ts:74`) | Account (`AccountClient.tsx:309`) |
| `aiConsentAt` | `users` (`schema/users.ts:33`) | `setAiConsent` (`src/lib/actions/legal.ts:50-57`) | Not in `get_profile` output | Account (`AccountClient.tsx:326`), AI Setup sheet (`AiConsentSheet.tsx:17`) |
| `primaryGymId` | `users` (`schema/users.ts:71`) | gym actions | Not in `get_profile` output | `/more/gyms` |
| Garmin `syncWeight` | `garmin_connections.syncWeight` (`schema/garmin.ts:60`) | `setGarminWeightSync` (`actions/garmin.ts:69`) | none | Account (`AccountClient.tsx:334`, `:427`) |
| `theme`, `accentColor`, `customAccentHex`, `uiScale` | Browser localStorage (`src/lib/utils/local-data.ts:9`) | Settings | none | Settings |
| `weeklyGoal` | Browser localStorage (`docs/privacy/data-inventory.md:43`) | weekly-goal widget | none | Home widget |
| `tutorialDismissedAt`, `sharePromptAt`, `friendsSeenAt`, consent versions | `users` (`schema/users.ts:18-32`, `:44`) | app | none | none (state only) |

### 7.3 Flags

Endurance switch, `users.enduranceEnabled`:

- Read by `enduranceEnabledFor` (`src/lib/endurance.ts:18-24`). Set only by an admin (`src/lib/actions/admin.ts:859`).
- Pages that redirect when it is off: `/week` (`src/app/week/page.tsx:40`), `/planned/[id]` (`page.tsx:24`),
  `/planned/[id]/play` (`:14`), `/planned/[id]/pool` (`:17`), `/planned/[id]/results` (`:12`),
  `/more/workouts` (`:15`), `/more/nutrition` (`:19`), `/races/[id]/plan` (`:18`), `/more/athlete`
  (`src/app/more/athlete/page.tsx:17`, from `actions/athlete-profile.ts:88`).
- More menu: Athlete profile, Workouts and Nutrition rows show only with it (`MoreClient.tsx:248-250`, `src/app/more/page.tsx:18`).
- Home: the endurance notices (illness banner, readiness swap, "did you do it?") need it (`home/Notices.tsx:73-77`,
  `src/lib/home/core.ts:101`). Widgets: endurance-today and race-countdown (`src/lib/home/widgets/endurance-today.ts:13`,
  `race-countdown.ts:14`); training-load with endurance or Garmin (`training-load.ts:14`).
- Cycle and season screens: endurance block on `/cycles/[id]` (`cycles/[id]/page.tsx:113-116`); key, auto and brick
  controls in the slot editor (`CycleScheduleBuilder.tsx:484`, `:520-522`); race fields (`EditCycleForm.tsx:57`,
  `SeasonForm.tsx:98`); phase type (`AddPhaseForm.tsx:139`, `:208`, `SeasonDetailClient.tsx:247`, `:412`); calendar
  heavy-legs notes and library (`src/app/more/calendar/page.tsx:64`, `:72`, `:96`); discipline field on exercises
  (`ExercisesClient.tsx:554`, `:627`).
- Server rules: compliance uses thresholds, illness, Garmin match and the "unconfirmed" state only with it
  (`src/lib/session-compliance.ts:232-236`, `:303`; `src/lib/utils/session-compliance.ts:438-445`). Training limits
  return "no endurance" without it (`src/lib/training-limits.ts:290`). Endurance ops on planned sessions refuse
  (`src/lib/planned-sessions.ts:950`). Step results refuse (`src/lib/actions/step-results.ts:19`). Race, phase type
  and profile writes refuse (`src/lib/seasons.ts:330`, `:443`, `:588`; `src/lib/athlete-profile.ts:69`). Thresholds
  are the exception: they work for every user (`src/lib/plan-revisions.ts:1619`).
- MCP: `registerWorkoutLibraryTools` (`list_workouts`, `get_workout`, `manage_workout`, `confirm_planned_session`,
  `manage_illness`), `registerEnduranceAppTools` (`get_training_load`, `get_step_results`, `log_step_results`) and
  `registerNutritionTools` are registered only with it (`src/app/api/[transport]/route.ts:128-132`).
  `get_athlete_profile` returns thresholds only without it (`mcp/tools/athlete-profile.ts:124`). `list_revisions`
  refuses endurance object types (`src/lib/mcp/revisions.ts:224`).

Garmin access:

- `garminAllowed(role)` is true only when `GARMIN_KEY_ENCRYPTION_KEY` is set and the role is `admin`
  (`src/lib/garmin/access.ts:15-17`).
- Pages that return not found without it: `/more/garmin` (`page.tsx:28`), `/more/garmin/race` (`:14`),
  `/more/garmin/activity/[id]` (`:13`).
- Hidden without it: the Garmin row in More (`MoreClient.tsx:244-246`, `src/app/more/page.tsx:17`), the Garmin row
  in Settings (`src/app/settings/page.tsx:26`), the weight sync toggle (`src/app/more/account/page.tsx:17`), the home
  Garmin readiness widget (`home/widgets/garmin-readiness/load.ts:19`, `src/lib/home/widgets/garmin-readiness.ts:14`).
- Every Garmin action refuses (`src/lib/actions/garmin.ts:40`, `:71`, `:95`, `:204`, `:351`).
- Server rules: Garmin match in compliance needs endurance and Garmin (`src/lib/session-compliance.ts:233`).
  The Garmin pick refuses (`src/lib/planned-sessions.ts:1065`). Load comes from the app (`src/lib/training-load.ts:152-158`).
  No readiness flag, so no readiness swap (`src/lib/training-limits.ts:345`). No threshold suggestions
  (`src/lib/athlete-profile.ts:221`). The long-run limit uses app runs only (`src/lib/training-limits.ts:299-313`).
- MCP: the four Garmin tools are registered only with it (`route.ts:134`). The OAuth consent page reads it too
  (`src/app/oauth/consent/page.tsx:39`).

MCP access:

- Each request checks the user's live consent for the client (`src/lib/mcp/access.ts:22-38`, `route.ts:96-105`).
  No consent means revoked. Access is read only or read and change; write tools refuse on read only
  (`src/lib/mcp/scopes.ts:24`, `src/lib/mcp/instructions.ts:60`).

Admin:

- Admin pages redirect other users (`src/app/more/admin/users/page.tsx:11`, `ai-models/page.tsx:9`,
  `insights/page.tsx:9`, `tokens/page.tsx:9`, `feedback/page.tsx:9`). The Admin Tools row shows for admins
  (`MoreClient.tsx:179`, `:243`).
- Garmin history import has no 90-day floor for an admin (`src/lib/garmin/worker.ts:54-55`).

AI consent:

- `users.aiConsentAt` gates the in-app AI edit (`src/lib/actions/ai-generate.ts:163`). It is set on the Account page
  and in the AI Setup sheet (`AccountClient.tsx:326`, `AiConsentSheet.tsx:17`). It does not gate MCP.
- The athlete profile, thresholds, injuries, illness, coach memory and nutrition data are never sent to the
  in-app AI (`docs/privacy/data-inventory.md:22-25`).

### 7.4 Data facts that look like gaps (facts only)

Stored and not read by any query, tool or screen (the explorer and the export aside):

1. Garmin kinds `stress`, `hydration`, `weight_goal`, `wellness_activity`, `sleep_detail`, `food`,
   `menstrual_summary`, `menstrual_day`. They are fetched and stored on every sync (`endpoints.ts:136-221`). No
   file under `src` reads these kinds by name.
2. `garmin_activities.workouts` (the planned workout Garmin holds for an activity). Only the raw view returns it
   (`src/lib/actions/garmin.ts:371`).
3. FIT `lengths` (pool lengths with strokes and stroke type) and `events` (timer pauses). Written at
   `sync.ts:204-205`. No reader.
4. `garmin_fuel_logs`. Not written or read any more (`docs/privacy/data-inventory.md:29`).
5. The Garmin `profile` snapshot. Only `timeZone` is read (`src/lib/garmin/today.ts:13`).
6. Garmin `daily`. Only the resting HR fallback is read (`metrics-job.ts:217-218`).

Stored or shown, and not readable over MCP:

7. Garmin HR zone floors in bpm. The `hr_zones` snapshot and the FIT `hrZoneHighBoundary` feed the metrics
   (`analytics/thresholds.ts:30-52`). No tool returns the zone bounds. `get_athlete_profile` returns thresholds,
   not zones (`mcp/tools/athlete-profile.ts:99-123`).
8. The recovery tab data (`getSleepData`: 90 nights, stages, sleep debt, regularity) and the day tab data
   (`getTodayData`: all-day HR, body battery curve, night HRV readings, SpO2, stress split). No Garmin tool calls
   these (`mcp/tools/garmin.ts:15-25`). `get_garmin_status` returns one value per body signal with its normal
   band (`garmin.ts:52`).
9. From `getOverviewData`, `get_garmin_status` does not return `hrvStatus`, `night`, `stepsWeek`, `intensity`,
   `bmr` or the readiness strip (`queries.ts:775-786` against `garmin.ts:49-70`).
10. Activity detail: `get_garmin_activity` returns laps with time, distance, average HR and average power only.
    It does not return lap pace, cadence or max HR, the strength `sets`, the HR zone floors, stamina, or any
    stream (`garmin.ts:152-167` against `queries.ts:513-531`).
11. The wearable volume suggestion (`wearableSuggestion`) shows on the Garmin training tab only
    (`garmin/page.tsx:57`). The MCP files read here do not return it; the assistant can set the percent with
    `set_volume` (`mcp/tools/cycles.ts:144`).
12. Settings `missedWorkoutsEnabled`, `showActivityToFriends`, `primaryGymId`, Garmin `syncWeight` and
    `aiConsentAt` are not in the `get_profile` output (`mcp/tools/profile.ts:49-63`).
13. Dismissed make-ups have no MCP read (`dismissed_makeups` is not named in `src/lib/mcp/tools/`).

Readable over MCP, and with no screen or a narrow one:

14. Pairing a Garmin activity to a planned session (op `pick`) can be done only over MCP
    (`mcp/tools/workouts-compliance.ts:206`). No client component sends it.
15. Training limits have no screen of their own. A broken limit shows as an override line in the plan history
    (`PlanHistoryPage.tsx:47`) and in tool answers (`mcp/tools/cycles.ts:125`, `:364`).
16. `get_compliance` is registered for every user (`route.ts:133`). The screens that show compliance bands
    (`/week`, `/planned/[id]`) are endurance only (`week/page.tsx:40`, `planned/[id]/page.tsx:24`).

Other facts:

17. Step results have three sources: `player`, `manual`, `assistant` (`src/db/schema/step-results.ts:17`). There
    is no Garmin source. Garmin laps are stored (`schema/garmin.ts:160`) and are not turned into step results.
18. Thresholds are written only by the user or the assistant (`src/lib/athlete-profile.ts:366`). No job writes a
    Garmin estimate. `snapshotZones` reads `CYCLING` or `DEFAULT`, not `RUNNING` (`analytics/thresholds.ts:30`).
19. Garmin data is for admin accounts only (`access.ts:15-17`). For any other user with the endurance switch on,
    load comes from app sessions and RPE (`training-load.ts:171-176`), there is no readiness flag, and compliance
    has no Garmin match.
20. Swim: the only threshold is `swim_css`, with no Garmin suggestion (`src/lib/athlete-profile.ts:218`). Pool
    lengths from the watch are stored and unused (fact 3).
21. The comment at `sync.ts:30-33` says `syncGarmin` runs when the Garmin page opens. The page does not call it;
    the worker comment says no page pulls on open (`worker.ts:119`).

Not checked in this part: the exact fields `update_profile`, `manage_weight` and `get_nutrition` take and
return beyond the lines cited; the inside of the `garmin/analytics` models; the Account page line that shows the
weight history.

## 8. Gaps as facts

Facts only, no proposals. This section groups the gap lists of the passes. The full lists with every
`file:line` are 1.9 (plan and adapt, 22 items), 2.12 (before, 38 items), 4.13 (during and after, 22
items), 6.8 (MCP, 26 items) and 7.4 (data, 21 items). Numbers in brackets point to those items.

### 8.1 Data stored and never shown or used

| Fact | Where |
|---|---|
| Eight Garmin kinds are fetched and stored on every sync and read by no query, tool or screen (the raw explorer and the export aside): `stress`, `hydration`, `weight_goal`, `wellness_activity`, `sleep_detail`, `food`, `menstrual_summary`, `menstrual_day`. | `src/lib/garmin/endpoints.ts:136-221` [7.4 #1] |
| FIT pool `lengths` (time, strokes, stroke type) and timer `events` are decoded and stored. No reader. | `src/lib/garmin/fit.ts:47-48`, `:138`; `src/lib/garmin/metrics-job.ts:79` [7.4 #3] |
| `garmin_activities.workouts` (the planned workout Garmin holds for an activity) is returned by the raw view only. | `src/lib/actions/garmin.ts:371` [7.4 #2] |
| Garmin laps and streams are stored and shown on the activity page. They are not compared with planned steps. Step results have three sources: `player`, `manual`, `assistant`. | `src/db/schema/step-results.ts:17` [7.4 #17, 4.13 #6] |
| Saved step results show again only inside the results form. They are not on `/planned/[id]` or in history. The actual load from `getStepResults` reaches MCP only. | [4.13 #7] |
| An automatic Garmin pairing is computed on every read and never stored. No screen names or links the paired activity. No file under `src/app` or `src/components` reads `matchedBy`. | `src/lib/session-compliance.ts:290-298` [4.13 #1] |
| The watch RPE is a display tile on the activity page and is used nowhere else. | [4.13 #13] |
| `missedReason` and `skipReason` are written and returned in compliance. No adapt mechanism reads them. | `src/lib/planned-sessions.ts:1012`, `:1054` [1.9 #14] |
| The history session detail shows no planned session link, band, load, step results or readiness, though its query returns `plannedSessionId` and `readiness`. | [4.13 #10] |
| The Garmin `profile` snapshot is read for `timeZone` only. Garmin `daily` is read for the resting HR fallback only. | `src/lib/garmin/today.ts:13`; `src/lib/garmin/metrics-job.ts:217-218` [7.4 #5, #6] |
| `src/components/features/WeeklyGoalProgress.tsx` is imported by no file. | [2.12 #34] |

### 8.2 Data shown in the app and not readable over MCP

| Fact | Where |
|---|---|
| Garmin HR zone bounds in bpm (the `hr_zones` snapshot and the FIT `hrZoneHighBoundary`). No tool returns them. | `src/lib/garmin/analytics/thresholds.ts:30-52` [7.4 #7] |
| Sleep tab data (90 nights, stages, sleep debt, regularity) and day tab data (all-day HR, body battery curve, night HRV readings, SpO2, stress split). `get_garmin_status` returns one value per body signal for today with its normal band. No tool returns a day series of sleep, HRV or resting HR. | `src/lib/mcp/tools/garmin.ts:52` [7.4 #8, 6.8 #8] |
| Activity detail: `get_garmin_activity` returns laps with time, distance, average HR and average power. It returns no lap pace, lap cadence, max HR, strength sets, HR zone floors, stamina, streams or GPS. | `src/lib/mcp/tools/garmin.ts:143-167` [7.4 #10, 6.8 #9] |
| The wearable volume suggestion is computed when the Garmin training tab renders and is not returned by a tool. | `src/app/more/garmin/page.tsx:57` [7.4 #11] |
| `get_garmin_trends` has no parameters: a fixed 12 weeks and 90 days. It returns no swim value. | `src/lib/mcp/tools/garmin.ts:83-105` [6.8 #10] |
| Settings `missedWorkoutsEnabled`, `showActivityToFriends`, `primaryGymId`, Garmin `syncWeight` and `aiConsentAt` are not in `get_profile`. Dismissed make-ups have no MCP read. | `src/lib/mcp/tools/profile.ts:49-63` [7.4 #12, #13] |
| Without Garmin access the AI has no tool for readiness, sleep, HRV, resting HR, body battery, VO2 max or Garmin activities. | `src/app/api/[transport]/route.ts:134` [6.8 #7] |
| No tool edits or deletes a logged session or a logged set. | `src/lib/mcp/tools/sessions.ts:74` [6.8 #5] |
| `confirm_session` cannot confirm a session that runs a workout (it needs a program). | `src/lib/mcp/tools/sessions.ts:184` [6.8 #6] |
| `log_fuel` asks for a `workoutSessionId` "from recent_workouts". `recent_workouts` returns no session id. | `src/lib/mcp/tools/nutrition.ts:114`; `src/lib/mcp/tools/workouts.ts:124-138` [6.8 #4] |

### 8.3 Possible over MCP only, with no control in the app

| Fact | Where |
|---|---|
| Create a structured workout or change its steps. The library screen can duplicate, rename, delete and restore, and has no step view. | `src/lib/validators/planned-sessions.ts:74-80` [1.9 #1, 2.12 #30] |
| Put a library workout on a template slot. The app builder picks programs only. | `src/lib/validators/training-cycles.ts:38-55` [1.9 #2, 2.12 #28] |
| Add a dated workout session. The app `add` operation needs a `programId`. | `src/lib/validators/planned-sessions.ts:23-31` [1.9 #3] |
| Link or unlink a brick on a dated session, set priority on a dated session, `unmiss`, `update_from_library`, and pick the Garmin activity for a session. The validator comment says these are "MCP only until the app has a control for them". | `src/lib/validators/planned-sessions.ts:32-33`; `src/lib/mcp/tools/workouts-compliance.ts:206` [1.9 #4, 4.13 #2] |
| No operation clears a stored Garmin pick. | `src/lib/planned-sessions.ts:797`, `:1139-1166` [4.13 #21] |
| Training limits have no screen of their own. A broken limit shows as an override line in the plan history and in tool answers. | `src/components/features/PlanHistoryPage.tsx:47` [7.4 #15] |

### 8.4 Dead ends and missing links on screens

| Fact | Where |
|---|---|
| A program session (strength and path A endurance) has no detail page. `/planned/[id]` returns null without a workout. Its `/week` row has no action. | `src/lib/planned-view.ts:68`; `src/app/week/page.tsx:206-209` [2.12 #1] |
| A path B session has no start, no step list and no link to `/planned/[id]` on the cycle detail sheet or the calendar. "Start workout" needs a `programId`. The calendar reads "No program assigned" for it. | `src/components/features/PlannedSessionActions.tsx:333`; `src/components/features/CycleCalendarClient.tsx:417-426` [2.12 #2, #3] |
| `/planned/[id]` is linked from the Endurance today card (today only) and from a path B row on `/week`. `/week` has no tab and no More entry. On a day with no path B session the default home has no link to `/week`. | `src/lib/home/core.ts:54-56`; `src/components/features/home/widgets/endurance-today/View.tsx:18-20` [2.12 #4, #5] |
| On a day whose only session is a path B session, the Today hero reads "Rest Day" or "No program today" with "Start a Workout". Read from code, not run. | `src/lib/planned-sessions.ts:519-521`; `src/lib/home/core.ts:191` [2.12 #8] |
| The pool view has no way to the results page and no done control. The last block tap does nothing. | [4.13 #14] |
| The calendar and `/programs/[id]` have no start button. | [2.12 #6, #7] |
| "Skip today" on `/new-workout` only goes to home. It writes nothing. | `src/components/features/NewWorkoutClient.tsx:43-48` [2.12 #32] |
| The Race countdown empty state links to `/seasons`, which redirects to `/cycles`. | [2.12 #33] |
| The low-readiness card has no dismiss. | `src/components/features/ReadinessSwapCard.tsx:8-9` [2.12 #35] |
| The exercise-level check circle is inert for endurance exercises. | [4.13 #18] |
| Opening a path A workout route creates a `workout_sessions` row at once. A sweep later closes it as completed with no sets. | [4.13 #16] |
| Refresh from Garmin exists only on `/more/garmin`. The worker syncs about every 30 minutes. | `src/lib/garmin/worker.ts:42` [4.13 #19] |
| A session done by Garmin pairing has no `workout_sessions` row. It is absent from `/history`, `/more/metrics` and the completed dates of the calendar and the home week strip. `/week` and the cycle detail read it as done. Read from code, not run. | `src/lib/session-compliance.ts:326-327`; `src/lib/home/core.ts:174-176` [4.13 #9, 2.12 #21] |
| The limit warnings of a scheduled start and of a readiness swap the user applied are stored on the revision. No screen in the files read shows them. | `src/lib/training-limits.ts:884`; `src/lib/plan-revisions.ts:1093-1100` [1.9 #12] |

### 8.5 Flows that differ between sports or storage paths

No reason is stated in code or docs unless the row says so.

| Fact | Where |
|---|---|
| The same sport has two start flows by storage path. Path A opens the strength logger from the Today hero. Path B opens the guided player or the pool view from the Endurance today card. | `src/components/features/home/widgets/today/View.tsx:160`; `src/components/features/guided/EnduranceTodayCard.tsx:47` [2.12 #9] |
| Swim opens "Pool view". Bike and run open "Start guided". "Pool view" stays on a done swim; "Start guided" hides on a done bike or run. | `src/app/planned/[id]/page.tsx:78-87` [2.12 #24] |
| A brick has two forms. The path A brick is one session with `sport` null. It never pairs with Garmin, the readiness swap never picks it, it is never key by length, `/week` counts it under "Strength", and a "Yes" answer puts all its time on the first sport. The generator's "Bike · Endurance + swim" day has the same form. | `src/lib/session-compliance.ts:129`; `src/lib/session-answers.ts:61-62`; `src/lib/utils/training-limits.ts:639` [1.9 #5, #6; 2.12 #22; 4.13 #4] |
| The brick link shows as an icon on the cycle detail row and as a word on the plan hero only. Home, `/week`, the calendar and `/planned/[id]` have no brick code. No tool returns one combined result for a brick. | `src/components/features/CycleSessionsClient.tsx:193` [2.12 #16] |
| Path A sets have no power, pace, bpm or cadence. The HR zone of a path A set shows on no before-training screen. A path A session has no planned load. | `src/db/schema/programs.ts:152-201`; `src/app/week/page.tsx:68` [2.12 #11, #20; 6.8 #16] |
| The weekly sync, `set_volume` and the wearable suggestion scale only `program_sets` with a peak anchor. Path B sessions get no weekly scaling. | `src/lib/periodization-sync.ts:308-347` [1.9 #7] |
| The long-run cap is for run only. No rule caps a single ride or swim. | `src/lib/utils/training-limits.ts:39-43` [1.9 #8] |
| Key by length applies to bike and run only. The code labels this as inference. | `src/lib/utils/session-compliance.ts:463-466`, `:480-484` [1.9 #9] |
| App load: run and swim have a pace model. Bike is session RPE only. | [4.13 #12] |
| The compliance ratio uses duration, else distance. Power, pace and HR against target are not scored at session level. Bands: green 80 to 120 %, yellow 50 to 150 %, orange outside. | [4.13 #11] |
| `pairGarmin` matches on same sport and same local day, closest duration or distance first. It has no time window, no minimum duration and no maximum gap. | `src/lib/utils/session-compliance.ts:397-416` [4.13 #3] |
| A planned strength session is not cleared by a Garmin strength activity and gets no "Did you do it?" prompt. A missed strength session gets "Make up" and "Decline". A missed endurance session gets "Did you do these?" and, for a key session, "Move to <day>". | `src/components/features/home/Notices.tsx:30-63` [4.13 #5, 2.12 #25] |
| RPE scales differ: 6 to 10 with a default of 7 in `LogRunModal`; 1 to 10 and optional in the "Yes" sheet and the results form; a 4-word feeling on the finish screen. | [4.13 #13] |
| The results form takes a value, RPE or note on work steps only. It takes no measured pace and no change to a step's time. A step result holds one measured value. | `src/components/features/guided/StepResultsForm.tsx:175`, `:205` [4.13 #8, 6.8 #17] |
| The generator makes a hard session for run only (zone 4 work sets). All swim sets and bike sets are easy. So in a generated plan the readiness swap and the hard-session rule can act on the Tuesday run only. | `src/lib/utils/triathlon-plan.ts:321-330` [1.9 #10] |
| The generator writes path A only. The in-app AI plan schema has no HR zone and no workout steps. Cycle import has no workout, priority or brick field. | `src/lib/utils/ai-plan.ts:61-71`; `src/lib/validators/training-cycles.ts:68-83` [1.9 #22] |
| `snapshotZones` reads the Garmin zone rows `CYCLING` or `DEFAULT`, not `RUNNING`. No job writes thresholds; only the user or the assistant does. Swim has one threshold (`swim_css`) and no Garmin suggestion. | `src/lib/garmin/analytics/thresholds.ts:30`; `src/lib/athlete-profile.ts:218`, `:366` [7.4 #18, #20] |
| Rotation cycles get no dated rows, no workouts on slots, no bricks, no move, no key mark, no "Did you do it?" and no `/week` rows. No training limit runs on them. | `src/lib/session-compliance.ts:226-234` [1.9 #18, 2.12 #26, 6.8 #13] |
| Rest and recovery are not a session type. A rest day is the absence of a session. No "rest day" record exists on a date. A named day such as "Mobility" is a slot with a label; `/week` shows "Rest" for it. A recovery day has no data form. | `src/lib/utils/planned-sessions.ts:108-114`; `src/app/week/page.tsx:180-181` [1.9 #19, 2.12 #27] |

### 8.6 Adapt inputs that no mechanism reads

| Fact | Where |
|---|---|
| The app acts alone in four cases: weekly sync, auto sessions, cycle completion, scheduled starts. It asks before the readiness swap, the Garmin volume suggestion, the missed-key move and "Did you do it?". | 5.1 |
| No adapt mechanism reads Body Battery, sleep (other than sleep debt in the wearable suggestion), step results, compliance bands, miss and skip reasons, priority `optional` or coach memory. | [1.9 #14] |
| An illness period changes no session and no volume directly. It lowers adherence, so the next weekly sync can ease volume 10 %. Illness `severity` is read by the return rule text only. | `src/lib/periodization-sync.ts:138-142` [1.9 #13] |
| The six training limits block assistant writes only. The app's own writes store them as warnings. A user edit is never checked. | `src/lib/training-limits.ts:5-6` [1.9 #11, 6.8 #26] |
| The readiness swap and the readiness limit need Garmin. The no-wearable path uses the 1-5 check-in, which is asked at the start of an in-app workout only. A watch-only endurance session gives no check-in value. | `src/contexts/workout-session-context.tsx:290` [1.9 #16] |
| The wearable suggestion is computed only when the Garmin training tab renders. Home calls the readiness swap, not the suggestion. | `src/lib/home/core.ts:103-106` [1.9 #15] |
| The readiness swap applies to today only. | 6.7 |
| With the endurance switch on, `autoComplete` has no effect on a session whose program holds an endurance sport. The generator still sets it on every endurance-only day. | `src/lib/planned-sessions.ts:542-557`; `src/lib/utils/triathlon-plan.ts:429` [1.9 #17] |
| The season re-plan flag changes nothing by itself. The cycle `endAction` is read by the completion banner only; `rest` and `none` have no reader under `src/lib`. | `src/db/schema/seasons.ts:38-41`; `src/components/features/CycleCompletionBanner.tsx:67`, `:107` [1.9 #20, #21] |

### 8.7 Flags that hide things

| Flag | What it hides | Where |
|---|---|---|
| Endurance switch off | Home: Endurance today, Race countdown, Training load (unless Garmin access), sick, return, readiness, "Did you do these?" and missed-key notices. Routes `/week`, `/planned/*`, `/more/workouts`, `/races/*/plan` redirect. More menu: Athlete profile, Workouts, Nutrition. Cycle detail and calendar: band, answers, key, brick, "Use a workout", heavy-legs lines. MCP: workout library, `confirm_planned_session`, `manage_illness`, training load, step results, nutrition, race plan, athlete profile writes, injuries; and the workout, priority and brick operations of `manage_planned_session` and `edit_cycle_slot`. | `src/app/api/[transport]/route.ts:126-132`; [2.12 #36, 6.8 #11, #12] |
| Garmin access off (role is not `admin`, or no env key) | All `/more/garmin` pages, the Garmin readiness widget, the Garmin source of the training load, the 4 Garmin MCP tools, and the pairing of sessions to activities. Every endurance session then needs "Did you do it?", the logger, the player with results, or MCP. | `src/lib/garmin/access.ts:15-17`; `src/lib/session-compliance.ts:280-298`; [2.12 #37] |
| Both needed | The readiness swap and the `hard_after_low_readiness` limit. | `src/lib/readiness-swap.ts:26-29` [2.12 #38] |
| Hidden by default (no flag) | Eleven home widgets, the Garmin readiness and Training load widgets among them. | 2.1 |
| No flag | `get_compliance` registers for every user. The screens that show bands are endurance only. | `src/app/api/[transport]/route.ts:133` [7.4 #16] |
| Tool count | 54 tools with both flags on, 34 with both off. | 6.1 |

### 8.8 Text that does not match the code

| Fact | Where |
|---|---|
| `instructions.ts` tells the AI the app has "no guided player yet". The route `/planned/[id]/play` renders `GuidedPlayer`. | `src/lib/mcp/instructions.ts:46`; `src/app/planned/[id]/play/page.tsx:7-12` [6.8 #1] |
| `docs/mcp/app-rules.md` says a workout session does not show on the home today card. The `endurance-today` widget renders `EnduranceTodayCard`. | `docs/mcp/app-rules.md:276-279` [6.8 #2] |
| `instructions.ts:45` says no code refuses a strength count. `instructions.ts:40` lists `strength_per_week` as a checked limit. | `src/lib/mcp/instructions.ts:40`, `:45` [6.8 #3] |
| The comment in `sync.ts` says the sync runs when the Garmin page opens. The page does not call it; the worker comment says no page pulls on open. | `src/lib/garmin/sync.ts:30-33`; `src/lib/garmin/worker.ts:119` [7.4 #21] |
| Four tools marked read only (`list_training_cycles`, `get_training_cycle`, `list_seasons`, `get_season`) call `startDueScheduledCycle`, which can start a scheduled cycle. | `src/lib/mcp/tools/cycles.ts:86`, `:110`; `src/lib/mcp/tools/seasons.ts:118`, `:155` [6.8 #23] |

### 8.9 Limits of this audit

- Nothing was run. No screen was seen in a browser. Three screen facts are marked "read from code,
  not run" (2.12 #8, #21 and the path B only day in 2.1).
- Opened a second time for this section: `src/lib/planned-view.ts:65-68`,
  `src/lib/planned-sessions.ts:519-521` and `:542-557`, `src/lib/utils/session-compliance.ts:397-416`,
  `src/lib/session-compliance.ts:125-131` and `:278-300`, `src/db/schema/step-results.ts:17`,
  `src/lib/mcp/instructions.ts:40-46`, `src/app/api/[transport]/route.ts:124-136`,
  `src/lib/garmin/access.ts:15-24`, `src/components/features/PlannedSessionActions.tsx:332-335`,
  `src/components/features/CycleCalendarClient.tsx:417-426`,
  `src/lib/validators/planned-sessions.ts:22-35`, `src/lib/home/core.ts:52-57`,
  `src/lib/mcp/tools/nutrition.ts:114`, `src/lib/mcp/tools/sessions.ts:184`,
  `src/lib/mcp/tools/workouts.ts:124-138`, and the `endurance-today` widget. A search across `src`
  confirmed that the eight Garmin kinds in 8.1 are named only in `endpoints.ts`, that `matchedBy` is
  read by no screen, that the `pick` operation is sent only from the MCP tool, and that FIT `lengths`
  has no reader. All matched the passes.
- Not read: the `/week` row controls beyond the band and the link; the section details of
  `MetricsClient`; `BodySignals.tsx` in full; the inside of the `garmin/analytics` models; the full
  field lists of `update_profile`, `manage_weight` and `get_nutrition`.
- "Never read" and "imported by no file" rest on a text search for the name across `src`.
