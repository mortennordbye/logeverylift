# One program model for strength and endurance

Status: approved by the owner on 2026-11-16. Built: steps 1 to 5 and 6a on `feat/one-program-model`, step 6b on `feat/one-program-6b` (ships in a later deploy, after a backup). Added on the owner's request: the home Today card asks guided or by hand on a day with steps, and Endurance today lists only the other sessions.
Plan page with the pictures (before and after): https://claude.ai/artifact/Wt377iE9h2rCSxRTeNJcxv
(version 2). This brief is the same plan in text, written to be picked up with no conversation
history. Names marked *new* do not exist yet.

## 0. Goal

Programs (`programs` → `program_exercises` → `program_sets`) become the only way to plan and log a
session. A program can hold everything a structured workout holds today. Then the structured
workout path is removed: the `workouts` table, `planned_sessions.workout` and `workoutId`,
`training_cycle_slots.workoutId`, `workout_step_results`, the page `/more/workouts`,
`src/lib/workouts.ts`, and the MCP workout tools.

No structured workout data needs to be kept (owner, 2026-11-16). No data moves.

**Rule 1. Strength does not change.** Strength programs, the workout screen, logging,
progression, PRs, rest and exercise timers, sharing and drag-reorder look and work the same.
Every new field is null for strength. New behaviour starts only on a set with a `stepKind`
(*new*), and only an exercise with `exercises.discipline` (swim, bike, run) may have one.

**Rule 2. Endurance loses nothing.** Every feature of the structured path, including what was
planned, how each step went and the checks across steps, gets a place under programs before
the old path is removed.

## 1. Data model

### 1.1 Program side (all nullable, null for strength)

| Structured workout has | Under programs |
|---|---|
| Step kind warmup, work, recovery, cooldown, rest | `program_sets.stepKind` *new*. `sessionRole` stays only as the "weekly sync owns this rep" flag. Do not reuse it: `isHardSession` in `src/lib/utils/training-limits.ts` treats every `sessionRole` work set as hard, and the sync writes zone and rest on them. |
| Exactly one end: time, distance or lap | `durationSeconds`, `distanceMeters` or `endsOnLap` *new*. A step row has exactly one; the check refuses two. |
| Rest step with any end (also "rest until lap") | A row with `stepKind` rest. `restTimeSeconds` still works for a plain rest after a step. |
| Target (power, hr, pace, cadence; anchor ftp, lthr, max_hr, threshold_pace, css, absolute; low/high, zone or CSS offset) | `program_sets.targets` *new* jsonb: a list of 1 to 2 targets (decision 6), each checked by the target schema in `src/lib/utils/workout-steps.ts`. Adds metric `rpe` (decision 6). |
| Cadence range | `cadenceLow`, `cadenceHigh` *new* |
| Repeat block, 2 to 50 rounds, up to 10 steps | `blockId`, `blockRound` *new*. One row per round (decision 1). |
| Stroke, equipment, send-off, step note | `stroke`, `equipment`, `sendOffSeconds`, `note` *new* |
| Pool length (also yards) | `program_exercises.poolLengthM` *new*, real. The whole-length check accepts the 1 m rounding of a stored integer distance. |
| Description | `program_exercises.notes` (exists) |
| Library default priority | Dropped. Priority stays on slot and dated session. |
| Checks across steps | One whole-exercise check *new*: rows → step tree → `parseWorkout`. Runs on every write of an endurance exercise: app, MCP, sharing, import. |

### 1.2 Logged side

| Step results have today | Under programs |
|---|---|
| Time, distance, RPE, note per step | One `workout_sets` row per step |
| Status done, partial, skipped, not_done | `workout_sets.stepStatus` *new*. A skipped step writes a row with `isCompleted` false. Check every reader of `workout_sets` that does not filter `isCompleted`. |
| Extended time | `extendedSeconds` *new* |
| Measured value | `measuredValue` *new*, plus `avgHr` *new* |
| Workout as run, thresholds used | `workout_sets.plannedStep` *new* jsonb: kind, end, targets, threshold values used |
| Start, finish, paused, source, save key | `workout_sessions.pausedSeconds` and `clientKey` *new*; start and end exist |

## 2. How the app reads a stepped program

- **One step list.** Extend `programSteps` (`src/lib/utils/training-limits.ts`) to read
  `stepKind`, blocks and targets. Estimate, planned load, time per zone, hard flag, limits,
  long-run cap, compliance and swim moving time read it. Program sessions get planned load on
  the week page.
- **Hard.** A row with a step kind is hard by its target, as `isHardWorkout` does: a repeat with
  a work step, or a work step at zone 4 or more. Old rows keep the current rule.
- **Progression** ignores rows with a step kind.
- **PRs, volume, history.** A stepped session counts as one effort per exercise (distance and
  pace PRs read the session total), as today's one-set structured log does.
- **Load.** The session RPE goes on every step without its own RPE.
- **Weekly sync.** As today. Rows in a repeat block get no peak anchors (`scaledDistance` floors
  at 100 m). On a `sessionRole` work rep with a zone target, the zone swaps by phase. A % target
  is not changed.
- **Drag-reorder and delete.** A block moves and deletes as one. A round cannot leave its block.
  "Edit rounds" adds or removes whole rounds.
- **Guided player.** Plays the endurance exercises of the program in order (a brick in one
  program is bike then run); strength exercises are not played. Restore uses the program version.
- **Player save.** One batch action with `clientKey`, keeps the local copy on failure. Writes
  into the open workout for that program and day, else a new completed session. Merges with hand
  logs on the unique key (session, program set); the later save wins.
- **Lap step.** Shows "until lap"; the timer counts up and waits for Lap.
- **Readiness swap.** A hidden one-day copy of the program with one easy step.
- **Picker.** "Use a workout" picks a program (a link). Only a one-day edit copies.
- **Fields copied by hand** get the new fields, with a test that fails on a missing one: program
  sharing (`src/lib/actions/program-shares.ts`), copy program, plan revisions
  (`src/lib/utils/plan-revisions.ts`, `src/lib/plan-revisions.ts`), import/export
  (`src/lib/validators/workout.ts`), AI program generation, MCP `edit_program_exercise`
  (`src/lib/mcp/tools/programs.ts`).
- **MCP.** `edit_program_exercise` takes the step fields. Remove tools `list_workouts`,
  `get_workout`, `manage_workout`; the `manage_planned_session` ops `set_workout`,
  `clear_workout`, `update_from_library`; `edit_cycle_slot` `workoutId`. `get_step_results` and
  `log_step_results` read and write logged steps. Rewrite `docs/mcp/workout-steps.md` and
  `src/lib/mcp/instructions.ts`.

## 3. Decisions (all approved 2026-11-16)

1. Repeat block = one row per round, same `blockId`.
2. A one-day edit makes a hidden copy of the program, only when the program has no strength
   exercise (progression history is keyed on the program id). Hidden from the program list,
   removed when the session is removed or reset.
3. Keep `targetHeartRateZone`; a new target wins when both are set.
4. Sync as today; no anchors inside blocks; rounds change by hand or by the assistant.
5. The in-app set editor gets the step fields and "Add repeat block".
6. Targets as a list of up to two; RPE allowed as a target metric.

## 4. Steps (one PR each; both paths work until 6a)

1. **Data.** Columns, migration, validators, whole-exercise check, every copy path.
   Check: no strength test changes; a test fails on a column missing from a copy path; an
   integration test writes and reads a block, a target and a lap step.
2. **One step list.** Extend `programSteps`; the planned readers in section 2 use it (estimate,
   planned load, hard flag, limits, long-run cap, compliance, weekly sync). The readers of logged
   steps (PRs, volume, swim moving time) move to step 3, where logged steps are written.
   Check: the same session written as a workout and as program rows gives the same estimate,
   load and hard flag.
3. **Screens.** Session detail, player, pool view, results on program sessions; totals, blocks
   and targets on the workout screen; batch save.
   Check: component tests; a guided e2e on a program; screenshots next to the plan pictures.
4. **Editor.** Step fields and repeat blocks; block-aware drag-reorder.
   Check: e2e builds 4 × 1 km, runs it, saves results; drag-reorder e2e passes.
5. **Plan side.** Picker, one-day copy, readiness swap, cycle slots.
   Check: readiness-swap and did-you-do-it e2e on programs.
6. **6a** stop using the old path (code, routes, MCP, docs, privacy page and export via the
   `privacy-compliance` skill; delete `workout` revision rows and strip workout fields from old
   revision copies). **6b** next deploy: backup, drop `ps_program_or_workout`, then the columns
   and tables. 6b cannot be undone.

Every step: `pnpm verify`, `make e2e`, the CLAUDE.md smoke pass, a strength journey review
before/after that must match, and an endurance journey review. The owner tests locally after
step 4 and step 6a. Never deploy while the owner trains.

## 5. Not in this change

Ramps, indoor/outdoor, nested repeats, weekly intensity split, zone chart in history, Garmin laps
as step results, watch delivery (E3), brick transition time, unifying the two "is this
endurance" rules.
