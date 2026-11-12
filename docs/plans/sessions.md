# Session model: several slots a day, dated sessions

Package C2 of [`triathlon-coach-plan.md`](triathlon-coach-plan.md). Branch `feat/sessions-c2`, on
top of A1-A4, B1-B4 and C1 (seasons, built in parallel on `feat/seasons-c1`). Inputs: the audit
(`docs/triathlon-coach-audit.md`, sections 1, 7, 8, 11 and decisions D7, D11, D16, D19, T5, T6,
T7), `CLAUDE.md`, `TESTING.md`, the draft brief [`quick-workout-and-swap.md`](quick-workout-and-swap.md)
(merged into this package, section 13), and the merged briefs [`foundations.md`](foundations.md),
[`revisions.md`](revisions.md), [`ai-coach.md`](ai-coach.md), [`seasons.md`](seasons.md) (C1) and
[`athlete-profile.md`](athlete-profile.md) (C3).

Status: built on `feat/sessions-c2`, 2026-11-13, on top of C1 (#227) and C3 (#226). The hub
decided the open questions (section 14, "Decisions"). The characterization tests (8.1) merged
first (#225) and pass unchanged after the build. Section 19 says where the build differs from
this brief, and section 11 what C1 changed. The **Findings** describe `main` at 2bdac35 (after
PR #224); every `file:line` in them was opened then, and the code has moved since. Names marked
*new* were new when the brief was written.

This is the riskiest package in the plan. It changes the core lifter flow. **A lifter with one
slot per day must see no change.** The build starts with characterization tests that pass on
`main` (section 8), and every change after that must keep them green.

## 0. Goal

1. A weekday cycle day can hold several slots, for example strength in the morning and a run in
   the evening (D7).
2. The cycle template creates **dated planned sessions** for every cycle, lifter cycles too
   (D16). Each one can be moved, skipped or changed alone.
3. A template edit regenerates only untouched future sessions. Moved or changed sessions keep
   their changes. Past sessions never change (T7).
4. Missed-workout detection, the rotation walker, the make-up prompts and the auto-session index
   work on the new model, with the current lifter behaviour pinned by tests first (D16).
5. Dated sessions are plan data: revisions, soft delete and versions through `planWrite` (T5,
   T6, T9).
6. The assistant can read, move, skip and change dated sessions over MCP (audit principle 3).
7. The training limits read dated sessions, so a moved session counts in the week it lands in.

Out of scope: matching to Garmin activities, "did you do it?" prompts, compliance and sick
periods (C5); structured workouts on a session (C4); the quick workout and session-only swap
(second PR, section 13).

## 1. Findings in the code

### 1.1 The template

- A slot is a day of the week or a rotation position pointing at a program, or at nothing for a
  rest day (`src/db/schema/training-cycles.ts:103-114`). One slot per day is a database rule:
  `uniq_cycle_day` (`src/db/schema/training-cycles.ts:117`). Rotation positions are unique too
  (`:118`).
- The app's slot upsert finds the slot to update by day alone
  (`src/lib/actions/training-cycles.ts:859-862`), as does the MCP `edit_cycle_slot`
  (`src/lib/mcp/tools/cycles.ts:467-470`). The schedule editor keys its rows by day
  (`src/components/features/CycleScheduleBuilder.tsx:154-156`), and "Rest" deletes the one slot
  of the day (`CycleScheduleBuilder.tsx:183-190`).
- Template writers: `upsertCycleSlot`, `removeCycleSlot`, `reorderCycleSlots`, `importCycle`,
  `updateTrainingCycle` (`src/lib/actions/training-cycles.ts:830`, `:900`, `:926`, `:955`,
  `:673`), the triathlon generator (`src/lib/actions/triathlon-plan.ts:148-154`), MCP
  `edit_cycle_slot` and `manage_training_cycle`, and a cycle restore, which deletes every slot and
  inserts the old ones with their old ids (`src/lib/plan-revisions.ts:1009`). The demo seed
  writes slots straight into the database (`scripts/lib/demo-data.ts:306-313`), and so does the
  admin demo seeding (`src/lib/actions/admin.ts:439-443`).
- Every plan write runs in `planWrite`, which compares each touched object's snapshot before and
  after and stores a revision (`src/lib/plan-revisions.ts:332-354`, entry at `:385`). A cycle
  snapshot is the row plus its slots (`src/lib/plan-revisions.ts:161`). `tableOf` knows programs,
  cycles and coach memory (`src/lib/plan-revisions.ts:117`).
- Cycle start and the scheduled start: `activateCycle` (`src/lib/plan-revisions.ts:529`),
  `scheduleCycle` (`:597`) and `startDueScheduledCycle` (`:638`), which `getActiveCycleForUser`
  calls first (`src/lib/actions/training-cycles.ts:152`).

### 1.2 Today's workout and missed workouts (`getActiveCycleForUser`)

All of it is in one read, `getActiveCycleForUser` (`src/lib/actions/training-cycles.ts:146`). It
also writes: it completes a block that is over (`:187-192`), runs the weekly sync (`:200-202`) and
inserts auto sessions (`:277`, `:335`).

**Weekday cycles.**
- Today's slot is the slot of today's weekday in the user's zone (`:224-226`).
- Missed: the last 7 days, bounded by the cycle start, where a slot has a program and the date is
  not in `completedDates` (`findDayOfWeekMissed`, `src/lib/utils/cycle-position.ts:248-276`).
- `completedDates` holds the date of **every** completed session of the user in the window, of
  any program and any source, plus each session's `intendedDate` (`:233-258`). So a session of
  another program clears the day, an empty session closed by the stale sweep clears the day, and a
  make-up clears both its own day and the day it makes up.
- Declined days (`dismissed_makeups`, keyed by date only, `src/db/schema/dismissed-makeups.ts:21`,
  `:25`) are filtered out (`src/lib/actions/training-cycles.ts:261-265`, `:284`).
- The off switch empties `missedSlots` but the auto days are still written (`:210-214`, `:228`,
  `:281`).

**Rotation cycles.**
- `walkRotation` walks from the start, one day at a time. A rest slot uses one day. A program slot
  waits for a completed session on that day and repeats when none comes (`missed`)
  (`src/lib/utils/cycle-position.ts:97-148`, repeat at `:139-143`).
- It reads every completed session of the user since the start, of any program, and ignores
  `intendedDate` (`src/lib/actions/training-cycles.ts:295-305`).
- It uses at most one session per day (`src/lib/utils/cycle-position.ts:93`, `:134-138`). This is
  BACKLOG "Two workouts in one day" (`BACKLOG.md:78`).
- Today's slot is the walk position (`resolveRotation`, `src/lib/utils/cycle-position.ts:155`).

**Auto days.**
- `autoCompleteDue` (`src/lib/utils/cycle-position.ts:202-239`): weekday cycles, today and the 7
  days before (bounded by the start); rotation, today's slot only. A day is left alone when a
  completed session **for that program** exists on it (`loggedKeys`, by program and date, with
  `intendedDate` on weekday cycles, `src/lib/actions/training-cycles.ts:254-257`), or the date is
  dismissed.
- `insertAutoSessions` writes a completed `source = 'auto'` row at noon
  (`src/lib/auto-sessions.ts:17-39`). The index `uniq_ws_auto_day` allows one auto row per user,
  program and date (`src/db/schema/workout-sessions.ts:75-77`); this is the "auto-session index".
- "I skipped it" (`skipAutoCompletedDay`) deletes the auto row and writes a dismissal for the date
  (`src/lib/actions/training-cycles.ts:372`, `:399-412`). `completeWorkoutSession` deletes the
  auto row of the same program and date (`src/lib/actions/workout-sessions.ts:181-192`).

**Make-up.**
- "Make up" links to `/programs/{id}/workout?makeup=YYYY-MM-DD` (`src/app/page.tsx:227`). The
  initializer reads the date (`src/components/features/WorkoutSessionInitializer.tsx:33-36`) and
  `createWorkoutSession` stores it as `intendedDate` (`src/lib/actions/workout-sessions.ts:75-86`,
  column at `src/db/schema/workout-sessions.ts:65`). History shows "Make-up for"
  (`src/components/features/HistoryClient.tsx:82-84`).
- "Decline" writes a dismissal for the date (`dismissMissedWorkout`,
  `src/lib/actions/training-cycles.ts:433`).

### 1.3 Screens that assume one session a day

- **Home** (`src/app/page.tsx`): one program for today (`:59`); "done today" means any completed
  session today (`:80`); the auto chip looks for today's program (`:82-87`); the rotation overdue
  badge counts from the first missed date (`:94-104`); the missed card (`:107-108`, `:212-240`);
  the week strip maps one slot per weekday (`:110-117`) and fills a day when any session is on it
  (`:255`).
- **New workout** (`src/components/features/NewWorkoutClient.tsx:19-26`) shows one "Today's
  Cycle" card from `todaySlot`. "Skip today" only goes home and writes nothing (`:43-48`).
- **Workout start** knows the program only (`src/app/programs/[id]/workout/layout.tsx:31`), and a
  restored workout of the same program resumes (`WorkoutSessionInitializer.tsx:130-150`).
- **Calendar** (`src/components/features/CycleCalendarClient.tsx:62-123`): one slot per weekday
  (`:79`); a rotation day shows the cycle with no program (`:94-107`).
- **The type** `ActiveCycleInfo` has one `todaySlot` (`src/types/workout.ts:121-132`).
- **History and metrics** count sessions, not days. History needs no change. The cycle summary in
  metrics counts sessions inside the block dates (`src/lib/actions/metrics.ts:1499-1509`).
- **The workout insight** reads only the week number from the cycle
  (`src/lib/actions/workout-sets.ts:1604`).

### 1.4 Other readers of the template

- **Weekly sync adherence**: completed sessions with sets (or `auto`) of the cycle's programs in
  the last 7 days, over the number of program slots (`src/lib/periodization-sync.ts:134-154`;
  PZ-26 in `docs/specs/cycle-periodization.md`). It only changes numbers on sets with a peak
  anchor, so lifters never see it.
- **Training limits**: `cycleWeekSessions` builds the week from slots by weekday and returns null
  for rotation cycles (`src/lib/training-limits.ts:151-188`); `hardSessionsPerWeek` counts them
  (`src/lib/utils/training-limits.ts:162-182`).
- **Garmin planned hours**: `plannedSets` sums one week of weekday slots and returns null for
  rotation (`src/lib/garmin/queries.ts:939-951`). The Garmin match of logged strength sessions to
  activities (`matchStrength`, `src/lib/garmin/analytics/daily.ts:82`) does not read the plan.
- **MCP**: `confirm_session` takes a date and a program (`src/lib/mcp/tools/sessions.ts:224-268`);
  `get_training_cycle` returns slots (`src/lib/mcp/tools/cycles.ts:96-120`). The instructions say
  "One workout slot per day" (`src/lib/mcp/instructions.ts:35`), and so does the rules doc
  (`docs/mcp/app-rules.md:95`).

### 1.5 Guards and privacy

- The guard test lists the plan tables whose writes must run in the layer
  (`src/__tests__/plan-write-guard.test.ts:58`).
- The export lists slots and dismissals (`src/lib/account-data.ts:135`, `:143`).

### 1.6 Test coverage today

Pure helpers have unit tests (`src/__tests__/cycle-position.test.ts`,
`src/__tests__/auto-complete-days.test.ts`). `getActiveCycleForUser` has integration tests only for
the time zone (`src/__tests__/integration/user-time-zone.test.ts:58-81`). Nothing tests the missed
list, dismissals, make-ups or auto days end to end, and no e2e spec opens the home card: the
helpers avoid it because it depends on the weekday (`e2e/helpers.ts:115-121`). Section 8 fills
this gap first.

## 2. Design overview

- **Weekday cycles** get stored dated sessions, one row per planned session, made for the whole
  block when the cycle starts or is scheduled. The row is the plan for that day. Today's list and
  the missed list read the rows.
- **Rotation cycles** keep the walker as the source of truth. A rotation has no fixed dates: a
  missed day repeats the slot, so every later date moves. Their dated sessions are a
  **projection** computed on read, and only a session the user or the assistant changes is
  stored, as an override on a walk position (section 3.4). A rotation lifter's numbers do not
  change at all.
- "Done" is never stored. A pure matcher links planned sessions to completed workout sessions on
  read, with the same fallbacks the app has today (section 4.1), so a one-slot lifter gets the
  same answers.
- One rule makes the regeneration hard to forget: `planWrite` regenerates the dated sessions of
  every cycle whose template changed in the write (section 3.3).

## 3. Data model

### 3.1 Slots

New column on `training_cycle_slots`:

| Column | Type | Meaning |
|---|---|---|
| `day_slot` | integer, not null, default 1, 1-3 | Order inside the day on a weekday cycle. Always 1 on rotation cycles |

`uniq_cycle_day` becomes unique on `(training_cycle_id, day_of_week, day_slot)`. A rest slot (no
program) is allowed only as the only slot of its day; the action and the MCP tool refuse a rest
slot next to a program slot. Rotation cycles stay at one slot per position (section 14, Q3).

### 3.2 Dated sessions

New table `planned_sessions` (*new*):

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `user_id` | text, FK `user`, cascade | Owner |
| `cycle_id` | integer, FK `training_cycles`, cascade | The cycle it belongs to |
| `slot_id` | integer, null, **no FK** | The template slot it came from. No FK, because a cycle restore deletes and re-inserts slots with their old ids (1.1); a FK would cascade or null the link. Null for a session added by hand |
| `template_date` | date, null | The date the template gave it. With `slot_id`, the key that regeneration matches on. Null for an added session |
| `rotation_position` | integer, null | Rotation overrides only: the walk position (0-based count of slots walked) this row overrides |
| `date` | date, null | The planned date now. Null only on a rotation override (its date follows the walk) |
| `position` | integer, not null, default 1 | Order inside the day |
| `program_id` | integer, null, FK `programs`, set null | The program to run. A deleted program reads as no program, as `liveSlotProgram` does for slots |
| `label`, `notes` | text, null | Copied from the slot; can be changed alone |
| `auto_complete` | boolean, not null, default false | Copied from the slot |
| `status` | text enum `planned`, `skipped` | Done and missed are derived (4.1). C5 adds `missed_illness` |
| `skip_reason` | text, null, max 200 | |
| `touched_at` | timestamp, null | Set by any user or assistant change. Null = untouched, so regeneration may rewrite it |
| `version` | integer, not null, default 1 | T9 |
| `deleted_at` | timestamp, null | T6 |
| `created_at`, `updated_at` | timestamp | |

Indexes: `(user_id, date)`; `(cycle_id, date)`; unique `(cycle_id, slot_id, template_date)` where
`deleted_at` is null and `template_date` is not null (makes generation idempotent under
concurrent renders); unique `(cycle_id, rotation_position)` where `deleted_at` is null and
`rotation_position` is not null.

New column on `training_cycles`: `sessions_generated_at` timestamp, null. Null means the cycle has
no generated sessions yet (a cycle from before this package, or a seeded one). Owned by the layer;
kept on restore and left out of the history diff.

### 3.3 Links from logged sessions

New column on `workout_sessions`: `planned_session_id` integer, null, FK `planned_sessions`,
`ON DELETE SET NULL`, with an index. Set when a workout starts from a planned session (the Start
and Make up links carry `?planned=<id>`), by `log_session` and `confirm_session` when given a
planned session, and on auto rows. The matcher (4.1) still handles sessions with no link: old
bundles, the program picker, offline starts.

The auto-session index (`uniq_ws_auto_day`) is split in two partial unique indexes:
- `(user_id, planned_session_id)` where `source = 'auto'` and `planned_session_id` is not null:
  one auto row per planned session, so two auto sessions on one day (or a moved one) both work.
- `(user_id, program_id, date)` where `source = 'auto'` and `planned_session_id` is null: the
  old rule for old rows and rotation auto days.

### 3.4 Generation and regeneration

Pure module `src/lib/utils/planned-sessions.ts` (*new*), unit tested:

- **Weekday generation.** For each day from the block start to the day before the block end, for
  each slot of that weekday with a program, one session with `template_date` = `date` = that day
  and `position` = `day_slot`. Rest days make no row. The block length comes from C1's length
  helper (days, or weeks times 7).
- **How far ahead.** The whole block, made in one go (Q1). A block is at most 52 weeks, so at most
  1,092 rows with three slots a day. Rows are made when a cycle becomes active (from its start
  date), when a draft is scheduled (from its scheduled start), and lazily for a live active or
  scheduled cycle whose `sessions_generated_at` is null (3.5).
- **Regeneration (T7).** Run inside the same transaction as any template change, for the cycle's
  rows. Let today be the user's today.
  - Kept as they are: rows with a date before today; rows that are done (4.1); rows with
    `touched_at` set; rows with no `template_date` (added by hand).
  - The rest are untouched future rows (date today or later, not done). The new template is
    generated for the same days and matched by `(slot_id, template_date)`. A match is updated in
    place, so its id stays. A new key is inserted. An untouched row with no new key is soft
    deleted.
  - A touched row whose slot left the template stays, as T7 says. The cycle page shows it as
    "Not in the template any more".
- **Start date and length.** A start on another day than planned, or a new length, regenerates in
  the same way. A touched row that now falls outside the block, or before today, is soft deleted
  and the result says how many ("2 moved sessions were outside the new dates and were removed").
- **Block ends early.** When a cycle completes because another one starts, its rows from today on
  that are not done are soft deleted. Past rows stay.
- **Unscheduling a draft** soft deletes its rows, touched ones too, with the same message.
- **Rotation.** Nothing is generated. A pure function projects the walk for a date range: past
  days from the completed sessions (the walker, unchanged), future days assuming each session is
  done on its day. Overrides change the walk in two ways only: a **skip** at a position uses that
  position on its day as if done, and a **change** at a position runs another program when that
  position comes. A rotation session cannot be moved: it moves by itself when it is not done
  (Q2).

**The hook.** `planWrite` already compares a cycle's snapshot before and after
(`src/lib/plan-revisions.ts:332-354`). C2 adds a regeneration step there for every touched or new
cycle whose template part changed (slots, start date, length, status, scheduled start, schedule
type; C1's day length when it lands). Writers that need the new rows inside the write, such as
the limits check, call the same step themselves first. The step only runs once per cycle per
write.

**Writer and revisions.** Generation and regeneration write no `planned_session` revisions: they
follow from the cycle revision, which already has the whole template. A planned session gets its
first revision when a user or an assistant changes it (A4's lazy baseline).

### 3.5 Backfill (lazy, not in SQL)

The migration adds tables and columns only. The first read of a live active or scheduled cycle
with `sessions_generated_at` null generates its rows in a `planWrite` with writer `sync`, under the
cycle lock, and stamps the column. For an active cycle, the rows start at the block start, so the
last 7 days exist for the missed list. Rows on a date in `dismissed_makeups` get `status =
skipped`. The unique index turns a racing second render into a no-op.

Why lazy: one code path in TypeScript, tested like any other, and it also covers the demo seed,
the admin seeding and the e2e reset, which write slots straight into the database (1.1). Draft and
completed cycles get no rows.

### 3.6 Field owners

| Field | Owner (writers) | On restore |
|---|---|---|
| Planned session `date`, `position`, `program_id`, `label`, `notes`, `status`, `skip_reason` | user, assistant; the template regeneration while untouched | Restored. A restore refuses a session that is done |
| `touched_at` | set by every user or assistant change; cleared by "Reset to template" | Restored with the row |
| `slot_id`, `template_date`, `rotation_position`, `cycle_id` | set at generation | Kept |
| `auto_complete` | copied from the slot | Restored |
| `version`, `deleted_at` | the revision layer | Kept, then the version bumps |
| Cycle `sessions_generated_at` | the layer | Kept |
| Slot `day_slot` | user, assistant | Restored with the cycle |

## 4. Rewritten logic

### 4.1 The matcher

Pure function in `src/lib/utils/planned-sessions.ts`. Input: the planned sessions of a date range
(not skipped, not deleted) and the user's completed workout sessions of that range. For each date,
planned sessions in `position` order:

1. **Linked:** a completed session with this `planned_session_id`.
2. **Same program:** an unused completed session on that date (its `date` or its `intendedDate`)
   of this program.
3. **Any session:** an unused completed session on that date (its `date` or its `intendedDate`).

A session is used at most once per date. So a make-up still clears both its own day and the day
it makes up, as today. Step 3 is today's "any session clears the day" rule (1.2): a lifter who
does another program, an empty swept session or a quick workout on a planned day still gets the
day done (Q8). With one slot a day the result equals `findDayOfWeekMissed` for every input; a
property test checks that (section 8).

Output per planned session: `done` with the workout session id, or not done. A past not-done
session is **missed**.

### 4.2 Today and missed (weekday cycles)

`getActiveCycleForUser` reads the rows of today and the 7 days before (bounded by the start):
- **Today:** today's rows in `position` order, each with done, its auto row, and its program.
  `todaySlot` stays in `ActiveCycleInfo` for old callers: the slot of the first not-done session,
  else of the first session. A *new* `todaySessions` list carries all of them.
- **Missed:** past rows in the window that are planned and not done, oldest first, each with the
  planned session id. The off switch still empties the list.
- **Auto days:** a row with `auto_complete` in the same window (today included) that is not done
  by step 1 or 2 of the matcher gets an auto row with its `planned_session_id`. Step 3 does not
  count, as today's `loggedKeys` does not (1.2).

### 4.3 Rotation

Unchanged walker. `getActiveCycleForUser` passes the stored overrides to the walk: a skip uses its
position on the day it comes due; a change gives today's entry another program. With no overrides
the output is the same as today, which the existing walker tests pin.

### 4.4 Make up, decline, skip

- **Make up** links to `/programs/{id}/workout?makeup=<date>&planned=<id>`. `intendedDate` is still
  stored, so history keeps "Make-up for". The new session links to the missed row.
- **Decline** skips that one row (writer `user`, a revision). It also writes the old
  `dismissed_makeups` row for the date when no planned, not-done row is left on that date, so the
  previous image still hides the day after a rollback. Reads use the row status only.
- **"I skipped it"** on an auto day deletes the auto row and skips its planned session (and writes
  the dismissal by the same rule).
- `completeWorkoutSession` deletes the auto row of the same program and date, as today, and also
  the auto row of its own planned session.

## 5. UI

The rule: a lifter with one slot a day sees the same home, workout and history screens.

- **Home.** One session today: the same card as now, word for word. Two or three: one row per
  session in the card, each with its name, the done chip and its own Start (or Do again) button.
  The week strip marks a day with more than one session with a small count. A moved session shows
  on its new day.
- **Start links** carry `?planned=<id>`. The initializer passes it to `createWorkoutSession`, which
  checks that the planned session is the user's, live, and on this program, and drops it
  otherwise. A resumed workout keeps its link.
- **Calendar** (`/more/calendar`): each day lists its planned sessions with Move and Skip in the
  day sheet (Q6). Move picks a date from today to the block end and a position. A touched session
  has "Reset to template". A rotation day stays as today (Q14).
- **Cycle editor.** The day sheet gets "Add another session on this day" (up to 3) and a per-slot
  remove. The day list stays one line per day with one slot; with more, the line shows "Strength,
  Run".
- **New workout.** The "Today's Cycle" card shows the first not-done session; with more than one,
  a short list.
- **Cycle history** (`/cycles/[id]/history`) also lists the revisions of the cycle's planned
  sessions ("Moved Squat day from Mon 3 Mar to Wed 5 Mar").
- All client calls through `callAction()`. 44 px targets, `:active` feedback.

## 6. MCP

All write tools take `reason`; writes to an existing planned session take `expectedVersion` (the
session's). Results return the new version and the change set.

| Tool | Hint | What it does |
|---|---|---|
| `list_planned_sessions` (*new*) | read | `from`, `to` (at most 93 days), optional `cycleId`. Weekday cycles: the rows. Rotation: the projection, each entry with `rotationPosition` and an id only when an override is stored. Per entry: date, position, program, label, notes, status (`planned`, `done` with the logged session id, `missed`, `skipped` with the reason), auto, touched, template date, version |
| `manage_planned_session` (*new*) | write | `move` (date, position), `skip` (reason), `unskip`, `change` (program, label, notes, position), `add` (an extra session on a date of a weekday cycle), `remove` (added sessions only; template sessions are skipped), `reset` (back to the template). Rotation: `skip`, `unskip` and `change` by `cycleId` and `rotationPosition` |
| `confirm_session` | write | Also takes `plannedSessionId`; date and program still work |
| `log_session` | write | Optional `plannedSessionId` |
| `edit_cycle_slot` | write | Optional `daySlot` (1-3) on weekday cycles; the result says how many future sessions were regenerated |
| `get_training_cycle` | read | Slots carry `daySlot`; adds the count of touched future sessions |
| `list_revisions`, `restore_revision` | read, write | Accept object type `planned_session` |

**Limits.** `move`, `change`, `add` and `unskip` run the limits: `hard_sessions_per_week` on each
Monday-to-Sunday week the change touches, `long_run_cap` on a changed program. The week now comes
from the planned sessions of that calendar week (moved sessions in the week they land in, skipped
ones left out, several a day counted each), for both template writes and session writes. Rotation
cycles stay "not checked" (Q17). Later D2 rules (48 h, low readiness) read the same rows.

Instructions and `docs/mcp/app-rules.md`: remove "One workout slot per day"; explain slots per day,
dated sessions, T7, the rotation projection, and that the review should read
`list_planned_sessions` for the coming weeks. The tool-group test gets the new tools.

## 7. Revisions, soft delete and versions

- Object type `planned_session` (text enum, no SQL). Snapshot `{ "v": 1, "session": {row},
  "programName" }`. Diff text: moved, skipped, unskipped, program changed, reset.
- Restore of one session: the row's owned fields (3.6). Refused for a session that is done ("This
  session is logged; past sessions do not change"). A restore runs the limits as warnings (T4),
  like other assistant restores.
- A cycle restore restores the template; the hook then regenerates untouched future rows. Touched
  rows keep their own history.
- Soft delete for rows. The daily purge deletes rows soft deleted more than 90 days ago, unless a
  workout session links to them; a cycle purge removes its rows through the FK.
- Readers filter deleted rows and rows of deleted cycles. The guard tests add `plannedSessions` to
  the write scan and to the live-filter scan.
- Versions per session (T9): an assistant moving one session does not conflict with a cycle edit.
  App edits send no version, as A4 decided.

## 8. Tests

### 8.1 Characterization tests, first, on `main`

Written and green on `main` **before any other change**, in their own commit. They describe what a
lifter gets today. The same tests then pass after every later commit, unchanged except for setup
that must create the new rows the lazy way (no test assertion may change).

| # | Layer | What it pins | File |
|---|---|---|---|
| C1 | Unit | `findDayOfWeekMissed`: a session of another program clears the day; a make-up clears both dates; rest and unassigned days are never missed | `src/__tests__/cycle-position.test.ts` |
| C2 | Unit | `walkRotation`: two sessions on one day advance one step; a session of a program outside the cycle advances; `intendedDate` is ignored | same |
| C3 | Integration | Weekday today: today's slot by weekday in the user's zone; a rest day gives a slot with no program; a day with no slot gives none | `src/__tests__/integration/cycle-today.test.ts` (*new*) |
| C4 | Integration | Weekday missed: dates and slots of the last 7 days, bounded by the start, oldest first; cleared by any completed session that day (another program, an empty swept session, an `assistant` session); cleared by a make-up's `intendedDate`; a declined date is gone; the off switch empties the list | same |
| C5 | Integration | Auto days: written for today and the past 7 days; not written when the same program was logged; written when another program was logged; "I skipped it" deletes it and it is not recreated or missed; finishing a real session of that program and date deletes it; two concurrent reads write one row | same |
| C6 | Integration | Rotation: today's slot by the walk; a miss repeats the slot and gives the overdue date; the auto row only for today; the off switch hides the overdue | same |
| C7 | Integration | Block end completes the cycle and returns null; a scheduled start on its day starts the cycle | same |
| C8 | Integration | Make up: `createWorkoutSession` with `intendedDate` stores it; finishing it clears the missed day; `dismissMissedWorkout` writes one row per date | same |
| C9 | Integration | Weekly sync adherence: the same percent for a fixed week of sessions (PZ-26) | `src/__tests__/integration/training-cycles.test.ts` |
| C10 | Integration | `hard_sessions_per_week` counts weekday slots, a program on two days twice; rotation is not checked | `src/__tests__/integration/mcp-limits.test.ts` |
| C11 | Integration | `confirm_session` writes one auto row and is idempotent | `src/__tests__/integration/mcp-sessions.test.ts` |
| C12 | e2e | Home with a cycle built by `testDb()` from today's weekday: today's program and "Start Today's Workout"; yesterday missed with "Make up" and "Decline"; Make up, log a set, finish: the day leaves the list and `testDb()` shows `intended_date`; Decline hides a day; a rotation cycle shows the overdue badge | `e2e/cycle-day.spec.ts` (*new*) |

### 8.2 New tests

| Layer | What | File |
|---|---|---|
| Unit | Generation: block dates, slots per day, rest days make no row, day-length blocks (C1) | `src/__tests__/planned-sessions.test.ts` (*new*) |
| Unit | Regeneration: untouched future updated in place by key, new keys added, dropped keys soft deleted; past, done, touched and added rows kept; a start-date change; rows outside the block | same |
| Unit | Matcher: link first, then program, then any; one use per date; a make-up counts twice; property test: one slot a day equals `findDayOfWeekMissed` on random weeks | same |
| Unit | Rotation projection: no overrides equals `walkRotation`; a skip uses its position; a change swaps the program; future days | same |
| Unit | Revision diff text; guard tests for `planned_sessions` | `src/__tests__/plan-revisions.test.ts`, `src/__tests__/plan-write-guard.test.ts` |
| Component | Calendar day sheet: lists several sessions, Move and Skip call the actions through `callAction()`, a rotation day unchanged | `src/__tests__/components/cycle-calendar.test.tsx` (*new*) |
| Integration | Lazy backfill: one generation under concurrent reads; dismissed dates become skipped; seeded cycles get rows | `src/__tests__/integration/planned-sessions.test.ts` (*new*) |
| Integration | Every template writer regenerates (slot upsert, remove, reorder, import, generator, update, start, schedule, unschedule, restore, MCP slot and cycle tools); touched rows survive; past rows never change | same |
| Integration | Move, skip, unskip, change, add, remove, reset: ownership (another user refused, nothing changed), revisions with the right writer, no-op makes none, restore, refused on a done session | same |
| Integration | Two slots on one day: log one, the other stays planned and is missed the next day; both auto rows written; Start link sets `planned_session_id`; a foreign planned id is dropped | same |
| Integration | MCP tools in section 6: happy path, stale `expectedVersion`, other user's ids, read-only scope refuses writes, limits on a move into a full week | `src/__tests__/integration/mcp-planned-sessions.test.ts` (*new*), `src/__tests__/integration/mcp-scopes.test.ts` |
| Integration | Migration: indexes, `day_slot` default, old auto rows still unique | `src/__tests__/integration/migrations.test.ts` |
| Integration | Export has `planned_sessions`; delete removes them; the purge | `src/__tests__/integration/account-data.test.ts` |
| e2e | Two sessions today: both show, log one, the other stays; move a session in the calendar to tomorrow, `testDb()` shows the new date and a revision; skip one | `e2e/planned-sessions.spec.ts` (*new*) |

Then `pnpm verify`, `make e2e` and the 9-step smoke pass in `CLAUDE.md` (critical flow).

## 9. Migration and rollback

One migration from `pnpm db:generate` (create, not rename), numbered after C1's and C3's (the hub
renumbers), SQL and `drizzle/meta/` in one commit:
- `CREATE TABLE planned_sessions` with FKs and indexes (3.2).
- `ALTER TABLE training_cycle_slots ADD COLUMN day_slot integer NOT NULL DEFAULT 1`; drop
  `uniq_cycle_day`; add the new unique key.
- `ALTER TABLE training_cycles ADD COLUMN sessions_generated_at timestamp`.
- `ALTER TABLE workout_sessions ADD COLUMN planned_session_id` with the FK and index.
- Drop `uniq_ws_auto_day`; create the two partial unique indexes (3.3). Existing rows all have a
  null planned id, so they fall under the old rule and stay unique.

No data step: generation is lazy (3.5).

**Rollback.** Data lost: moves, changes and added sessions; skips other than declines of a whole
day (those are also in `dismissed_makeups`); second and third slots of a day if step 3 runs.
1. While the new code runs: `DELETE FROM plan_revisions WHERE object_type = 'planned_session';`
   (the old image's history reader fails on an unknown snapshot, the same reason as C1 and B4).
2. Deploy the previous image. It ignores the new table and columns. With two slots on a day it
   reads one of them (`findFirst` and the weekday maps), which is a degraded but working view.
3. Then, optionally:
   ```sql
   DELETE FROM training_cycle_slots WHERE day_slot > 1;
   ALTER TABLE workout_sessions DROP COLUMN planned_session_id;
   DROP TABLE planned_sessions;
   ALTER TABLE training_cycles DROP COLUMN sessions_generated_at;
   ALTER TABLE training_cycle_slots DROP CONSTRAINT <new key>, DROP COLUMN day_slot,
     ADD CONSTRAINT uniq_cycle_day UNIQUE (training_cycle_id, day_of_week);
   DROP INDEX <both new auto indexes>;
   CREATE UNIQUE INDEX uniq_ws_auto_day ON workout_sessions (user_id, program_id, date)
     WHERE source = 'auto';
   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<hash of this migration>';
   ```
   The last `CREATE UNIQUE INDEX` fails if two auto rows for the same program and day exist;
   delete the newer of each pair first.

## 10. Privacy steps (`privacy-compliance` skill)

1. **Inventory first** (`docs/privacy/data-inventory.md`), Plans row: add `planned_sessions` (the
   date, program, order, notes and skip reason of each planned session) and
   `workout_sessions.planned_session_id`. Same purpose and basis (Art. 6(1)(b)). A skip reason is
   free text and can mention health ("knee sore"), the same as program notes. Object type
   `planned_session` follows the Plans revision rule.
2. **MCP recipient row:** assistants read planned sessions and, with read and change, move, skip
   and change them.
3. **Policy** (`src/app/privacy/page.tsx`): one sentence on planned sessions in the plans section.
4. **MCP consent page:** planned sessions in the list.
5. **Export:** `planned_sessions` in `collectUserData`; the coverage test fails until then.
   Soft-deleted rows too.
6. **Delete:** `user_id` cascades.
7. **`LEGAL_VERSION`** bump. `CONSENT_VERSION` stays: no new kind of data.
8. **Logs:** ids and tags only (`[planned-sessions]`); never notes or skip reasons.
9. **Friends:** planned sessions are never shown to other users.
10. **Browser storage:** none new. The `planned` URL parameter is not stored on the device.

## 11. C1: what changes when it merges, and the rebase plan

C1 (seasons) merges before this package. What it brings that C2 uses:
- **The length helper and `cycleWeek` with days** (T8). Generation uses them, never `weeks * 7`.
- **Chained phases** use the scheduled start: when a phase becomes active, C1 schedules the next
  one. In C2 that schedule generates the next phase's rows at once, so the assistant can see and
  move sessions of the next phase. A changed length of the active phase reschedules the next one;
  its untouched rows move with it (3.4).
- **Fit taper** changes the length of the phase before the taper: its tail regenerates.
- **A race date change** flags the season only (D17). No session changes.
- **Phase types** do not change sessions; the weekly sync still scales program sets.

Rebase plan:
1. Wait for C1 to merge. Rebase `feat/sessions-c2` on `main`.
2. Drop and regenerate this package's migration so its number and `drizzle/meta/` snapshot come
   after C1's (and C3's, if it merged). Re-run the migration test.
3. Merge by hand in `src/lib/plan-revisions.ts` (object types, `tableOf`, the restore switch),
   `src/db/schema/plan-revisions.ts`, `src/lib/utils/plan-revisions.ts`, the MCP instructions and
   `docs/mcp/app-rules.md`, `src/lib/account-data.ts`, the data inventory and `LEGAL_VERSION`.
4. Run the characterization tests on the rebased `main` first, then the full suite.

Nothing else merges while C2 is in review (plan section 4).

## 12. Order of work

1. Characterization tests (8.1) on `main`, green, own commit. Stop here if one fails on `main`:
   that is a bug to report, not to fix silently. Done in commit 9083dac.
2. Migration and schema; existing tests green.
3. Pure module: generation, regeneration, matcher, rotation projection, with unit tests.
4. Layer: object type `planned_session`, snapshot, restore, purge, guards; the regeneration hook
   in `planWrite`; lazy backfill.
5. `getActiveCycleForUser`, make up, decline, auto days, `completeWorkoutSession` on the new model.
   Characterization tests green.
6. Server Actions for move, skip, change, add, reset; limits on the new week; Garmin planned hours
   from the rows.
7. MCP tools, instructions, rules doc.
8. UI: home, new workout, start links, calendar, cycle editor, cycle history.
9. Privacy steps, e2e specs, `pnpm verify`, `make e2e`, smoke pass.

## 13. Quick workout and session-only swap

The plan lets the quick-workout part ship as a second PR. **Recommendation: yes.** The dated
session model is reviewed alone; the quick workout follows as C2b on its own branch once C2 is on
`main`, from the draft brief, with these changes:
- An ad-hoc program is never in a template, so it never gets planned sessions.
- A quick workout on a planned day still clears that day through matcher step 3, as any session
  does today.
- A session-only slot belongs to a workout session, not to a planned session. "Change this
  session" in C2 means program, label, notes and order (Q9); per-day exercise changes are C2b's
  session-only slots (during the workout) and C4's workouts (in the plan).
- The draft's reader list gets `list_planned_sessions` (ad-hoc programs are not offered as a
  `change` target).

## 14. Open questions, with recommendations

The owner is away; the hub decides. Each recommendation is the safest choice for lifters.

1. **How far ahead do weekday sessions exist?** Recommend: the whole block, made when the cycle
   starts or is scheduled. The assistant sees the block, the limits see every week, and chained
   phases get rows when scheduled. A rolling window would write on many page reads.
2. **How do rotation cycles map onto dates?** Recommend: the walker stays the source of truth, the
   dates are a projection on read, and only overrides are stored (skip, change; no move, because
   a rotation session moves by itself when not done). Fixed dates would change what a rotation
   lifter sees after one missed day.
3. **Several slots a day for rotation cycles?** Recommend: no, weekday cycles only in C2.
4. **How many slots a day?** Recommend: at most 3.
5. **Who sees "Add another session on this day"?** Recommend: everyone, inside the day sheet of
   the cycle editor only, so the day list looks the same.
6. **Where do Move and Skip live for lifters?** Recommend: the calendar day sheet and MCP. The
   home card stays as it is; "Missed this week" keeps Make up and Decline.
7. **Move rules.** Recommend: from today to the last day of the block; never to a past date; a
   done session cannot move; a missed session can move forward.
8. **Does any logged session clear a planned session (matcher step 3)?** Recommend: yes, as today.
   C5 can make endurance sessions stricter.
9. **What can "change alone" change in C2?** Recommend: program, label, notes and order. Planned
   sets per date wait for C4 (workouts on a session) and C2b (session-only slots).
10. **Quick workout in a second PR?** Recommend: yes (section 13).
11. **Weekly sync adherence on dated sessions?** Recommend: not in C2; keep PZ-26 as it is and move
    it in C5 with compliance.
12. **A make-up clears two days (its own and the one it makes up).** Recommend: keep it.
13. **`dismissed_makeups`.** Recommend: keep the table and write it when a whole day is skipped,
    for rollback; reads use the status. Drop it a release later (a BACKLOG entry).
14. **Rotation days in the calendar.** Recommend: unchanged in C2 (no projected names), with a
    BACKLOG entry.
15. **Start on another day, or unschedule.** Recommend: touched sessions inside the new block stay;
    others are removed with a count in the result.
16. **Garmin planned hours from dated sessions.** Recommend: yes (admin only, low risk).
17. **Limits on rotation cycles from the projection?** Recommend: no, still "not checked".
18. **Backfill.** Recommend: lazy, on the first read of an active or scheduled cycle; drafts and
    completed cycles get no rows.

### Decisions

Decided by the hub on 2026-11-12, owner may change. The hub took every recommendation above.

1. Weekday sessions exist for the whole block, made at start or schedule.
2. Rotation dates are a projection on read; only skip and change overrides are stored; no move.
3. Several slots a day on weekday cycles only.
4. At most 3 slots a day.
5. "Add another session on this day" for everyone, inside the editor's day sheet only.
6. Move and Skip in the calendar day sheet and over MCP; home and "Missed this week" unchanged.
7. Move from today to the block end; never to a past date; a done session cannot move.
8. Any logged session on the day clears a planned session (matcher step 3), as today.
9. "Change alone" covers program, label, notes and order.
10. The quick workout ships as a second PR (C2b) after C2.
11. Weekly sync adherence stays as it is in C2; C5 moves it.
12. A make-up keeps clearing both its own day and the day it makes up.
13. `dismissed_makeups` stays and is written when a whole day is skipped; dropped a release later.
14. Rotation days in the calendar stay as they are in C2.
15. On a start on another day or an unschedule, touched sessions inside the block stay; others go, with a count.
16. Garmin planned hours read the dated sessions.
17. The hard-sessions limit stays "not checked" on rotation cycles.
18. The backfill is lazy, on the first read of an active or scheduled cycle.

## 15. Defaults chosen

- Done and missed are derived on read, never stored.
- `todaySlot` stays in `ActiveCycleInfo`; `todaySessions` is added.
- Planned sessions have their own version; editing one does not bump the cycle's.
- Generation writes no planned-session revisions; the first user or assistant change does (lazy
  baseline).
- No `slot_id` FK, because of how cycle restore rewrites slots.
- The Start and Make up links carry the planned id; every other entry point still matches.

## 16. Risks

- **Home and workout start.** The home read changes. The characterization tests and the e2e spec
  come first; the smoke pass runs before push.
- **Regeneration bugs.** A wrong key would wipe a user's moves. The unit tests cover every row
  kind, and the integration tests run every template writer.
- **Write on read.** The lazy backfill and the auto rows write inside a Server Component read, as
  auto days and the block end already do. Idempotent by unique keys.
- **Offline replay.** A queued set never names a planned session; only the session start does,
  and that needs the network today.
- **Migration clash** with C1 and C3: renumber on rebase (section 11).

## 17. Plan corrections (in the build PR)

Made: C1 `done` and C2 `building` in the plan and the briefs README (C1's own PR left C1 at
`building`). The plan's C2 text now says that rotation dates are a projection.


- C2 status `brief`.
- The plan says "The cycle template creates dated planned sessions for every cycle". For rotation
  cycles the dates are a projection with stored overrides (Q2). Say so in the plan.
- `uniq_cycle_day` stays as a name but now includes `day_slot`.

## 18. Files

New: `src/db/schema/planned-sessions.ts`, `src/lib/utils/planned-sessions.ts`,
`src/lib/planned-sessions.ts`, `src/lib/actions/planned-sessions.ts`,
`src/lib/validators/planned-sessions.ts`, `src/lib/mcp/tools/planned-sessions.ts`, calendar sheet
components, the tests in section 8, the migration.

Changed: `src/db/schema/training-cycles.ts`, `src/db/schema/workout-sessions.ts`,
`src/db/schema/plan-revisions.ts`, `src/lib/plan-revisions.ts`, `src/lib/utils/plan-revisions.ts`,
`src/lib/plan-live.ts`, `src/lib/utils/cycle-position.ts`, `src/lib/actions/training-cycles.ts`,
`src/lib/actions/workout-sessions.ts`, `src/lib/auto-sessions.ts`, `src/lib/training-limits.ts`,
`src/lib/garmin/queries.ts`, `src/lib/validators/training-cycles.ts`,
`src/lib/validators/workout.ts`, `src/lib/mcp/tools/cycles.ts`, `src/lib/mcp/tools/sessions.ts`,
`src/lib/mcp/instructions.ts`, `docs/mcp/app-rules.md`, `src/app/page.tsx`,
`src/components/features/{NewWorkoutClient,WorkoutSessionInitializer,CycleCalendarClient,CycleScheduleBuilder}.tsx`,
`src/types/workout.ts`, `src/lib/account-data.ts`, `docs/privacy/data-inventory.md`,
`src/app/privacy/page.tsx`, `src/app/oauth/consent/page.tsx`, `src/lib/constants/legal.ts`,
`docs/cycles-and-plans.md`, `docs/data-model.md`.

## 19. Where the build differs from the brief

- **What C1 changed (section 11).** Generation reads the length from `cycleLengthDays` and the
  end from `cycleWeek` with `durationDays`. C1's chained phases schedule the next phase through
  `chainSeason`, a cycle write inside `planWrite`, so the regeneration step makes that phase's
  sessions when it is scheduled; a catch-up start of a phase whose day has passed makes its past
  sessions too, since it is the cycle's first generation. The backfill locks the cycle with C1's
  `lockCycleRows`. The revision object types are now program, cycle, memory, athlete, threshold,
  injury, season and `planned_session`; the change-set undo locks sessions last.
- **The regeneration step** sits in `PlanWriteSession.finish` (`src/lib/plan-revisions.ts`): it
  compares each touched cycle's template (slots, status, dates, length, schedule type) before
  and after, and regenerates on a change. `sessions_generated_at` is left out of the cycle
  snapshot, so stamping it makes no revision.
- **The one-session Start link and the Make up link keep their old address** (no `?planned=`).
  The characterization spec C12 pins the old addresses, and the matcher links such a workout to
  its session by program and date. Only the rows of a day with several sessions carry
  `?planned=<id>`.
- **New workout page:** unchanged. Its card reads `todaySlot`, which is the first session not
  yet done.
- **Training limits on template writes** still count the template's week (now with several
  slots a day, each counted). The calendar week of dated sessions is counted for session
  writes (`move`, `change`, `add`, `unskip`), where sessions can leave their template day.
- **Rotation overrides** are written over MCP only; the app has no rotation skip button yet, and
  the rotation calendar stays as it was (decision 14).
- **Decline with a date and no session** (an app bundle from before C2) skips every session
  planned that day, which is what a decline meant before.
- **A session restore** is refused when a completed workout is linked to the session, or when it
  would move a session whose day has passed.
- **Cycle history** lists the revisions of the cycle's dated sessions with the template's own.
- **Calendar:** when a completed cycle and the active one span the same day, the active one now
  shows. The e2e spec found this: a block completed early kept its old dates and hid the new one.
- **`findDayOfWeekMissed`** is no longer called by the app. It stays for the characterization
  tests and for the property test that the matcher misses exactly what it missed.
