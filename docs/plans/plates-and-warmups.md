# Plate calculator and warm-up generator

## Why
A lifter loading a barbell wants to see which plates go on each side, and wants warm-up sets
without typing each one. Neither exists. Warm-ups can only be tagged by hand on a set.

## Findings
- **Barbell check:** `exercises.equipment` is an enum (`equipmentEnum` in
  `src/db/schema/exercises.ts`) with a `barbell` value. It reaches the workout through
  `getProgramWithExercises` in `src/lib/actions/programs.ts`.
- **Where warm-ups live:** the workout list renders and logs program sets only. A set's type
  (warm-up / working) is a program set field, and `WorkoutSetsList.tsx` already draws a
  Warm-up badge. Progression in `src/lib/utils/progression.ts` already ignores warm-up sets.
- **Renumbering:** `reorderProgramSets` in `src/lib/actions/programs.ts` already renumbers
  logged sets in open sessions when program sets move. Copy that logic.

## Design
- **Pure helpers, `src/lib/utils/plates.ts`:**
  - `platesPerSide(totalKg, barKg = 20, plates = [25, 20, 15, 10, 5, 2.5, 1.25])`: picks the
    largest plates first and returns `{ perSide: number[], remainderKg }`. Totals below the bar
    return no plates.
  - `warmupRamp(workingKg)`: empty bar ×10, then 40% ×5, 60% ×3, 80% ×2. Round
    to 2.5 kg, and drop steps below the bar, the same weight as the step before, or at the
    working weight. Under 40 kg working weight gets only the bar; at or below the bar, nothing.
    (Planned with a `workingReps` argument, dropped when built: the ramp's reps are fixed.)
  - `formatPlates(totalKg)`: the plate line below, or null under the bar.
- **`addWarmupSets({ programExerciseId })`** in `src/lib/actions/programs.ts`, as one
  transaction:
  - check ownership, and that the exercise is a barbell one
  - lock the slot's row, so a double tap can't add the ramp twice
  - refuse if the exercise already has warm-up sets
  - base the ramp on the first set's weight (with no warm-ups yet, that is the first working set):
    today's weight when the client sends it as `workingKg`, so a taken suggestion counts, else
    the plan's
  - insert the warm-ups before it and renumber the rest
  - renumber logged sets in open sessions the way `reorderProgramSets` does
- **UI:**
  - "Generate warm-ups" button in `WorkoutSetsClient.tsx`, only for barbell exercises with no
    warm-up sets and a working weight set, hidden once every set is logged. Call it through
    `callAction`.
  - Per-side plate line ("20 + 5 + 1.25 per side") in `SetEditView.tsx` and on barbell set rows
    in `WorkoutSetsList.tsx`. Show the remainder when the weight can't be loaded exactly. Leave
    it off rows in edit mode: the taller rows pushed drop targets into dnd-kit's auto-scroll
    band on a 660 px screen.
- Plate set and bar weight are fixed for now. Per-user plates belong to a later units/equipment
  feature.

## Files
`src/lib/utils/plates.ts` (new), `src/lib/actions/programs.ts`, `src/lib/validators/workout.ts`,
`src/components/features/WorkoutSetsClient.tsx`, `src/components/features/WorkoutSetsList.tsx`,
`src/components/features/SetEditView.tsx`.

## Tests
- Unit (`src/__tests__/plates.test.ts`):
  - plates for 20, 60, 61.25, 142.5 and 15 kg
  - the ramp for 40, 100 and 200 kg, rounding and de-duplication
- Integration (`src/__tests__/integration/warmup-sets.test.ts`): `addWarmupSets` mid-workout keeps every logged set attached to the right program
  set, refuses a second run, and refuses another user's exercise.
- e2e (`e2e/warmups.spec.ts`): generate warm-ups on a barbell exercise, log the first warm-up, check `testDb()`.
- `make e2e` and the smoke pass (set logging is a critical flow).

## Privacy
None. No new data.

## Done when
- [x] Plate line shows on barbell sets.
- [x] Generate warm-ups works mid-workout without detaching logged sets.
- [x] `pnpm verify`, `make e2e` and the smoke pass are green.
