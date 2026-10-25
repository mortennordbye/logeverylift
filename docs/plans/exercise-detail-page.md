# Exercise detail page

## Why
Per-exercise progress only lives on the Metrics page. A lifter wants one place per exercise,
reachable from the library and from the workout, with history, records, a chart and their own
notes.

## Findings
- **Chart data:** `getExerciseProgress` in `src/lib/actions/metrics.ts` returns per-session max
  weight, reps at that weight, and volume.
- **Bug:** `getExerciseProgress` sorts by date oldest-first and then limits to 16 rows, so the
  chart shows the *first* 16 sessions ever, not the latest. Anyone with more than 16 sessions
  of an exercise sees stale progress today.
- **Chart component:** `ProgressChart` lives inside `src/components/features/MetricsClient.tsx`
  and already switches between max weight, estimated 1RM (`estimate1RM` from
  `src/lib/utils/progression.ts`) and volume.
- **Records:** current records are `exercise_prs` rows with no `superseded_at`.
  `src/components/features/PrFeedList.tsx` renders records.
- **Entry points today:** the library (`src/app/exercises/page.tsx`, `ExercisesClient.tsx`) has
  a detail view. `e2e/exercise-detail.spec.ts` covers its scrolling.

## Design
- **Route:** *new* `src/app/exercises/[id]/page.tsx`, a Server Component, with a `loading.tsx`
  (the repo has one per page).
- **Fix first:** order `getExerciseProgress` by date descending with the limit, then reverse in
  JS. Write the failing test first.
- **History:** *new* `getExerciseHistory(exerciseId)` in `metrics.ts`. Last ~20 completed
  sessions with their sets for this exercise, filtered by the session user.
- **Chart:** move `ProgressChart` into *new*
  `src/components/features/ExerciseProgressChart.tsx` and import it from both places.
- **Notes:** a personal note per exercise, for any exercise including built-in ones. This is
  separate from `program_exercises.notes`, which is per program slot.
  - *new* table `exercise_notes`: `user_id` (deleted with the user), `exercise_id` (deleted
    with the exercise), `note`, `updated_at`, unique on (`user_id`, `exercise_id`)
  - *new* `upsertExerciseNote({ exerciseId, note })` in `src/lib/actions/exercises.ts`; an
    empty note deletes the row
- **Links:** from the library detail view, and from the exercise header in the workout
  (`WorkoutSetsClient.tsx`).

## Files
`src/app/exercises/[id]/page.tsx` (new), `src/lib/actions/metrics.ts`,
`src/lib/actions/exercises.ts`, `src/db/schema/` (new table + export from the index),
`drizzle/` (generated migration), `src/components/features/MetricsClient.tsx`,
`ExerciseProgressChart.tsx` (new), `ExercisesClient.tsx`, `WorkoutSetsClient.tsx`.

## Tests
- Integration:
  - `getExerciseProgress` returns the latest 16 when there are 20
  - the note upsert creates, updates and deletes, and can't touch another user's note
  - `getExerciseHistory` never returns another user's sets
- e2e: open the page from the library; `e2e/exercise-detail.spec.ts` stays green.

## Privacy
`exercise_notes` is new free-text user data, possibly health-related (injuries).
- Run the `privacy-compliance` skill.
- Add the table to `docs/privacy/data-inventory.md` and to `collectUserData` in
  `src/lib/account-data.ts`. The account-data coverage test should catch it if you don't.
- Keep notes hidden from friends.

## Done when
- [ ] The progress bug is fixed, with a regression test.
- [ ] The page shows chart, records, history and note, linked from the library and the workout.
- [ ] Migration committed, inventory and export updated.
- [ ] `pnpm verify` green.
