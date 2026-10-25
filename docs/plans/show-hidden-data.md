# Show hidden data

## Why
Several things are already stored but never shown, so users can't see or use them.

## Findings
- **Program exercise notes:** `program_exercises.notes` exists (`src/db/schema/programs.ts`) and
  is carried by `exportProgram` / `importProgram` in `src/lib/actions/programs.ts`. Nothing in
  the UI reads or writes it. It's meant for setup cues like seat height or grip.
- **Failed sets:** `workout_sets.is_failed` is logged and shown mid-workout (red ✕ in
  `WorkoutSetsList.tsx`). History ignores it. `getSessionDetail` in
  `src/lib/actions/workout-sets.ts` already selects the whole set row, so `isFailed` reaches
  `SessionDetailClient.tsx` without a query change.
- **Make-up label:** `workout_sessions.intended_date` is set when a session starts from a
  "Make up" prompt. The history query in `src/lib/actions/workout-sets.ts` already selects
  `intendedDate`, but `HistoryClient.tsx` never renders it, so a make-up shows only today's
  date.
- **Cycle adaptation note:** already shown. `formatPeriodizationSummary`
  (`src/lib/utils/periodization.ts`) appends it, and the cycle page and workout header both use
  it. Check it works; no code expected.

## Design
- *new* `updateProgramExerciseNotes({ programExerciseId, notes })` in
  `src/lib/actions/programs.ts`. Copy the ownership pattern from `setProgramExerciseType` in the
  same file. Cap the length (e.g. 500 chars) in the Zod schema. Empty string stores `null`.
- **Notes editor:** on the program exercise screen (the non-workout `WorkoutSetsClient.tsx`
  view). Read-only display during the workout, under the exercise name. Optionally a one-line
  preview in `WorkoutExerciseList.tsx`.
- **Failed badge:** a small "Failed" badge on failed sets in `SessionDetailClient.tsx`.
- **Make-up label:** "Make-up for {weekday, date}" on rows with `intendedDate` in
  `HistoryClient.tsx`.
- **Friends:** `getFriendSessionDetail` in `src/lib/actions/friends.ts` stays unchanged. Friends
  don't see failed flags or exercise notes.

## Files
`src/lib/actions/programs.ts`, `src/components/features/WorkoutSetsClient.tsx`,
`src/components/features/SessionDetailClient.tsx`, `src/components/features/HistoryClient.tsx`.

## Tests
- Integration (`src/__tests__/integration/`): the notes action saves, clears, and refuses
  another user's program exercise.
- e2e: a failed set shows the badge in session detail, and a make-up session shows its label in
  `/history`. Check what was written with `testDb()`.

## Privacy
Exercise notes are free text the user writes. The table already exists and the data is already
in the export. Run the `privacy-compliance` skill to confirm nothing new is needed.

## Done when
- [ ] Notes can be edited on the program and are shown during the workout.
- [ ] History shows the failed badge and the make-up label.
- [ ] Adaptation note confirmed visible on a cycle with a nudge.
- [ ] BACKLOG entries "Surface make-up attribution in the history view" and "Surface failed sets
  in history & metrics" deleted. If failed sets in PR/volume math is left out, keep a smaller
  BACKLOG entry for that part only.
- [ ] `pnpm verify` green.
