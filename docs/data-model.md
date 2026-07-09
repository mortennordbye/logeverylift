# Data model

Schema lives in `src/db/schema/` (one file per domain, aggregated in `index.ts`; relations in `relations.ts`). Types are inferred: `type ProgramSet = typeof programSets.$inferSelect`. Postgres + Drizzle.

## The core domain graph

```
training_cycles ──< training_cycle_slots ──> programs        (a weekly schedule → a program per day)
                                              │
programs ──< program_exercises ──< program_sets              (the BLUEPRINT: planned reps/weight/rest/…)
              │ (exerciseId)                  
              └──> exercises                                  (the library: name, type, movement pattern, …)

workout_sessions ──< workout_sets ──> exercises              (the LOG: what actually happened)
```

**Blueprint vs log is the key split.** `program_sets` is what you *plan*; `workout_sets` is what you *did*. The SetEditView edits one or the other depending on mode (see [workout-and-sets.md](workout-and-sets.md)).

## Tables (domain)

### `exercises` — `src/db/schema/exercises.ts`
The shared library (system rows have `userId IS NULL`; custom rows are user-owned). The demo user shares tables with real users, so **every read/write filters by `userId` or `userId IS NULL`**.
- Enum-ish `text` columns: `category`, `bodyArea`, `muscleGroup`, `equipment`, `movementPattern`, `discipline` (swim/bike/run, null for non-tri), **`exerciseType`** (compound/accessory/isolation/plyometric/isometric — the intrinsic default).
- `isTimed` — true for holds/cardio (drives the timed-set UI). e.g. Pallof Press is timed.

### `programs` / `program_exercises` / `program_sets` — `src/db/schema/programs.ts`
- `programs.createdByCycleId` → `training_cycles` (cascade). Set when a generator built the program; null for hand-built. Cascade-delete cleans generated programs when their cycle is deleted.
- `program_exercises.progressionMode` — `none|manual|weight|smart|reps|time|distance` (plain text).
- `program_exercises.exerciseType` — **per-program override** of the exercise's type (null = inherit the exercise default). Resolved type = `programExercise.exerciseType ?? exercise.exerciseType` (`resolveExerciseType` in `src/lib/utils/exercise-type.ts`).
- `program_sets` — the per-set blueprint: `targetReps`, `weightKg`, `durationSeconds`, `distanceMeters`, `inclinePercent`, `targetHeartRateZone`, `restTimeSeconds`, `setType` (`working|warmup`), **`targetRir`** (prescribed RIR cap), `sessionRole` (`"work"` = a hard interval rep the cycle phase-swaps), and the periodization anchors `peakDistanceMeters` / `peakDurationSeconds`.

### `workout_sessions` / `workout_sets` — `src/db/schema/workout-sessions.ts`, `workout-sets.ts`
- `workout_sessions` — one per started workout: `programId`, `date`, `feeling`, `readiness` (1–5 pre-workout), `isCompleted`, **`intendedDate`** (the original scheduled day a "Make up" session is catching up — null for normal sessions; see [cycles-and-plans.md](cycles-and-plans.md#missed-workouts-catch-up--failsafe)).
- `workout_sets` — the log: `actualReps` (notNull), `weightKg` (notNull), `durationSeconds`, `heartRateZone`, **`rir`** (the logged effort — *primary* input), **`rpe`** (notNull, **derived** `= clamp(10 − rir, 1, 10)` at log time; kept for legacy rows + downstream logic), `isFailed`, `restTimeSeconds`, `notes`. Unique on `(sessionId, exerciseId, setNumber)` — prevents double-logging.

### `training_cycles` / `training_cycle_slots` — `src/db/schema/training-cycles.ts`
- `training_cycles` — a periodized block: `durationWeeks`, `goal` (build/maintain), `athleteLevel`, `scheduleType` (day_of_week/rotation), `status` (draft/active), plus adaptation state `adaptationPct`/`adaptationNote`/`lastSyncedWeek`.
- `training_cycle_slots` — one row per day-of-week (or rotation position) → a `programId` (null = rest day).

### Other tables
`exercise_prs` (PR detection), `user`/`session`/`account`/`verification`/`oauth_*` (better-auth), `friendships`/`program_shares`/`workout_reactions`/`nudges` (social), `ai_generations`/`ai_model_configs` (LLM program gen), `user_weight_entry`, `feedback`, `invite_token`, **`dismissed_makeups`** (declined missed-workout days — `userId` + `date`, unique; filtered out of the home "Missed this week" list).

App preferences that the **server** must honour live as columns on `user` (not localStorage): `showActivityToFriends`, **`missedWorkoutsEnabled`** (the missed-workout/overdue off-switch). The localStorage-only prefs are a separate store — see [gotchas.md](gotchas.md#settings-live-in-two-stores).

## Non-obvious columns (the ones that cause bugs)

| Column | Gotcha |
|---|---|
| `workout_sets.rpe` | **Derived** from `rir` at log time. Don't set it independently — set `rir` and let `logWorkoutSet` compute rpe (`src/lib/utils/rir.ts`). Hard-coded `7` at log sites is the *fallback* when no rir. |
| `program_exercises.exerciseType` | An **override**, not the source of truth. Always resolve `?? exercise.exerciseType`. |
| `program_sets.targetRir` | The *prescription* (program side). Distinct from `workout_sets.rir` (the *log*). For a "2–3 RIR" range we store the stricter floor (2). |
| `program_sets.peak{Distance,Duration}Meters/Seconds` | Race-prep anchor the active cycle scales `distance/duration` toward each week. Null = not periodized. |
| `program_sets.sessionRole = "work"` | Marks a hard interval rep the weekly sync phase-swaps (zone/rest). Strength sets are roleless (flat). |
| `exercises.userId` | Null = system/shared. **Missing a `userId` filter is a data leak** (demo user shares tables). |
| `workout_sessions.intendedDate` | Set only for "Make up" sessions (`?makeup=YYYY-MM-DD`). `getActiveCycleForUser` folds it into the satisfied-dates set so a make-up logged *today* clears the *original* missed day. Without it, catch-up never clears the nag. |

## Migrations

Committed SQL in `drizzle/` (`0040` target-rir, `0041` missed-workout: `intended_date` + `missed_workouts_enabled` + `dismissed_makeups` are the latest as of this writing). Workflow + idempotency rules are in [`CLAUDE.md`](../CLAUDE.md#database-migrations). Local-DB application gotcha: see [gotchas.md](gotchas.md).
