# Edit past sessions

## Why
History can only delete a session (`SessionDetailClient.tsx`). A typo in a weight, a forgotten
failed flag or a session logged on the wrong day can't be fixed without losing the session.

## Findings
- **Records:** written when a set is logged, by `detectAndRecordPRs` and
  `detectAndRecordEndurancePRs` in `src/lib/actions/workout-sets.ts`, serialised per user by
  `lockRecords`.
- **Rollback only works for the current record:** `rollbackPRsForSet` undoes a set's records,
  but only while that set's record is still current. If a later set already beat it, rolling
  back leaves two "current" records. Editing an old set needs a rebuild, not a rollback.
- **Rule D-10** (`src/lib/utils/pr-provenance.ts`): records from before honest rep logging are
  kept and flagged, never deleted or recomputed. The rebuild must not touch records from
  before the edit point.
- **Auto sessions:** sessions with `source = 'auto'` are created by auto-complete days, not by
  the user.

## Design
- **Set edits:** `updateLoggedSet({ setId, weightKg, actualReps, isFailed, notes })` in
  `src/lib/actions/workout-sets.ts`. Completed sessions only, owner only.
- **Session edits:** `updateWorkoutSession({ sessionId, date, notes })` in
  `src/lib/actions/workout-sets.ts`, not `workout-sessions.ts` as first planned: it needs the
  record rebuild, and every export of a `"use server"` file is a callable action, so the
  rebuild can't be exported to another file.
  - A date change shifts the start and end time by the same number of days.
  - Refuse auto sessions.
  - Refuse a future date.
- **Rebuilding records:** `rebuildPRsFrom(tx, userId, exerciseId, fromStartTime)` in
  `workout-sets.ts`, run under `lockRecords` in the same transaction as the edit. It:
  1. deletes this exercise's records achieved at or after `fromStartTime`, and un-supersedes
     the records they had beaten
  2. replays every completed set from that point in order through `detectAndRecordPRs` /
     `detectAndRecordEndurancePRs`, which get an optional "at" time so `achieved_at` and
     `superseded_at` reflect history rather than now
  3. for a date change, rebuilds from the earlier of the old and new dates, and shifts the
     session's sets' `created_at` by the same days, since that is the time a replay dates a
     record by
- **UI:** an Edit mode in `SessionDetailClient.tsx`: a per-set sheet (weight, reps, failed,
  notes), a date picker, and session notes. All calls go through `callAction`. Revalidate
  `/history`, the session page and `/more/metrics`.

## Decision: how strict the replay is
Settled 2026-10-26: **rebuild with today's rules, never from before `HONEST_REPS_FROM`.**

The rule that an estimated-1RM record needs RIR 3 or less shipped on 2026-08-31 (#34), and the
record rules have not changed since. So replaying any set from 2026-09-01 on reproduces the
record it earned at the time unless the edit changed it, and no later record disappears.
Records from before that date are frozen by D-10: an edit to an older session saves the set
but leaves those records as they are, and the edit form says so. A date move across
2026-09-01 is refused: moving back would drop records the rebuild can't replay, and moving
forward would leave frozen records dated on the old day.

The rebuild starts at the earlier of the session's start and its sets' times. The start
comes from the phone's clock and a set's time from the server's, so a phone running ahead
puts the start after its sets.

## Files
`src/lib/actions/workout-sets.ts`, `src/lib/validators/workout.ts`,
`src/components/features/SessionDetailClient.tsx`.

## Tests
Set editing is a critical flow.
- Integration:
  - edit an older set *above* a later record, then *below* it again, and assert exactly one
    current record per type after each edit
  - moving a session's date earlier or later re-orders the record chain correctly
  - editing another user's set or session fails
  - auto sessions are refused
- e2e: `e2e/session-edit.spec.ts`. Edit a set's weight in history, check `testDb()` and
  the PR feed.
- `make e2e` and the smoke pass.

## Privacy
No new data. Edits change existing rows.

## Done when
- [x] The open decision is settled and written into this brief.
- [x] Sets, date and notes can be edited, and records stay consistent.
- [x] `pnpm verify`, `make e2e` and the smoke pass are green.
