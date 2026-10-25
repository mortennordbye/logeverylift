# Quick workout and session-only exercise swap

## Why
- **Empty workout:** you can only start a workout from a program (`NewWorkoutClient.tsx`).
  Strong and Hevy users expect "start empty, add exercises as you go".
- **Swap:** adding an exercise mid-workout calls `addExerciseToProgram`
  (`src/lib/actions/programs.ts`), which changes the program for good. There's no "just for
  today" option and no "replace this exercise" when a machine is taken.

## Findings
- **The workout needs a program.** Every workout route sits under `/programs/[id]/workout`.
  `WorkoutSessionInitializer` creates the session with a `programId`, and mid-workout edits
  write to program sets (`addProgramSet`, `updateProgramSet`, `reorderProgramSets`).
- **Logged sets point at program sets.** `workout_sets` has a unique index per session and
  program set. A workout without a program would mean rewriting the core flow, so this design
  keeps the program and adds:
  - a hidden **ad-hoc program** for empty workouts
  - **session-only slots** (`program_exercises` rows tied to one session) for swaps
- **History groups sets by exercise** (`getSessionDetail` in `src/lib/actions/workout-sets.ts`),
  so it keeps working once a session-only slot is deleted, as long as logged sets survive.

## Design
- **Migration:**
  - `programs.is_adhoc boolean not null default false`
  - `program_exercises.session_id`, nullable, linked to `workout_sessions` and deleted with it
  - `program_exercises.replaces_program_exercise_id`, nullable, linked to `program_exercises`
    and cleared if that slot is deleted
- **Actions** in `src/lib/actions/programs.ts`, all *new*:
  - `startQuickWorkout()` creates a program "Quick workout {date}" with `isAdhoc = true` and
    returns its id. The client then goes to `/programs/{id}/workout`.
  - `addSessionExercise({ sessionId, exerciseId, replacesProgramExerciseId? })`: the session
    must be the user's, still open, and on this program. A replace copies the old slot's set
    count, reps, rest and set type, with weight left empty.
  - `saveAdhocAsProgram({ programId, name })` sets `isAdhoc = false` and renames.
  - `getPrograms` (and the cycle/new-workout pickers that use it) hides ad-hoc programs.
- **Cleanup:** `completeWorkoutSession` and `closeStaleOpenSessions`
  (`src/lib/actions/workout-sessions.ts`), plus the cleanup in `createWorkoutSession`, delete
  that session's slots. Logged sets must be kept: their link to the program set is cleared, not
  cascaded. Check the existing foreign key behaviour before relying on this.
- **UI:**
  - `NewWorkoutClient.tsx`: an "Empty workout" button.
  - `WorkoutAddExerciseClient.tsx`: a "This workout only / Add to program" choice, defaulting
    to this workout only.
  - `WorkoutSessionClient.tsx`: shows session-only slots for the active session, hides the slots
    they replace, and adds a Replace action per exercise.
  - Finish page (`src/app/programs/[id]/workout/finish/page.tsx`): leave session-only sets out
    of `overrideWrites`, since they're deleted at finish. For an ad-hoc program, offer "Save as
    program" (name field).
- **Readers that must filter** session-only slots and ad-hoc programs:
  - the program editor (`src/app/programs/[id]/page.tsx`)
  - `exportProgram` and program shares (`src/lib/actions/program-shares.ts`)
  - the MCP program tools (`src/lib/mcp/tools/programs.ts`)
  - AI setup, which reads programs

## Risks
- **Offline replay:** writes queued offline (`src/contexts/pending-queue-context.tsx`) can
  target a slot that was deleted at finish. They must fail once and drop, not retry in a loop.
- **Abandoned ad-hoc programs:** if a quick workout is started and never finished, the ad-hoc
  program is left behind. `closeStaleOpenSessions` should delete ad-hoc programs with no
  completed session.

## Tests
Workout logging is a critical flow.
- Integration (`src/__tests__/integration/workout-sessions.test.ts`):
  - finishing deletes the session-only slots and keeps the logged sets
  - adding a slot to another user's session fails
  - ad-hoc programs don't appear in `getPrograms`
  - "Save as program" makes the program appear
- e2e:
  - *new* `e2e/quick-workout.spec.ts`: empty workout, add exercise, log a set, finish, save as
    program
  - a replace spec that checks in `testDb()` that the program itself didn't change
- `make e2e` and the smoke pass.

## Privacy
No new kinds of data. Run the `privacy-compliance` skill anyway, since program shares are
affected.

## Done when
- [ ] An empty workout works end to end and can be saved as a program.
- [ ] Add and replace "this workout only" leave the program unchanged.
- [ ] Every program reader filters ad-hoc programs and session-only slots.
- [ ] `pnpm verify`, `make e2e` and the smoke pass are green.
