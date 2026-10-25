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
- **Set edits:** *new* `updateLoggedSet({ setId, weightKg, actualReps, isFailed, notes })` in
  `src/lib/actions/workout-sets.ts`. Completed sessions only, owner only.
- **Session edits:** *new* `updateWorkoutSession({ sessionId, date, notes })` in
  `src/lib/actions/workout-sessions.ts`.
  - A date change shifts the start and end time by the same number of days.
  - Refuse auto sessions.
  - Refuse a future date.
- **Rebuilding records:** *new* `rebuildPRsFrom(tx, userId, exerciseId, fromStartTime)` in
  `workout-sets.ts`, run under `lockRecords` in the same transaction as the edit. It:
  1. deletes this exercise's records achieved at or after `fromStartTime`, and un-supersedes
     the records they had beaten
  2. replays every completed set from that point in order through `detectAndRecordPRs` /
     `detectAndRecordEndurancePRs`, which get an optional "at" time so `achieved_at` and
     `superseded_at` reflect history rather than now
  3. for a date change, rebuilds from the earlier of the old and new dates
- **UI:** an Edit mode in `SessionDetailClient.tsx`: a per-set sheet (weight, reps, failed,
  notes), a date picker, and session notes. All calls go through `callAction`. Revalidate
  `/history`, the session page and `/more/metrics`.

## Open decisions
- **How strict the record replay should be.** The user chose to decide this when the feature
  is built. Ask before coding the rebuild. The problem: today an estimated-1RM record only
  counts when the set was logged at RIR 3 or less. Replaying later sets under today's rules can
  remove some older e1RM records that were set after the edited set and wouldn't pass that rule
  now. The options:
  - **Rebuild with today's rules.** Simplest and consistent, but some later records can
    disappear.
  - **Minimal recompute.** Only change the records the edit directly affects and keep other
    later records as they are. More code, and harder to prove correct.
  - Either way, records from before honest rep logging stay untouched (D-10).

## Files
`src/lib/actions/workout-sets.ts`, `src/lib/actions/workout-sessions.ts`,
`src/components/features/SessionDetailClient.tsx`, `src/app/history/[sessionId]/page.tsx`.

## Tests
Set editing is a critical flow.
- Integration:
  - edit an older set *above* a later record, then *below* it again, and assert exactly one
    current record per type after each edit
  - moving a session's date earlier or later re-orders the record chain correctly
  - editing another user's set or session fails
  - auto sessions are refused
- e2e: *new* `e2e/session-edit.spec.ts`. Edit a set's weight in history, check `testDb()` and
  the PR feed.
- `make e2e` and the smoke pass.

## Privacy
No new data. Edits change existing rows.

## Done when
- [ ] The open decision is settled and written into this brief.
- [ ] Sets, date and notes can be edited, and records stay consistent.
- [ ] `pnpm verify`, `make e2e` and the smoke pass are green.
