# Workouts & sets

The hottest area of the app. Two ideas to keep straight: the **blueprint** (`program_sets`) vs the **log** (`workout_sets`), and the **one editor with two modes**.

## The set editor — `src/components/features/SetEditView.tsx`

One component, driven by props (`isWorkout`, `isTimed`, `isRunning`, `discipline`). Rendered by two route families:
- **Program-edit** (`/programs/[id]/exercises/[peId]/sets/[setId]`) → configures the **blueprint** via `updateProgramSet`.
- **Workout** (`/programs/[id]/workout/exercises/[peId]/sets/[setId]`) → writes a **session override** (`WorkoutSessionContext.setOverride`), which the next `logWorkoutSet` flushes. Never writes back to the program.

What each mode exposes (parity rule: program-edit configures the prescription; workout adds live-logging):

| Field | Program-edit | Workout | Saves to |
|---|---|---|---|
| Working/Warm-up toggle | ✓ | — (program-level) | `program_sets.setType` |
| Reps / Weight | ✓ | ✓ | `program_sets` / session override |
| Type (exercise type) | ✓ | ✓ (override) | `program_exercises.exerciseType` via `setProgramExerciseType` |
| **Target RIR** (prescription) | ✓ | shown as "(target N)" guidance | `program_sets.targetRir` |
| **Rest after set** | ✓ | — (auto via rest timer) | `program_sets.restTimeSeconds` |
| **Reps-in-reserve** (logged) | — | ✓ | session override → `workout_sets.rir` |
| **Mark failed** | — | ✓ | override `isFailed` → `workout_sets.isFailed` |
| **Note** | — | ✓ | `workout_sets.notes` |
| Duration (timed) / Distance·Incline·HR (running) | ✓ | ✓ | respective `program_sets` / override fields |

Pickers are the shared idiom: a tappable row opens a `BottomSheet` with preset chips + a manual input (Reps, Weight, Duration, Rest, Type).

## RIR & effort — `src/lib/utils/rir.ts`

- **Logged RIR** (`workout_sets.rir`) is the primary effort input. `rpe` is **derived**: `rpeFromRir(rir) = clamp(10 − rir, 1, 10)`, computed in `logWorkoutSet` (`src/lib/actions/workout-sets.ts`). A failed set ⇒ RIR 0 ⇒ RPE 10.
- **Target RIR** (`program_sets.targetRir`) is the prescription. Shown as guidance on the workout set screen; set in program-edit mode.
- Because rpe is derived from rir, **every existing RPE consumer became RIR-aware for free** — `isConfidentHit` and the deload gate (`src/lib/utils/progression.ts`) and `computeCycleAdaptation`'s `avgRpe` (`src/lib/actions/training-cycles.ts`). No separate rir plumbing was needed in those.

## Exercise type — `src/lib/utils/exercise-type.ts`

- Intrinsic default on `exercises.exerciseType`; optional per-program override on `program_exercises.exerciseType`.
- `resolveExerciseType(override, default)` everywhere it's consumed. `programOverrideForRole(role, default)` decides whether import/generation stores an override (only when role ≠ default).
- `adaptiveIncrementKg` (`progression.ts`) prefers the resolved type over the movement-pattern guess for load-jump sizing.
- The LLM prompt (`src/lib/utils/ai-prompt.ts`) serializes the type and treats the model's `type` output as the **role in this program** → persisted as a program-exercise override on import (`importProgram` in `src/lib/actions/programs.ts`).

## Logging path — `src/components/features/WorkoutSetsList.tsx`

- `toggleSet` builds the `logWorkoutSet` payload from the session override (rir, failed, reps, weight). `rir: failed ? 0 : ov?.rir`; rpe is a fallback (`7`) only when no rir.
- Unique index `(sessionId, exerciseId, setNumber)` blocks double-logging — a re-tap is idempotent.
- PR detection runs inside `logWorkoutSet`; celebrations only fire when an existing record is beaten.

## Display

- History session detail (`SessionDetailClient.tsx`) shows `RIR n` (falls back to `RPE n` for legacy rows).
- Program-set summaries (`src/lib/utils/format.ts` → `setToken`) append `@N RIR` when a target is set; exercise cards/detail show the resolved exercise type.
