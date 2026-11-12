# Revisions, stable ids and plan versions

Package A4 of [`triathlon-coach-plan.md`](triathlon-coach-plan.md). One branch and one PR
(`feat/revisions-a4`), on top of package A1 (`feat/foundations-a1-a3`, PR #220). Inputs: the
audit (`docs/triathlon-coach-audit.md`, sections 7, 8, 9, 11 and decisions D1, D2, D4, D21,
T2, T3, T5, T6, T9), `CLAUDE.md`, `TESTING.md` and the MCP access brief
([`mcp-access.md`](mcp-access.md)).

Status: built on `feat/revisions-a4` to the owner's answers (section 12). The **Findings**
section describes the code on `main` at ec8ee7d (after PRs #220 and #221); every `file:line` in
it was opened then, and the code has moved since. The **Design** sections describe what this PR
built; section 13 lists where the build differs from the first draft of this brief. Names marked
*new* were new when the brief was written.

## 0. Goal

Every change to plan data, by anyone, makes a revision that the user can see and restore.
Nothing a plan change or a restore does may delete or unlink a logged set. Concretely:

1. Program sets keep their ids. Every set write updates rows in place, matched by id.
2. Programs, program exercises, program sets and cycles are soft deleted. Readers hide them.
3. A revision store records each change: object, full snapshot, writer, reason, change set,
   time.
4. A restore brings back a whole program or cycle with the same ids. It never touches
   `workout_sets` or `workout_sessions`. It is itself a revision.
5. Programs and cycles carry a version number. A queued offline write or an AI write based on
   an old version shows a conflict instead of applying silently (T9). No logged set is lost.
6. The user sees a history per program and per cycle, can restore any entry, and sees a feed of
   AI changes grouped by change set.
7. Revisions are in the export, go with account deletion, and have a retention rule.

For a lifter nothing visible changes except a "History" link, a "Recently deleted" list and a
conflict notice that is only shown when a conflict really happens.

## 1. Findings in the code

### 1.1 Paths that delete plan rows and unlink logged data

The logged rows point at the plan with `set null` foreign keys: `workout_sets.program_exercise_id`
and `workout_sets.program_set_id` (`src/db/schema/workout-sets.ts:67-73`) and
`workout_sessions.program_id` (`src/db/schema/workout-sessions.ts:52`). So every hard delete of a
plan row unlinks the logged rows that point at it. A slot in a cycle also loses its program
(`src/db/schema/training-cycles.ts:97-99`). Delete paths today:

- MCP set replace: `edit_program_exercise` with `sets[]` deletes all sets of the slot and inserts
  new ones (`src/lib/mcp/tools/programs.ts:499-515`). New ids every time; an open workout loses
  its links mid-session (audit section 7, "Safe writes during an open workout").
- `deleteProgramSet` (`src/lib/actions/programs.ts:1093`, the delete at `:1116`), called from the
  set list during a workout (`src/components/features/WorkoutSetsClient.tsx:762`).
- `removeExerciseFromProgram` (`src/lib/actions/programs.ts:244`, delete at `:264`), called from
  the program page and mid-workout (`src/components/features/WorkoutSessionClient.tsx:127`).
- MCP `edit_program_exercise` remove (`src/lib/mcp/tools/programs.ts:529-531`).
- `deleteManyPrograms` (`src/lib/actions/programs.ts:182`, delete at `:188`) and MCP
  `delete_program` (`src/lib/mcp/tools/programs.ts:229-232`). Cascades to exercises and sets
  (`src/db/schema/programs.ts:53`, `:145`).
- `deleteTrainingCycle` and `deleteManyTrainingCycles` (`src/lib/actions/training-cycles.ts:728`,
  `:751`) and MCP `manage_training_cycle` delete (`src/lib/mcp/tools/cycles.ts:178`). A cycle
  delete also cascades to the programs it generated (`createdByCycleId`,
  `src/db/schema/programs.ts:40-43`), and so to their logged links.
- Slot removal: `removeCycleSlot` (`src/lib/actions/training-cycles.ts:922`, delete at `:937`)
  and MCP `edit_cycle_slot` remove (`src/lib/mcp/tools/cycles.ts:336`). No logged row points at a
  slot, so this loses no logged link.

The plan named only the first two paths. All of them change in this package.

### 1.2 Every writer of plan data

| Writer (T2 tag) | Where | What it writes |
|---|---|---|
| `user` | Server Actions in `src/lib/actions/programs.ts` (create, rename, delete, slot fields, progression settings, sets, reorder, warm-ups `addWarmupSets` at `src/lib/actions/programs.ts:1203`, import at `src/lib/actions/programs.ts:1424`) | Programs, exercises, sets |
| `user` | `src/lib/actions/training-cycles.ts` (create `src/lib/actions/training-cycles.ts:639`, update `src/lib/actions/training-cycles.ts:666`, delete, start `src/lib/actions/training-cycles.ts:767`, restart `src/lib/actions/training-cycles.ts:803`, slots `src/lib/actions/training-cycles.ts:846-985`, import `src/lib/actions/training-cycles.ts:987`) | Cycles, slots |
| `user` | `generateTriathlonPlan` (`src/lib/actions/triathlon-plan.ts:58`), `copySharedProgram` (`src/lib/actions/program-shares.ts:144`) | Whole new cycles and programs |
| `user` | The workout finish flush: session overrides go back to the plan through `updateProgramSet`, online (`src/app/programs/[id]/workout/finish/page.tsx:100`) or queued (`:84`) | `targetReps`, `weightKg`, `durationSeconds` |
| `user` | Mid-workout plan writes: rest time (`src/components/features/WorkoutSetsList.tsx:292`), weight carry to the next set (`:634`), the set editor (`src/components/features/SetEditView.tsx:296`, `:371`) | Set fields |
| `assistant` | MCP program tools: create `src/lib/mcp/tools/programs.ts:184`, rename `:207`, delete `:230`, slot add `:344`, update `:478`, set replace `:500`, remove `:530`. MCP cycle tools: create `src/lib/mcp/tools/cycles.ts:113`, update `:167`, delete `:178`, start `:195-204`, slots `:315-336` | Everything above |
| `progression` | `applyProgressionToPlan` (`src/lib/actions/programs.ts:529`, writes at `:588`) when a slot opted in to "apply to plan" | `weightKg`, `targetReps`, `durationSeconds`, `distanceMeters` |
| `progression` | `learnWeightStacks` (`src/lib/weight-stack-learning.ts:33`, write at `:168`) after a session | `program_exercises.weight_stack` |
| `sync` | `syncPeriodizedTargets` (`src/lib/periodization-sync.ts:183`, set writes at `:244`, cycle write at `:251`). Runs from `syncDueCycle` (`:43`), from `getActiveCycleForUser` during a page render (`src/lib/actions/training-cycles.ts:189-191`), from `getCyclePeriodization` (`:569-570`), and before an MCP set replace (`src/lib/mcp/tools/programs.ts:469-470`) | `distanceMeters`, `durationSeconds` on sets with a peak anchor; `targetHeartRateZone`, `restTimeSeconds` on `work` sets; cycle `lastSyncedWeek`, `adaptationPct`, `adaptationNote` |
| `sync` | `getActiveCycleForUser` marks a finished block completed (`src/lib/actions/training-cycles.ts:176-180`) | Cycle `status` |
| `apply` | `applyWearableSuggestion` (`src/lib/periodization-sync.ts:331`) through `applyWearablePlanSuggestion` (`src/lib/actions/training-cycles.ts:1059`) | The same as `sync`, with the suggested percent |
| none (system) | Demo and fake data in `src/lib/actions/admin.ts` (`:366-446`, `:594-676`, deletes at `:547-552`, `:778-779`), and the scripts in `scripts/` | Seed data; no revisions needed |

The offline queue (1.4) carries one plan write: `updateProgramSet` from the finish flush.

### 1.3 Readers that must hide soft-deleted rows

About 130 query sites read the five plan tables. The groups, with the sites opened:

- Program reads for the UI: `getPrograms` (`src/lib/actions/programs.ts:55`),
  `getProgramWithExercises` (`:69`), `getProgramsWithExercises` (`:102`), and every ownership
  check in that file. The workout and program pages read through these.
- Cycle reads: `getTrainingCycles` (`src/lib/actions/training-cycles.ts:57`),
  `getTrainingCycleWithSlots` (`:71`), `getAllCyclesWithSlots` (`:101`),
  `getActiveCycleForUser` (`:139`, slots with `program: true` at `:152`), `getCyclePeriodization`
  (`:531`), `getProgramPeriodization` (`:611`).
- The sync: `syncDueCycle` (`src/lib/periodization-sync.ts:44`), `periodizationShare` (`:64-78`),
  the peak-set read (`:214-225`), `wearableSuggestion` (`:312`).
- Set logging: `resolvePlanSlot` reads the named set by id (`src/lib/actions/workout-sets.ts:124-153`)
  and falls back to the set at the same position (`:168-190`); `workingSetCount` counts the
  slot's working sets (`:97-103`). Progression: `getProgressiveSuggestions` (`:1687`, plan sets at
  `:1746`).
- MCP: `list_programs` (`src/lib/mcp/tools/programs.ts:132-136`), `get_program` (`:154-161`), slot
  owner (`:111-118`), cycle list and get (`src/lib/mcp/tools/cycles.ts:30`, `:49`, `:69`).
- Shares: `shareProgram` (`src/lib/actions/program-shares.ts:28`), `getIncomingShares` (`:86`),
  `copySharedProgram` (`:157-165`).
- Others: Garmin race and cycle demand reads (`src/lib/garmin/queries.ts:557`, `:940-946`),
  cycle metrics (`src/lib/actions/metrics.ts:1500`, `:1570`), the AI check-in
  (`src/lib/actions/ai-checkin.ts:30`, `:68`), program names sent to AI Setup
  (`src/lib/actions/ai-generate.ts:156`, `src/app/more/ai-setup/page.tsx:36`), the custom
  exercise visibility check (`src/lib/actions/exercises.ts:205-206`), weight-stack learning
  (`src/lib/weight-stack-learning.ts:59`), admin counts (`src/lib/actions/admin-insights.ts:109-148`).

Readers that must keep **showing** deleted rows, on purpose: workout history joins that show the
program name of a logged session (`src/lib/actions/workout-sessions.ts:291`,
`src/lib/actions/workout-sets.ts:1456`, `:1536`, `src/lib/actions/friends.ts:444`, `:676`,
`:1009`, `:1126`, `src/lib/mcp/tools/workouts.ts:99`), the export (`collectUserData`,
`src/lib/account-data.ts:62-125`) and the custom-exercise hand-over on account deletion
(`src/lib/account-data.ts:188`). Today a hard delete makes these show no program name; after
this package they show the name of the deleted program, which is better.

Two facts make the read side harder:
- A slot keeps its `program_id` when the program is soft deleted, while a hard delete set it to
  null. Every slot reader must read a slot whose program is deleted as a slot with no program
  (the sync must not write into a deleted program's sets).
- `training_cycle_slots` has unique keys on day and position (`src/db/schema/training-cycles.ts:107-108`).
  A soft-deleted slot would block a new slot on the same day. So slots are not soft deleted
  (2.4).

### 1.4 The offline queue

- The queue holds four kinds: `logWorkoutSet`, `unlogWorkoutSet`, `updateProgramSet` and
  `completeWorkoutSession` (`src/contexts/pending-queue-context.tsx:56-60`). Only
  `updateProgramSet` writes plan data. It is there for the finish flush
  (`src/app/programs/[id]/workout/finish/page.tsx:84`).
- A replay counts an item as done only when `result.success` is true
  (`src/contexts/pending-queue-context.tsx:139-147`). Anything else backs off and, after
  `MAX_ATTEMPTS`, is dropped with a toast (`:164-166`, `:185-193`;
  `afterFailedReplay` in `src/lib/utils/pending-queue.ts:35-43`). So a conflict answer from the
  server would today be retried six times and then dropped as "couldn't be saved". The design
  must make a conflict a final, visible outcome that is not a drop.
- Since PR #221, a stale-bundle error is its own outcome: the item and every later one stay
  queued without spending an attempt (`afterStaleBundle`, `src/lib/utils/pending-queue.ts:55-57`;
  the replay loop at `src/contexts/pending-queue-context.tsx:150-160`). A conflict is a third
  outcome next to it, and it must not disturb that rule.
- A queued `logWorkoutSet` that names a deleted program set still saves the row, without a link
  (`src/lib/actions/workout-sets.ts:153-161`). With soft delete the set row still exists, so the
  row keeps its link. The position fallback (`:168-190`) must skip soft-deleted sets, or a log
  could land on a deleted set at the same position.
- The finish page sends no version today and ignores the flush results
  (`src/app/programs/[id]/workout/finish/page.tsx:99-103`).

### 1.5 MCP context

- Tools get only `userId` (`src/app/api/[transport]/route.ts:102-105`). The OAuth client id is
  in the token claims (`claims.azp`, `:87`), so the server can tag an assistant revision with
  the client without a new tool argument.
- An AI write leaves only a log line (`audit`, `src/lib/mcp/result.ts:46-48`).
- The handler is stateless per request (`createMcpHandler` per call, `src/app/api/[transport]/route.ts:99-111`), so a change-set
  id needs a rule (2.8).
- Tools are write tools unless they set `readOnlyHint: true` (`isReadTool`,
  `src/lib/mcp/scopes.ts:51-53`).

### 1.6 Found, outside this package

- Deleting a custom exercise cascades to its program slots and to every **logged** set of that
  exercise (`deleteCustomExercise`, `src/lib/actions/exercises.ts:102-121`; the cascades at
  `src/db/schema/programs.ts:55-57` and `src/db/schema/workout-sets.ts:56-58`). This loses logged
  data. It is not a plan write, but the owner chose to fix it in this PR (section 12, decision 4).
- The daily purge hook exists (`src/instrumentation.ts:47-53`); the retention job (section 9)
  joins it.

## 2. Design

### 2.1 Data model

New columns:

| Table | Column | Type | Meaning |
|---|---|---|---|
| `programs` | `deleted_at` | timestamp, null | Soft delete. Null = live |
| `programs` | `version` | integer, not null, default 1 | Bumped by every revision from `user` or `assistant`, and by every restore |
| `program_exercises` | `deleted_at` | timestamp, null | Soft delete |
| `program_sets` | `deleted_at` | timestamp, null | Soft delete |
| `training_cycles` | `deleted_at` | timestamp, null | Soft delete |
| `training_cycles` | `version` | integer, not null, default 1 | As on programs |

New table `plan_revisions`:

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `user_id` | text, FK `user`, cascade | Owner |
| `object_type` | text enum `program`, `cycle` | Later packages add `season`, `workout`, `threshold`, `memory` (T5). Text with a Drizzle enum, not a Postgres type, so a new value needs no `ALTER TYPE` |
| `object_id` | integer | The program or cycle id. No FK: a revision outlives a purge of its object until retention removes it |
| `version` | integer | The object's version after this revision |
| `action` | text enum `create`, `update`, `delete`, `restore`, `baseline`, `conflict` | |
| `writer` | text enum `user`, `assistant`, `progression`, `sync`, `apply` | T2 |
| `reason` | text, null | Required for `assistant`; set by the app for automatic writers ("Weekly sync, week 6") |
| `change_set_id` | text, null | Groups writes (2.8) |
| `client_id` | text, null | The OAuth client for `assistant` revisions |
| `restored_from_id` | integer, null, FK `plan_revisions` set null | For `restore` |
| `snapshot` | jsonb, not null | The whole object after the change (2.2). For `delete`, the object just before it. For `conflict`, the object as it stayed |
| `rejected` | jsonb, null | For `conflict` only: the write that was not applied, field by field |
| `created_at` | timestamp, default now | |

Indexes: `(user_id, object_type, object_id, id)`, `(user_id, writer, created_at)`,
`(user_id, change_set_id)`.

Slots stay as they are (no `deleted_at`); a cycle snapshot holds its slots, and a cycle restore
rewrites them with their old ids (2.6).

### 2.2 One entry point for plan writes

A server module `src/lib/plan-revisions.ts` (*new*, plain server code like
`periodization-sync.ts`, not Server Actions) with one function every writer uses:

```ts
withPlanWrite(
  { userId, writer, reason?, changeSetId?, clientId? },
  [{ type: "program", id, expectedVersion? }],   // the objects this write touches
  async (tx) => { /* the existing write code */ },
)
```

In one transaction it:
1. Locks each object row (`SELECT ... FOR UPDATE`) and checks it belongs to `userId` and is
   live (a restore passes a flag to allow a deleted object).
2. Checks `expectedVersion` when given (2.7). On a stale version it returns a conflict and runs
   nothing.
3. If the object has no revision yet, writes a `baseline` revision of the current state. This
   covers every object that existed before the migration, and seed data, without a heavy data
   migration.
4. Runs the write.
5. Reads the new snapshot. If it equals the last revision's snapshot, writes nothing more (a
   no-op write leaves no revision; the weekly sync would otherwise add one per program per page
   view).
6. Otherwise inserts the revision and bumps `version` when the writer is `user` or `assistant`
   or the action is `restore`.

Snapshot format (versioned so later readers can migrate it):
`{ "v": 1, "program": {row}, "exercises": [{row, "sets": [{row}]}] }` with live children only,
or `{ "v": 1, "cycle": {row}, "slots": [{row}] }`. Rows are the Drizzle rows as stored, decimals
as strings.

Why `progression`, `sync` and `apply` do not bump the version: they write only fields they own
(2.5), and they run at moments the caller cannot see (the sync runs inside a page render and
inside an MCP write). If they bumped it, an AI write would conflict with the server's own
weekly sync. They still make revisions, so the history is complete.

A guard test (5, unit) scans `src/` for `insert`, `update` and `delete` on the five plan tables
outside `src/lib/plan-revisions.ts` and fails, with an allow list for the demo seeding in
`admin.ts` and account deletion. A second guard scans reads of the four soft-deleted tables and
requires the live filter, or a `// plan-read: includes deleted (<why>)` comment on the
statement. That keeps the next package from adding a write that skips revisions (plan
principle 5) or a reader that shows deleted rows.

### 2.3 Stable set ids

- **MCP set replace becomes a diff.** `setShape` gets an optional `id`. For the slot's live
  sets: an input set with an `id` updates that row; an input set without an `id` updates the
  live row with the same `setNumber`; any other input set is inserted; a live row matched by
  neither is soft deleted. The peak re-derivation and the kept `sessionRole` work as now, per
  matched row. The tool text says this. A pure function `matchSets` (*new*,
  `src/lib/utils/plan-revisions.ts`) does the matching, so it is unit tested.
- If a matched set's `setNumber` changes, rows logged against it in the user's open sessions
  move with it, the same rule `reorderProgramSets` and `addWarmupSets` use today. That rule
  becomes one shared helper.
- **`deleteProgramSet`, slot remove, program delete and cycle delete** set `deleted_at` instead
  of deleting. A program delete also soft deletes its exercises and sets with the same time
  stamp; a cycle delete also soft deletes the programs it generated (`createdByCycleId`), in one
  change set, so one restore brings all of them back.
- Slot removal stays a hard delete (nothing logged points at a slot; see 1.3 for the unique key).
- Deleting a program or a cycle that an **open workout** uses is refused with "Finish or discard
  the workout first". Today it unlinks the running workout. Deleting a set or an exercise during
  a workout stays allowed: the logged rows keep their link to the hidden row.

### 2.4 Soft delete and readers

- Helpers `livePrograms`, `liveProgramExercises`, `liveProgramSets`, `liveCycles` (*new*) are
  Drizzle conditions (`isNull(x.deletedAt)`); relational queries use them in `where` of each
  `with` block.
- A slot whose program is deleted reads as a slot with no program, in one helper used by the
  cycle readers and the sync.
- `resolvePlanSlot` keeps resolving a named set by id **including deleted rows** (the log keeps
  its link), while the position fallback and `workingSetCount` count live sets only.
- A logged row whose plan set was deleted mid-session keeps its link. The workout's set list
  shows the plan's live sets, so the deleted set leaves the list, as it did before; the logged
  row stays in the session, the history and the export (integration tests, section 5).
- Writes to a deleted object are refused as "not found", except restore.
- "Recently deleted" lists on `/programs` and `/cycles` read deleted objects on purpose.

### 2.5 Field owners per writer

From audit section 8, made exact. "Kept on restore" means a restore leaves the current value.

| Object | Field | Owner (writers) | On restore |
|---|---|---|---|
| Program | `name` | user, assistant | Restored |
| Program | `created_by_cycle_id`, `created_at` | set at create | Kept |
| Program, cycle | `version`, `deleted_at` | the revision layer | Kept, then version bumped |
| Exercise slot | `exercise_id`, `order_index`, `notes`, `exercise_type`, increments, progression axes, `progression_required_hits`, apply-to-plan and effort-prompt flags | user, assistant | Restored |
| Exercise slot | `progression_config_at` | stamped by whoever changes a judging rule | Recomputed: stamped now if the restore changes a judging rule (`judgingRuleChanged`), else kept |
| Exercise slot | `weight_stack` | progression (learned), user (clear) | Kept |
| Exercise slot | `progression_mode` (retired) | user, assistant | Restored |
| Set | `set_number`, `set_type`, rep range, `target_rir`, `incline_percent`, `start_delay_seconds`, `session_role`, peak anchors | user, assistant | Restored |
| Set | `target_reps`, `weight_kg`; `duration_seconds`, `distance_meters` on sets with no peak anchor | user, assistant, progression | Kept when the last change to the field after the target revision came from `progression`, else restored (decision 1) |
| Set | `distance_meters`, `duration_seconds` on sets with a peak anchor | sync (derived from the peak) | Recomputed by the sync from the restored peak |
| Set | `target_heart_rate_zone`, `rest_time_seconds` on `work` sets in a cycle with peak anchors | sync (by phase) | Recomputed by the sync |
| Set | the same two fields elsewhere | user, assistant | Restored |
| Cycle | `name`, `duration_weeks`, `schedule_type`, `goal`, `athlete_level`, `race_date`, `race_distance`, `end_action`, `end_message`, slots | user, assistant | Restored |
| Cycle | `status`, `start_date` | user, assistant (start, restart), sync (complete) | Kept (a restore never starts or stops a block) |
| Cycle | `last_synced_week`, `adaptation_pct`, `adaptation_note` | sync, apply | Kept, then the sync re-runs |

An AI change to volume through `adaptation_pct` is B1's question (plan B1); A4 only records it.

### 2.6 Restore

`restoreRevision(revisionId)` and `restoreChangeSet(changeSetId)` (*new*, in
`src/lib/plan-revisions.ts`), with Server Actions over them.

Restoring a program to revision R:
1. Refuse if an open workout uses the program ("Finish or discard the workout first"). This
   keeps set numbers and links stable under a running workout.
2. In `withPlanWrite` with action `restore`, writer `user` (or `assistant` from MCP),
   `restored_from_id` = R, the deleted flag allowed.
3. A pure function `planRestore` (*new*) compares R's snapshot with the current rows (live and
   deleted) and the revisions after R, and returns: rows to update in place, rows to un-delete,
   rows to soft delete (live now, absent in R), rows to insert with their old id (absent from
   the table, which only happens after a purge), and the fields to keep (2.5).
4. Applies it. Program-level `deleted_at` is cleared when R is from before a delete.
5. A slot whose exercise no longer exists (a deleted custom exercise, 1.6) is skipped, and the
   result says so.
6. After commit, if the program is in the user's active cycle and has a peak anchor, clears
   `last_synced_week` and re-runs the sync for the current week with the cycle's **current**
   `adaptation_pct` as the override, so an applied wearable suggestion is not undone (T2).
7. Never writes `workout_sets` or `workout_sessions`. An integration test compares those rows
   before and after.

Restoring a cycle to R: the same, with slots rewritten from R with their old ids (delete the
current slots, insert R's), lifecycle fields kept (2.5). A deleted cycle that is restored while
another cycle is active comes back as `draft`. Programs the cycle generated and that were
deleted in the same change set are restored with it. Then the sync re-runs if the cycle is
active.

Restoring a change set ("Undo these changes"): for every object the change set touched, restore
it to the last revision before the change set's first revision on it; an object the change set
created is soft deleted; all in one transaction and one new change set. The confirm sheet lists
later changes by others to the same objects, which the undo also reverts.

A deleted object is restored from its `delete` revision. Restore runs no training-limit check
in A4 (the limits arrive in D2; T4 then adds a warning on AI restores).

### 2.7 Versions and conflicts (T9)

**AI writes.** `get_program` and `get_training_cycle` return `version`. Every MCP write to an
existing program or cycle takes a required `expectedVersion`. A stale one is refused with
nothing applied: "Conflict: program 12 is at version 9, you read version 7. Changes since: …
(writer, time, short summary). Read it again and redo the change." Every write result returns
the new version, so a model can chain writes in one conversation. Writes by the engine or the
sync in between do not bump the version (2.2), so they never cause a conflict.

**The offline queue and the finish flush.** The finish flush writes set fields from the session.
The user's own plan edits during the workout bump the version, so a plain version check would
make the flush conflict with the user's own edits. So the check is per field, with the version
as the base:

1. The workout context stores the program's `version` when the workout starts (a new field in
   the existing `activeWorkout` storage; no new key).
2. The finish flush sends `baseVersion` with each `updateProgramSet`, online and queued.
3. On the server, if the program is still at `baseVersion`, the write applies. Otherwise the
   server takes the newest revision at `baseVersion` as the base, and for each field in the
   write compares base value `b`, current value `c` and new value `n`. If `c == b` (nobody
   changed it) or `c == n` (already there), the field is fine. If any field has `c` different
   from both, or the set is deleted, nothing in that write is applied, a `conflict` revision is
   stored with the rejected values, and the action returns
   `{ success: false, error, conflict: { programId, revisionId } }` (`ActionResult` gets an
   optional `conflict`).
4. A payload with no `baseVersion` (a bundle cached before this deploy) applies as today.
5. The queue treats a conflict as **final**: the item leaves the queue, it is not counted as
   dropped, and a toast says "Workout saved. One plan change from it was not applied, because the
   plan changed in the meantime. See the program's history." A pure function `replayOutcome`
   (*new*, `src/lib/utils/pending-queue.ts`) maps a result to `done`, `conflict` or `retry`.
6. `logWorkoutSet`, `unlogWorkoutSet` and `completeWorkoutSession` never check versions. A
   conflict on a flush item never blocks or reorders them. This is the rule that keeps every
   logged set: the queue only ever refuses a plan change, never a log.
7. The conflict entry in the program's history has "Apply my value", which sends the rejected
   values as a normal user write.

**Online edits in the app** (set editor, rest picker, program page, cycle form) send no version
and apply as today: last write wins, and the overwritten state is one tap away in the history.
Owner decision 3.

### 2.8 Change sets (T3)

- `user` writes: one change set per action call (null for a single-object write).
- `sync`: `sync:<cycleId>:<week>`. `apply`: `apply:<cycleId>:<week>`. `progression`: the
  session id, `session:<id>`.
- `assistant`: the server keeps one change set per user and OAuth client: an assistant write
  joins the client's last change set if that change set's last revision is under 30 minutes
  old, else it starts a new one (`mcp:<uuid>`). A pure function `changeSetFor` (*new*) holds the
  rule. B1 may add an explicit change-set argument for the model; this default stays for writes
  without it.

### 2.9 UI

- **Program history** at `/programs/[id]/history`, linked from the program page header. Rows
  newest first: who ("You", the assistant's client name, "Progression",
  "Weekly sync", "Garmin suggestion"), time, reason, and a short diff ("Bench press, set 2:
  60 → 62.5 kg"). Runs of automatic rows fold into one line ("3 automatic changes"). Each row
  but the newest has Restore. The confirm sheet shows what changes, says that logged workouts
  are not changed, and (when it applies) that weekly targets and progression numbers keep their
  current values and the weekly sync runs again (T2). Conflict rows are marked "Not applied"
  and have "Apply my value".
- **Cycle history** at `/cycles/[id]/history`, the same.
- **Recently deleted** at the end of `/programs` and `/cycles`: name, deleted when, Restore.
- **AI changes** at `/more/assistants/changes`, linked from the Connected assistants screen:
  one card per change set (client, time span, reasons, objects with short diffs), "Undo these
  changes" (2.6), and links to each object's history.
- The diff text comes from a pure function over two snapshots (*new* `diffSnapshots`), shared
  by the UI and the MCP list tool.
- Touch targets 44 px, Restore and Undo confirm in a bottom sheet, destructive action at the
  bottom (CLAUDE.md UI rules).

### 2.10 MCP in this package

Decision: the MCP side of revisions ships here, not in B1, because principle 3 of the plan
(AI parity) requires a package that adds a UI feature to add its MCP tools, and because the
feed needs the writer tag from day one.

- All existing MCP plan writes go through `withPlanWrite` with writer `assistant`, `client_id`
  from the token, the change-set rule (2.8), a required `reason` argument (D2: required for AI
  changes) and the required `expectedVersion` (2.7).
- `delete_program` and the cycle delete become soft deletes; the descriptions say the user can
  restore them in the app. `destructiveHint` stays.
- New `list_revisions` (`readOnlyHint: true`): an object's revisions, or the user's assistant
  change sets, with diffs.
- New `restore_revision` (write): restore one revision or one change set, with a reason.
- B1 keeps: the explicit change-set argument, version checks on the tools B1 adds, and the field
  ownership text in tool descriptions.

## 3. Migration and rollback

One migration (`drizzle/0082_*.sql` if nothing else lands first), generated with
`pnpm db:generate` (create, not rename), SQL and `drizzle/meta/` committed together. It adds
the six columns with their defaults and the `plan_revisions` table with its indexes. No
`CREATE TYPE` (text enums). No data step: every existing row gets `version = 1` and
`deleted_at = null` from the defaults, and baselines are written lazily (2.2).

**Rollback.** Data loss: all revisions, and soft-deleted rows (they become hard deletes, as
before this package). Steps:
1. While the new code still runs, hard delete what is soft deleted, so it does not come back
   as live data under the old code:
   ```sql
   DELETE FROM training_cycles WHERE deleted_at IS NOT NULL;
   DELETE FROM programs WHERE deleted_at IS NOT NULL;
   DELETE FROM program_exercises WHERE deleted_at IS NOT NULL;
   DELETE FROM program_sets WHERE deleted_at IS NOT NULL;
   ```
   The `set null` keys unlink logged rows, the same as a delete did before A4. No logged row is
   deleted.
2. Deploy the previous image. It ignores the new columns and table.
3. Then, optionally:
   ```sql
   DROP TABLE plan_revisions;
   ALTER TABLE programs DROP COLUMN deleted_at, DROP COLUMN version;
   ALTER TABLE training_cycles DROP COLUMN deleted_at, DROP COLUMN version;
   ALTER TABLE program_exercises DROP COLUMN deleted_at;
   ALTER TABLE program_sets DROP COLUMN deleted_at;
   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<hash of 0082>';
   ```
   The last line lets the migration run again on a later re-deploy.

## 4. MCP tools

| Tool | Change | Hint |
|---|---|---|
| `get_program`, `list_programs`, `get_training_cycle`, `list_training_cycles` | Hide deleted rows; return `version` | read |
| `create_program`, `manage_training_cycle` create | Revision `create`; `reason` required | write |
| `update_program`, `delete_program`, `edit_program_exercise`, `manage_training_cycle` update/delete/start, `edit_cycle_slot` | `reason` and `expectedVersion` required; set diff by id; soft delete; conflict result; new version in the result | write |
| `list_revisions` (*new*) | Revisions of one object, or assistant change sets | read |
| `restore_revision` (*new*) | Restore a revision or a change set | write |

Integration tests for every tool in the table (5).

## 5. Tests per layer

Bug fixes first: each "today" test below is written first, run against the current code, and
seen failing.

| Layer | What | File |
|---|---|---|
| Unit | `matchSets`: by id, by set number, insert, soft delete, duplicate numbers | `src/__tests__/plan-revisions.test.ts` (*new*) |
| Unit | `planRestore`: update, un-delete, soft delete, insert with id; field keeping by owner (2.5) including the progression last-writer rule; sync fields left for the sync | same |
| Unit | Per-field conflict check (`b`, `c`, `n`) and the deleted-set case | same |
| Unit | `changeSetFor` window; `diffSnapshots` text | same |
| Unit | `replayOutcome`: success → done, conflict → conflict, other failure → retry | `src/__tests__/pending-queue.test.ts` |
| Unit | Guard: no plan write outside the revision module; every plan read filters or is marked | `src/__tests__/plan-write-guard.test.ts` (*new*) |
| Component | Queue replay with a conflict on a flush item: the item leaves, conflict toast, no "dropped" toast, and the queued `logWorkoutSet` and `completeWorkoutSession` around it still replay and leave the queue (fake timers) | `src/__tests__/components/pending-queue.test.tsx` |
| Component | Finish page sends `baseVersion` with each flush item, online and queued | `src/__tests__/components/finish-page.test.tsx` |
| Component | A new workout keeps the program's version, and a resumed one keeps the version it started on | `src/__tests__/components/workout-plan-version.test.tsx` |
| Integration | Today fails: `deleteProgramSet` on a set with a logged row; the row keeps `program_set_id` | `src/__tests__/integration/plan-revisions.test.ts` (*new*) |
| Integration | Today fails: MCP `edit_program_exercise` with `sets[]` during an open session; set ids unchanged and logged rows keep their links | `src/__tests__/integration/mcp-programs.test.ts` |
| Integration | Each writer in 1.2 makes one revision with the right writer, action and change set; a no-op write makes none; version bumps only for user, assistant and restore | `plan-revisions.test.ts` |
| Integration | Readers: deleted programs, exercises, sets and cycles are hidden in every reader group of 1.3; history reads still show the name; export includes them | same |
| Integration | `logWorkoutSet` against a soft-deleted set keeps the link; the position fallback and the working-set count skip deleted sets | `src/__tests__/integration/workout-sets.test.ts` |
| Integration | Restore: same ids; logged rows byte-for-byte unchanged; sync-owned fields recomputed with the current adaptation; lifecycle fields kept; restore is a revision and can itself be restored; deleted program and cycle (with generated programs) restored; refused with an open workout; change-set undo | `plan-revisions.test.ts` |
| Integration | Versions: MCP stale `expectedVersion` refused with nothing changed; queued flush with a stale base and an overlapping field stores a conflict and changes nothing; a non-overlapping field applies; no `baseVersion` applies | same |
| Integration | Every new action and tool called as another user is refused and changes nothing | same |
| Integration | Export has `plan_revisions`; account deletion removes them; retention purge keeps each object's newest revision | `src/__tests__/integration/account-data.test.ts` |
| Integration | Migration: existing rows get version 1 and no `deleted_at` | `src/__tests__/integration/migrations.test.ts` |
| e2e | Restore: change a set, open History, restore, values back and `testDb()` shows the same set ids; delete a program, restore it from Recently deleted | `e2e/plan-revisions.spec.ts` (*new*) |
| e2e | Conflict: start a workout, change a weight, go offline, finish (queued), change the same set on the server through `testDb()` with a version bump, go online; the conflict toast shows, `testDb()` shows every logged set and the completed session, the plan keeps the server value, History shows "Not applied" | `e2e/plan-conflict.spec.ts` (*new*) |

Then the full e2e suite (set writes are used in the workout) and the smoke pass in `CLAUDE.md`.

## 6. Privacy steps (`privacy-compliance` skill)

1. **Inventory first.** In the Plans row of `docs/privacy/data-inventory.md`, add
   `plan_revisions`: copies of the user's own plan data at each change, who made it (the user,
   a named assistant, or the app), the reason. Same category and basis as the plans
   (Art. 6(1)(b)); exercise notes in a snapshot are the same free text the plan holds. Retention
   as in section 9. Add that deleted programs and cycles are kept for restore for the trash
   period.
2. **MCP recipient row:** assistants can read the history (`list_revisions`) and restore.
3. **Policy** (`src/app/privacy/page.tsx`): one short paragraph on change history, the trash
   period and the history period.
4. **Export:** add `plan_revisions` to `collectUserData`; the coverage test fails until then.
   Soft-deleted rows are exported too (they are already, since the export does not filter).
5. **Delete:** `user_id` cascades.
6. **`LEGAL_VERSION`** bump (told, not asked). `CONSENT_VERSION` stays: no new kind of data.
7. **Logs:** ids and tags only (`[restorePlanRevision]`, `[undoPlanChangeSet]`, `[plan-conflict]`), never snapshot content.
8. **Friends:** no change; revisions are never shown to other users. A shared program copies the
   live program only, never its history.

## 7. Order of work

1. Migration, schema, live helpers, guard tests (failing), revision module.
2. Writers through `withPlanWrite`: Server Actions, then MCP, then progression and sync.
   "Today fails" tests first.
3. Readers: one group at a time, guard test green.
4. Restore and change-set undo.
5. Versions: MCP, then finish flush and queue, with the component tests.
6. UI: history pages, Recently deleted, AI changes feed.
7. Privacy, retention job, e2e specs, `pnpm verify`, full e2e, smoke pass.

## 8. Defaults chosen

- Version bumps only for `user`, `assistant` and restores; engine and sync writes never cause
  a conflict.
- Lazy baseline revision on the first write, instead of a migration that snapshots every row.
- No revision for a write that changes nothing.
- Slots are not soft deleted; a cycle restore rewrites them with their old ids.
- Deleting a program or a cycle used by an open workout is refused. Restoring one is refused
  likewise. Deleting a set or an exercise mid-workout stays allowed.
- A deleted cycle restored while another is active comes back as a draft.
- Conflict check per field against the base snapshot, so the user's own mid-workout edits do not
  conflict with their own finish flush.
- The assistant change set is a 30-minute window per OAuth client.
- `reason` and `expectedVersion` required on MCP writes to existing objects.
- MCP list and restore tools ship here, not in B1 (2.10).
- History shows automatic changes folded, not hidden.
- Re-running the sync after a restore keeps the current adaptation percent.

## 9. Retention rule

Owner decision 2:
- Revisions are kept 365 days. A daily purge (next to `purgeExpiredSessions`) deletes older
  ones, but always keeps each object's newest revision, so an object can always be restored to
  its last state.
- Programs and cycles soft deleted more than 90 days ago are deleted for good by the same purge,
  with their revisions. Their logged rows lose the link then, as a delete does today; no logged
  row is deleted. Exercises and sets deleted inside a live program stay hidden until the program
  is deleted, so logged rows keep their links.
- Account deletion removes everything at once (cascade).

## 10. Risks

- **Critical flows.** Set deletion and plan writes run mid-workout; the queue is the guard
  against lost sets. Component tests and both e2e specs above, plus the full suite.
- **A missed reader** shows a deleted set in a workout. The guard test makes a reader without
  the filter fail the build.
- **Lock time.** `withPlanWrite` locks one program row during a set edit. Writes are short; the
  sync locks each program in turn, never all at once.
- **Migration clash.** Other branches may add a migration. Rebase and regenerate before merge.

## 11. Plan corrections (to make in this PR)

- A4: there are more delete paths than the two named (1.1), and the plan's line numbers moved
  after A1. The text gets the full list.
- B1: "list and restore revisions" and the version check on existing write tools move to A4
  (2.10). B1 keeps the explicit change-set argument, version checks on its new tools, and field
  ownership in tool descriptions.

## 12. Owner decisions (2026-11-12)

The owner took every recommendation.

1. **Progression numbers on restore.** A set's target reps and weight (and duration or distance
   on a set with no peak anchor) go back to the restored values, except when the last change to
   that field after the restored revision came from `progression`; then the current value stays.
2. **Retention.** Revisions are kept 365 days, and each object's newest revision is always kept.
   Deleted programs and cycles can be restored for 90 days; then a daily purge deletes them for
   good. The purge runs in the existing daily job in `src/instrumentation.ts`, the `setInterval`
   that runs `purgeExpiredSessions` and `purgeExpiredOAuthTokens` at boot and every 24 hours.
3. **Online edits in the app** send no version: last write wins, and every change is a revision.
   The version check covers AI writes and the workout's finish flush, online or queued.
4. **Deleting a custom exercise** is fixed in this PR: it is refused when the exercise has logged
   sets or is in a live program, and the message says where it is used. A failing test comes
   first.

The defaults in section 8, and `list_revisions` and `restore_revision` in this package, are
accepted. The plan's A4 and B1 text is fixed in this PR (section 11).

## 13. Where the build differs from the first draft

- **No component test for a logged row on screen after a mid-workout set delete.** The draft
  said such a row "shows as an extra set" today. It does not: the set list renders the plan's
  sets, so a deleted set leaves the list before and after A4. What matters, that the logged row
  keeps its link and stays in history, is covered by integration tests.
- **The workout's plan version comes from the workout layout.** The layout reads the program's
  version and the session initializer stores it in `activeWorkout` when a workout starts; a
  resumed workout keeps the stored one. The finish flush builds its payloads in
  `src/lib/utils/finish-flush.ts`.
- **A conflict with no base revision is a conflict.** When the server finds no revision at the
  workout's version, every field not already at the new value counts as changed. This only
  happens for data written outside the revision layer.
- **Cycle start completes other cycles inside the layer.** `activateCycle` in
  `src/lib/plan-revisions.ts` touches each active cycle and the new one in one transaction, for
  the app and for MCP.
- **The guard tests are text scans** (`src/__tests__/plan-write-guard.test.ts`). They cannot see a
  slot's `program` relation, so slot readers use `liveSlotProgram` by hand.
