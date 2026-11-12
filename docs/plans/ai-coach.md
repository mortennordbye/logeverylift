# AI coach: MCP parity, coach memory and the first training limits

Packages B1 (MCP parity, part 1), B4 (coach memory) and the first part of D2 (training limits)
of [`triathlon-coach-plan.md`](triathlon-coach-plan.md). One branch and one PR
(`feat/ai-coach-b1-b4`), on top of package A4 ([`revisions.md`](revisions.md), being built in
parallel). Inputs: the audit (`docs/triathlon-coach-audit.md`, sections 7, 8, 9 and decisions
D1-D6, D15, D18, T2-T5, T9, T10), the research (`docs/research/endurance-training-reference.md`),
`CLAUDE.md`, `TESTING.md` and the merged briefs [`mcp-access.md`](mcp-access.md) and
[`foundations.md`](foundations.md).

Status: brief, 2026-11-12. The owner settled the open questions on 2026-11-12 (section 12). The
**Findings** describe `main` at ec8ee7d; every `file:line` in them was opened then. Names marked
*new* do not exist yet. Names from A4 (`withPlanWrite`, `plan_revisions`, `changeSetFor`,
`diffSnapshots`, `list_revisions`, `restore_revision`) are defined in `revisions.md` and do not
exist on `main` yet.

## 0. Goal

After this PR the owner can run a weekly review with Claude on the current cycle model:

1. The assistant can set every cycle field the coach needs: race date and distance, goal, athlete
   level, and a start date in the future.
2. It can find exercises, create a custom one, log a session done outside the app, and confirm a
   planned day as done.
3. It can read the free-text notes on sessions and sets (D6).
4. Each field has one owner, and every tool description says who owns what, including how an AI
   volume change goes through `adaptation_pct`.
5. Coach memory: a per-user list of context entries that the assistant and the user read and
   write, kept between conversations, with revisions (T10, T5).
6. Two training limits run in code on AI writes (D3): the 1.10x long-run cap and hard sessions
   per week. A write that breaks one is not applied; the assistant may resend it with an override
   and a reason, and the revision stores both. User edits in the app are not checked (D4).
7. Every MCP write tool, old and new, has integration tests.

For a lifter nothing changes, except a "Coach memory" entry on the More screen.

## 1. Findings in the code

### 1.1 Cycle fields over MCP

- `manage_training_cycle` takes name, duration, schedule, end action, end message and status
  only (`src/lib/mcp/tools/cycles.ts:96-104`). The columns for goal, athlete level and race exist
  (`src/db/schema/training-cycles.ts:44-46`, `:51-53`, `:65-67`).
- `start` always uses today (`src/lib/mcp/tools/cycles.ts:189`, `:205`), as does the app's
  `startTrainingCycle` (`src/lib/actions/training-cycles.ts:767`, the write at `:788`). Neither
  the app nor MCP can schedule a block to start later.
- A future `startDate` on an active cycle would not work as is: `cycleWeek` clamps the week to 1
  for a start in the future (`src/lib/utils/cycle-position.ts:57-70`, clamp at `:65`), so the
  home screen would show the new block's workouts before it starts, and starting it completes the
  current block at once (`src/lib/actions/training-cycles.ts:775-783`).
- The app's cycle update takes the race but not goal or athlete level
  (`src/lib/validators/training-cycles.ts:22-31`). Adding a race is gated on the endurance switch
  (`src/lib/actions/training-cycles.ts:687-693`). Goal and level are set only by the triathlon
  generator today.
- `getActiveCycleForUser` already writes during a read: it completes a block that is over
  (`src/lib/actions/training-cycles.ts:168-180`). A scheduled start can use the same place.

### 1.2 Exercises

- The app lists system exercises plus the user's own custom ones (`getAllExercises`,
  `src/lib/actions/exercises.ts:16`). Search is done in the browser. MCP has no exercise tool;
  `edit_program_exercise` needs an `exerciseId` the model cannot look up.
- `createCustomExercise` (`src/lib/actions/exercises.ts:42`) checks the name against system
  exercises and the user's own (`:58-66`). It does not take `discipline` or `isTimed`, although
  both are columns (`src/db/schema/exercises.ts:96`, `:103`).
- **Bug:** `exercises.name` is unique across all users (`src/db/schema/exercises.ts:94`,
  constraint `exercises_name_unique` in `drizzle/0000_quick_rhodey.sql:53`, still in the latest
  snapshot). If user A has a custom "Trail run", user B cannot create one: the clash check passes,
  the insert fails, and B sees "Failed to create exercise". An assistant that creates exercises
  will hit this more often. Fixed in this PR (decision 6).

### 1.3 Logged sessions and notes

- The workout tools leave notes out on purpose (`src/lib/mcp/tools/workouts.ts:10-11`; the set
  fields at `:32-45` and the session select at `:87-107`). Notes live on the session
  (`src/db/schema/workout-sessions.ts:56`) and on each set (`src/db/schema/workout-sets.ts:109`).
  The MCP consent page already names them (`src/app/oauth/consent/page.tsx:51`), and the data
  inventory says B1 adds them (`docs/privacy/data-inventory.md:54`).
- Logging today: `createWorkoutSession` (`src/lib/actions/workout-sessions.ts:50`), then
  `logWorkoutSet` per set (`src/lib/actions/workout-sets.ts:281`), then `completeWorkoutSession`
  (`src/lib/actions/workout-sessions.ts:145`), which deletes an `auto` row for the same program
  and day (`:179-191`) and learns weight stacks (`:195`).
- Records: a set logged before later history rebuilds the records from that set on
  (`rebuildPRsFrom`, call at `src/lib/actions/workout-sets.ts:464`). These helpers are private
  functions in a `"use server"` file, so an MCP tool cannot call them. The same is true of
  `insertAutoSessions` (`src/lib/actions/training-cycles.ts:358`), which writes the `auto` row
  for a day tracked outside the app.
- `workout_sessions.source` is a text column with the values `app` and `auto`
  (`src/db/schema/workout-sessions.ts:68`, added in `drizzle/0054_auto_complete_days.sql:2`); a
  new value needs no SQL. One `auto` row per program and day (`uniq_ws_auto_day`,
  `src/db/schema/workout-sessions.ts:73`). The ghost-session cleanup only removes `app` sessions
  (`isGhost`, `src/lib/ghost-sessions.ts:26-35`), so `auto` and a new `assistant` value are safe
  from it.

### 1.4 Field owners today

- The weekly sync rewrites distance and duration on every set with a peak anchor, and zone and
  rest on those that also have `sessionRole` `work` (`src/lib/periodization-sync.ts:237-243`).
  Sets without a peak anchor are never touched (`hasPeakAnchor`, `:33-36`).
- `sessionRole` is read only by the sync and the triathlon generator; no other code depends on
  it. So clearing it takes a set's zone and rest out of the sync's control.
- `adaptation_pct` (`src/db/schema/training-cycles.ts:60`) is written by the sync from adherence
  and readiness (`computeAdaptationFactor`, `src/lib/utils/periodization.ts:273`) and by the
  Garmin suggestion, which re-runs the sync with a fixed percent
  (`applyWearableSuggestion`, `src/lib/periodization-sync.ts:331`). The next weekly sync computes
  it again, so any value lasts one week. No tool writes it (`docs/mcp/app-rules.md:41`).
- The tool text already says who owns zone, rest and the peak
  (`src/lib/mcp/tools/programs.ts:251`), and the server instructions repeat it
  (`src/lib/mcp/instructions.ts:26`).

### 1.5 Data for the limits

- Garmin is on only for admins with the key set (`garminAllowedFor`,
  `src/lib/garmin/access.ts:20-24`). The connection row holds `lastSyncedAt`
  (`src/db/schema/garmin.ts:42`).
- Runs: `getVolumeData` reads activities with sport, local day, duration and distance
  (`src/lib/garmin/queries.ts:952-981`). Indoor runs count for time, not for the longest
  distance (`src/lib/garmin/analytics/demands.ts:22`, `isIndoor` in
  `src/lib/garmin/analytics/sport.ts:18`).
- The plan side: `plannedSets` reads a day-of-week cycle's endurance sets by discipline and says
  rotation cycles have no fixed week (`src/lib/garmin/queries.ts:938-950`). Endurance exercises
  carry `discipline` swim, bike or run (`src/db/schema/exercises.ts:103`).
- Week values of peak-anchored sets come from `scaledDuration` and `scaledDistance`
  (`src/lib/utils/periodization.ts:151`, `:177`) times the share from `periodizationShare`
  (`src/lib/periodization-sync.ts:64`).
- The research rules: the long-run cap is "Study (large cohort)"
  (`docs/research/endurance-training-reference.md:195`); "Key sessions per week: 2-3, protected"
  is "Coach convention" (`docs/research/endurance-training-reference.md:65`).

### 1.6 MCP plumbing

- A tool is a read tool only with `readOnlyHint: true` (`isReadTool`, `src/lib/mcp/scopes.ts:53`).
  The unit test pins each tool group by name and checks the history tools are all read-only
  (`src/__tests__/mcp-tools.test.ts:78-97`).
- The OAuth client id reaches the route as `claims.azp` (`src/app/api/[transport]/route.ts:87`).
  The handler is made per request (`src/app/api/[transport]/route.ts:99-111`).
- Integration tests exist for the set editor and the exercise check in
  `src/__tests__/integration/mcp-programs.test.ts` and for scopes in
  `src/__tests__/integration/mcp-scopes.test.ts`. No other write tool has a functional test.
- The instructions list "No training limits checked in code" and "No session notes over MCP" as
  missing (`src/lib/mcp/instructions.ts:28-32`), as does the rules doc
  (`docs/mcp/app-rules.md:44-59`).

## 2. Design

### 2.1 Data model

New table `coach_memory` (*new*):

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `user_id` | text, FK `user`, cascade | Owner |
| `kind` | text enum `preference`, `limit`, `observation`, `decision` | `limit` is a life limit (time, travel, equipment), not a training limit |
| `text` | text, not null, 1-1000 chars | The entry |
| `entry_date` | date, not null | The date the entry is about or was made; default today in the user's zone |
| `active` | boolean, not null, default true | Inactive entries are kept but not shown to the assistant by default |
| `version` | integer, not null, default 1 | For the A4 version check (T9) |
| `deleted_at` | timestamp, null | Soft delete (T6) |
| `created_at`, `updated_at` | timestamp | |

Index `(user_id, active)`. Cap: 200 live entries per user (a write past it is refused with a
message to deactivate or delete old ones), so the read tool stays small.

Other changes:
- `plan_revisions.limit_check` jsonb, null (*new* column on A4's table): what the limits found on
  an assistant write (2.4).
- `plan_revisions.object_type` gets the value `memory` (text enum, no SQL; A4 2.1 planned for it).
- `workout_sessions.source` gets the value `assistant` (text, no SQL).
- `exercises` (decision 6): replace the global unique name with a unique name among
  system exercises and a unique `(user_id, name)` among custom ones.

### 2.2 Field owners

Every row of audit section 8, decided, plus the fields this PR opens. The tool descriptions and
`docs/mcp/app-rules.md` carry this table in short form.

| Field | Owner | What an assistant write does |
|---|---|---|
| `target_reps`, `weight_kg` on strength sets | Progression engine (D-6) | Allowed as a one-off. The revision records it as an assistant write with its reason. The engine moves it again after the next session. To change the trend, change the slot's progression settings. A4 2.5 decides what a restore does with it. |
| `distance_meters`, `duration_seconds` on sets with a peak anchor | Weekly sync, from the peak | Kept as today: the value is this week's, and the peak is re-derived from it, so the change lasts (`reanchoredPeaks`). The description says it edits the peak. |
| `target_heart_rate_zone`, `rest_time_seconds` on `work` sets with a peak anchor | Weekly sync, by phase | **Refused** with: "The weekly sync sets zone and rest on this set from the block phase. To set them yourself, send `sessionRole: null` for this set; the sync then leaves its zone and rest alone, and still scales its distance or duration." Both in one write is fine. |
| Same two fields on other sets | User, assistant | Applied. |
| Cycle `adaptation_pct` | Weekly sync, Garmin suggestion; assistant through `set_volume` | New operation `set_volume` on `manage_training_cycle` (2.3): one percent for the current week of the active cycle, 50-110. It runs the sync for this week with that percent, the same path as the Garmin suggestion, so the limits see the scaled numbers. The next weekly sync computes the percent again (decision 3). |
| Cycle `race_date`, `race_distance`, `goal`, `athlete_level`, `start_date`, `end_*`, `name`, `duration_weeks` | User, assistant | Applied. Race, goal and level need the endurance switch, as in the app. A change to goal or level clears `last_synced_week`, like a duration change. |
| Coach memory, all fields | User, assistant | Applied, revisioned. |
| A logged session (`source` `assistant`) and its sets | Assistant at create; the user after (edit and delete in History, as today) | The assistant cannot edit or delete logged sessions in this PR. |
| Custom exercise | User, assistant at create | The assistant cannot edit or delete exercises. |

### 2.3 MCP tools

"Version" means A4's `expectedVersion` (required on writes to an existing program, cycle or
memory entry); "reason" means A4's required `reason`. "Limits" means the write runs the two
limits and takes `overrideLimits` and `overrideReason` (2.4).

| Tool | Hint | Change | Version, reason, limits |
|---|---|---|---|
| `manage_training_cycle` | write | `create` and `update` take `raceDate`, `raceDistance` (`full`, `half`), `goal` (`build`, `maintain`), `athleteLevel` (`novice`, `intermediate`, `advanced`); `start` takes `startDate` (today to today + 120 days); *new* op `set_volume` (`pct`) | Version and reason as A4. Limits on `start` and `set_volume` |
| `edit_program_exercise` | write | Refuses sync-owned fields (2.2); description gets the owner table | Limits on `add` and `update` |
| `edit_cycle_slot` | write | No new fields | Limits on `upsert` |
| `restore_revision` (A4) | write | Runs the limits as warnings only (T4); never blocks | Warnings in the result and in `limit_check` |
| `search_exercises` (*new*) | read | Part of a name, optional `category`, `discipline`, `muscleGroup`, `equipment`, `limit` (1-50, default 20). System exercises and the user's own. Returns id, name, category, discipline, timed, custom, muscle group, equipment | none |
| `create_exercise` (*new*) | write | The app's fields plus `discipline` and `isTimed` (decision 5). Same name check as the app | Not plan data: no revision; audit log line |
| `log_session` (*new*) | write | A completed session done outside the app (2.6) | Not plan data: no version, no limits; `reason` optional |
| `confirm_session` (*new*) | write | Marks a planned day of the active cycle as done (2.6) | Not plan data |
| `recent_workouts`, `exercise_history` | read | Add `notes` on each session and set, and the user's own note per exercise (`exercise_notes`) in `exercise_history` | none |
| `get_coach_memory` (*new*) | read | Active entries newest first; `includeInactive` flag. Each with id, kind, text, date, active, version, and who wrote it last (`you`, the assistant's client name) | none |
| `manage_coach_memory` (*new*) | write | `add` (kind, text, date), `update` (id, any of kind, text, date), `deactivate`, `activate`, `delete` (soft; the user can restore it) | Version on all but `add`; reason required. No limits |

Change sets: the new plan writes use A4's 30-minute window per OAuth client (`changeSetFor`).
Every write result returns `changeSetId` and the new `version`. No explicit change-set argument
(default; see section 10).

Tool text (exact wording at build time) for the description of `edit_program_exercise`, after
the field list: "Owners: target reps and weight belong to the progression engine; an edit is a
one-off until the next session. On a set with a peak anchor, distance or duration is this week's
value and the peak is re-derived from it. Zone and rest on a `work` set with a peak anchor belong
to the weekly sync and are refused; send `sessionRole: null` to take them over. To make a whole
week lighter or harder, use `manage_training_cycle` `set_volume`, not set edits."

### 2.4 Training limits

**Which writes are checked.** Assistant writes only (D3), through the tools marked "limits" in
2.3. User edits in the app are never checked (D4). The weekly sync is not checked in this PR
(T4 sync warnings move to D2 later). Restores by the assistant get warnings (T4).

**Who is checked.** Users with the endurance switch on (D18). The long-run cap also needs Garmin
data: `garminAllowedFor` is true and a `garmin_connections` row exists with `lastSyncedAt`. With
no Garmin data, the cap is not checked, and the result says so in plain words: "Long-run cap not
checked: no Garmin data for this account. Check the change against the long-run rule in
logeverylift://docs/endurance-training-reference yourself." Hard sessions per week need only the
plan (decision 1).

**Rule 1: `long_run_cap`.** Cites `docs/research/endurance-training-reference.md:195`,
evidence "Study (large cohort)".
- The planned run of a program: the sum of `durationSeconds`, and separately of `distanceMeters`,
  over its live sets whose exercise has `discipline` `run`. The week value of a set with a peak
  anchor in a cycle is the peak times that cycle's share for the week the write lands in
  (`scaledDuration`, `scaledDistance`), so `start` and `set_volume` see what will run.
- The history: Garmin runs in the 30 days up to today in the user's zone. Longest duration over
  all runs; longest distance over outdoor runs only, as `demands.ts` does.
- Broken when, for a program the write touches, the planned duration rises above
  1.10 x the longest duration, or the planned distance rises above 1.10 x the longest distance.
  "Rises": the value after the write is above the value before it. A plan already over the cap
  does not block an unrelated edit.
- No comparable run in the 30 days (none, or only indoor runs for a distance target) counts as
  broken, with the numbers "no run in the last 30 days". The research says the cap falls with
  the 30-day max.
- Message: "Run 1:45 h is 1.31x your longest run in the last 30 days (1:20 h on 2026-11-02).
  Limit 1.10x, so at most 1:28 h." Numbers: planned, longest, its date, ratio, limit, the cap.

**Rule 2: `hard_sessions_per_week`.** Cites `docs/research/endurance-training-reference.md:65`,
evidence "Coach convention (2-3 key sessions a week); which planned sessions count as hard is
Inference".
- A hard session: a program with at least one live set on an endurance exercise (`discipline`
  not null) that has `sessionRole` `work` or `targetHeartRateZone` 4 or 5. Strength sessions do
  not count (the research puts heavy lifting on hard days). Long easy sessions do not count; the
  long-run cap covers runs (decision 2).
- The week: the slots of a day-of-week cycle; a program on two days counts twice. Rotation cycles
  have no fixed week, so the rule is not checked for them, and the result says so.
- Which cycle: for a cycle or slot write, that cycle; for a program write, the active cycle if it
  holds the program.
- Limit 3. Broken when the count after the write is above 3 and above the count before.
- Message: "This week would hold 4 hard sessions (Tue, Thu, Sat, Sun). Limit 3."

**Code.**
- Pure rules in `src/lib/utils/training-limits.ts` (*new*): `longRunCap`, `hardSessionsPerWeek`,
  `isHardSession`, `remainingAfterOverride`, and the message text. Each rule's header comment
  cites the research line and its label. Unit tested.
- Server code in `src/lib/training-limits.ts` (*new*, plain module like `periodization-sync.ts`):
  `limitContext(userId)` reads the switch, Garmin state and the 30-day runs once per call;
  `planFacts(tx, ...)` reads the planned runs and the week's hard sessions inside the transaction.

**Override flow (D3).**
1. The tool runs the write inside `withPlanWrite`. Inside the same transaction it reads the plan
   facts before and after the write and runs the rules.
2. If a rule is broken and not named in `overrideLimits`, the transaction rolls back. Nothing is
   applied, no revision is written. The result is an error result with JSON: `applied: false`,
   and per broken rule its id, message, numbers, evidence label and research link, plus "To apply
   anyway, send the same call with overrideLimits: [...] and overrideReason (why it still fits,
   for example a longer run the athlete did outside the app)." Log line
   `[mcp:limits] refused` with the tool name and rule ids only.
3. The resend names the rules in `overrideLimits` and gives `overrideReason` (10-500 chars,
   required when `overrideLimits` is not empty). The write applies. An override for a rule that
   is not broken is ignored, and the result says so.
4. The revision stores `limit_check`:
   `{ "v": 1, "checked": [...], "notChecked": [{ "rule", "why" }], "passed": [...],
   "overridden": [{ "rule", "message", "numbers", "evidence" }], "overrideReason", "warnings": [...] }`.
5. Every checked write result also carries a short `limits` summary (checked, not checked and
   why, passed, overridden), so the assistant always knows whether a check ran.

**Shown to the user.** The program and cycle history rows and the AI changes feed from A4 show
an overridden limit under the reason: "Went past a training limit: run 1:45 h is 1.31x your
longest run in 30 days (limit 1.10x). Assistant's reason: ...". One shared formatter from the
pure module.

### 2.5 Coach memory (B4)

- **What goes in.** Free-text context the assistant needs next time: preferences ("prefers long
  rides on Saturday"), life limits ("travels every other week, hotel gym only"), observations
  ("left knee sore after runs over 90 min, 2026-10"), decisions ("kept strength at 2x in build
  to keep muscle"). Facts with their own home do not go here (T10). Until package C3 builds the
  homes for injuries, availability and the strength goal, those go in as `limit` or
  `observation` entries, and C3's interview moves them (decision 4).
- **Writes.** Server Actions in `src/lib/actions/coach-memory.ts` (*new*) for the app, and the
  MCP tool, both through one plain module `src/lib/coach-memory.ts` (*new*) that takes a
  resolved user id. Every write goes through `withPlanWrite` with object type `memory`, writer
  `user` or `assistant`. A soft-deleted entry can be restored from A4's AI changes feed or with
  `restore_revision`.
- **Not checked by the limits.** Memory is context, not a plan change.
- **Not sent to the in-app AI** (AI Setup and the check-in): only the user's connected assistant
  reads it.
- **Instructions:** the review steps say to read `get_coach_memory` first, and to save a
  `decision` entry with the date after each agreed change.

### 2.6 Logged sessions over MCP

`log_session`:
- Input: `date` (not in the future, at most 60 days back), optional `programId` (own, live),
  optional `startTime` and `durationMinutes`, `feeling`, `notes`, and `sets[]` (1-100): each with
  `exerciseId` (system or own), `setNumber`, and any of `reps`, `weightKg`, `durationSeconds`,
  `distanceMeters`, `heartRateZone`, `rir`, `rpe`, `notes`, `setType`. Strict schema; the
  ranges of `logWorkoutSetSchema`.
- Refused when the user already has a completed `app` or `assistant` session for the same program
  on that date, with a hint to read `recent_workouts`.
- Writes, in one transaction: a completed session with `source` `assistant`, its sets (no
  `program_set_id`: the assistant logs what was done, not against a planned set), the deletion of
  an `auto` row for the same program and day (as `completeWorkoutSession` does), and a records
  rebuild from the session start for each exercise (`rebuildPRsFrom`). Each set's `created_at`
  is the session's time, since the rebuild orders and dates sets by it. No weight-stack
  learning: it learns from sets linked to a program slot, and these sets link to none, so the
  tool writes no plan data.
- To call the records helpers, `rebuildPRsFrom` and the helpers it uses move unchanged from
  `src/lib/actions/workout-sets.ts` into `src/lib/workout-records.ts` (*new*, plain module).
  Pure move; `logWorkoutSet` imports them from there. This touches the set logging flow, so the
  full e2e suite and the smoke pass run (section 6).
- History shows "Logged by your assistant" on these sessions. Durations and stats treat
  `assistant` like `app`.

`confirm_session`:
- Input: `date` (in the active cycle, not in the future) and `programId` (the program of a slot
  of the active cycle).
- Writes the `auto` row for that program and day with `insertAutoSessions`, moved unchanged to
  `src/lib/auto-sessions.ts` (*new*, plain module). If the day is already logged, nothing is
  written and the result says so. A second confirm is a no-op (`uniq_ws_auto_day`). The result says the day now
  counts as done for adherence and the weekly sync.

### 2.7 UI

- **Coach memory** at `/more/coach-memory` (*new*), linked from More (next to Connected
  assistants in `src/components/features/MoreClient.tsx`) and from the Connected assistants
  screen. Entries grouped by kind, newest first, each with its date and "Added by you" or the
  assistant's name. Add (bottom bar), edit text and kind in a sheet, a switch for active,
  delete at the bottom of the sheet with a confirm. Inactive entries fold under "Not in use".
  Everyone sees it; it is not behind the endurance switch (the assistant is for everyone).
- **Scheduled cycle** (decision 7): a cycle with a future start shows "Starts 4 Jan" on the
  cycles list and its page. The existing Start button still starts it today.
- **Limit overrides** in A4's history rows and AI changes feed (2.4).
- **Assistant-logged sessions:** a short label in History and on the session page.
- 44 px targets, `:active` feedback, destructive action at the bottom (CLAUDE.md UI rules).

### 2.8 Instructions and the rules resource

`src/lib/mcp/instructions.ts` and `docs/mcp/app-rules.md`, same PR:
- The model: logged sessions can now be logged and confirmed by the assistant; coach memory;
  exercises can be searched and created.
- The owner table from 2.2 in short form, with `set_volume`.
- Limits: what the two rules are, who is checked, the override flow, and that the other limits
  (weekly load ramp, low-readiness day, heavy legs within 48 h) are not in code yet, so the
  assistant checks them against the research itself.
- "Not in the app yet": remove "No session notes over MCP"; change the limits line as above.
- Review steps: read `get_coach_memory` first; save a `decision` entry after each agreed change.
- The unit test that the instructions name every tool group gets the new tools.

## 3. Migration and rollback

One migration (`drizzle/0083_*.sql` if A4 lands as `0082` and nothing else first), generated with
`pnpm db:generate` (create, not rename), SQL and `drizzle/meta/` committed together:
- `CREATE TABLE coach_memory` with its index and FK.
- `ALTER TABLE plan_revisions ADD COLUMN limit_check jsonb`.
- Decision 6: `ALTER TABLE exercises DROP CONSTRAINT exercises_name_unique`, then
  `CREATE UNIQUE INDEX uniq_exercise_system_name ON exercises (name) WHERE user_id IS NULL` and
  `CREATE UNIQUE INDEX uniq_exercise_custom_name ON exercises (user_id, name) WHERE user_id IS NOT NULL`.
  Existing rows satisfy both, since they satisfy the global one.
- No `CREATE TYPE` (text enums). No data step.

**Rollback.** Data lost: coach memory entries and their revisions, and the stored limit checks.
Logged sessions with `source` `assistant` stay; the old code reads them as normal sessions.
1. Deploy the previous image. It ignores the new table and column.
2. If custom exercises with the same name for two users exist, rename all but one (list them with
   `SELECT name FROM exercises GROUP BY name HAVING count(*) > 1`) before restoring the old
   constraint.
3. Then, optionally:
   ```sql
   DROP TABLE coach_memory;
   DELETE FROM plan_revisions WHERE object_type = 'memory';
   ALTER TABLE plan_revisions DROP COLUMN limit_check;
   DROP INDEX IF EXISTS uniq_exercise_system_name;
   DROP INDEX IF EXISTS uniq_exercise_custom_name;
   ALTER TABLE exercises ADD CONSTRAINT exercises_name_unique UNIQUE (name);
   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<hash of 0083>';
   ```
   The last line lets the migration run again on a later deploy.

## 4. What this PR takes from A4

Built on A4's API as its brief defines it. If the merged code differs, this PR follows the code
and fixes this brief in the same PR.

| A4 part (`revisions.md`) | Used for | What this PR adds to it |
|---|---|---|
| `withPlanWrite` (2.2) | Every plan write here and every memory write | An optional `limitCheck` in the context, stored in the new `limit_check` column; a way for the callback to roll back with a result (a typed error that `withPlanWrite` catches and returns), so a refused write leaves nothing |
| Object types (2.1, T5) | Coach memory | Type `memory`: snapshot `{ "v": 1, "memory": {row} }`, restore (one row, same id), and `diffSnapshots` text ("Memory: 'prefers…' made inactive") |
| `expectedVersion`, `reason` on MCP writes (2.7, 2.10) | New fields and ops on existing tools, and `manage_coach_memory` | Same rules on the new inputs |
| `changeSetFor` (2.8) | Every assistant write | Nothing; no explicit argument |
| Sync writes through the layer (2.5, 1.2) | `set_volume` re-runs the sync with a percent | The sync call takes the writer: `assistant` with the reason, instead of `sync` |
| `restore_revision`, `list_revisions` (2.10) | Restores of memory entries; T4 warnings | The limits as warnings on assistant restores; memory in both tools |
| History rows, AI changes feed (2.9) | Showing overrides and memory changes | The override line (2.4) |
| Live-row helpers (2.4) | The limits and `search_exercises` read live sets and programs only | Nothing |

Integration tests for the tools A4 changes (create, update, delete, set diff, start, slots) ship
with A4. This PR adds tests for every write tool A4's table does not list (`update_profile`,
`manage_weight`) and for every new tool and new input, so that after both PRs every MCP write tool
has a functional test.

## 5. Privacy steps (`privacy-compliance` skill)

1. **Inventory first** (`docs/privacy/data-inventory.md`):
   - New row "Coach memory": `coach_memory`, free-text context the user or their connected
     assistant (on the user's instruction) writes so the assistant knows the user's preferences,
     life limits, observations and decisions between conversations. Art. 6(1)(b) + 9(2)(a), since
     entries can describe health ("knee sore"). Retention: until the user deletes it or the
     account; deleted entries and old versions follow A4's revision retention.
   - Health line (`docs/privacy/data-inventory.md:32`): add coach memory entries next to
     free-text notes.
   - Training log row: logged sessions can also come from the user's assistant (`source`
     `assistant`).
   - MCP recipient row (`docs/privacy/data-inventory.md:54`): reads now include session and set
     notes, per-exercise notes and coach memory; read and change adds logging and confirming
     sessions, creating exercises, writing coach memory, and the volume percent. Remove "which the
     tools do not return yet".
2. **Policy** (`src/app/privacy/page.tsx`): coach memory in plain words; assistants can now read
   notes and coach memory and log sessions.
3. **MCP consent page** (`src/app/oauth/consent/page.tsx`): add coach memory to what an assistant
   can read and change.
4. **Export:** `coach_memory` in `collectUserData` (`src/lib/account-data.ts:62`); the coverage
   test fails until then. `plan_revisions` is already exported by A4.
5. **Delete:** cascade on `user_id`.
6. **`LEGAL_VERSION`** bump to the merge date. `CONSENT_VERSION` stays (decision 8).
7. **Logs:** ids and tags only (`[coachMemory]`, `[mcp:limits] refused`, `[mcp:log_session]`).
   Never memory text, notes or limit numbers in logs.
8. **Friends:** coach memory is never shown to other users. Assistant-logged sessions follow
   `showActivityToFriends` like any session; notes stay hidden from friends as today.
9. **Retention:** memory is capped at 200 live entries per user; no purge beyond A4's.

## 6. Tests per layer

Bug fixes first: each "today fails" test is written first, run against the current code, and
seen failing.

| Layer | What | File |
|---|---|---|
| Unit | `longRunCap`: under, at and over 1.10x; rise vs no rise; duration and distance; indoor runs ignored for distance; no run in 30 days; the message numbers (1:45 h, 1.31x, at most 1:28 h) | `src/__tests__/training-limits.test.ts` (*new*) |
| Unit | `isHardSession` (work role, zone 4-5, strength only, zone 3 without role); `hardSessionsPerWeek` count, a program on two days, rotation not checked, rise rule | same |
| Unit | `remainingAfterOverride`: all overridden, one left, an override for an unbroken rule ignored; the override formatter | same |
| Unit | Tool registration: `search_exercises` and `get_coach_memory` are read tools; every new write tool has no `readOnlyHint` | `src/__tests__/mcp-tools.test.ts` |
| Unit | Instructions name the new tools and the limit rules | `src/__tests__/mcp-resources.test.ts` |
| Integration | Today fails: `create_exercise` (and `createCustomExercise`) for a name another user already has as a custom exercise (decision 6) | `src/__tests__/integration/mcp-exercises.test.ts` (*new*) |
| Integration | `search_exercises`: system and own, never another user's custom; filters | same |
| Integration | `manage_training_cycle`: race, goal and level set and returned; refused without the endurance switch; goal or level change clears `last_synced_week`; `start` with a future date schedules and does not complete the active block; the scheduled block starts on its day through `getActiveCycleForUser` and completes the old one; `set_volume` writes this week's targets and `adaptation_pct`, writer `assistant`, and next week's sync computes its own | `src/__tests__/integration/mcp-cycles.test.ts` (*new*) |
| Integration | `edit_program_exercise`: zone or rest on a `work` set with a peak anchor refused and nothing changed; the same with `sessionRole: null` applies and the next sync keeps it | `src/__tests__/integration/mcp-programs.test.ts` |
| Integration | Limits: a long run over the cap refused, nothing changed, no revision; resent with override applies and the revision holds `limit_check`; a 4th hard session refused; a user Server Action edit with the same change is not checked (D4); no Garmin data: applied with "not checked" in the result; endurance switch off: not checked; rotation cycle: hard sessions not checked; assistant restore gives warnings and applies | `src/__tests__/integration/mcp-limits.test.ts` (*new*) |
| Integration | `log_session`: session and sets written with `source` `assistant`; records rebuilt (a backdated heavier set becomes the record and a later one is superseded correctly); the `auto` row for the day removed; duplicate refused; another user's exercise or program refused and nothing written | `src/__tests__/integration/mcp-sessions.test.ts` (*new*) |
| Integration | `confirm_session`: writes one `auto` row; a second call is a no-op; a program not in the active cycle refused | same |
| Integration | `recent_workouts` and `exercise_history` return session, set and exercise notes | `src/__tests__/integration/mcp-workouts.test.ts` |
| Integration | Coach memory, actions and tool: add, update, deactivate, delete, restore; a revision per write with the right writer; stale `expectedVersion` refused; the 200 cap; `get_coach_memory` hides inactive by default | `src/__tests__/integration/coach-memory.test.ts` (*new*) |
| Integration | `update_profile` and `manage_weight`: applied, ranges refused, nothing written for bad input | `src/__tests__/integration/mcp-profile.test.ts` (*new*) |
| Integration | Every new tool and action called as another user (or on another user's id) is refused and changes nothing | each file above |
| Integration | Every new write tool refuses on a read-only connection | `src/__tests__/integration/mcp-scopes.test.ts` |
| Integration | Export has `coach_memory`; account deletion removes it | `src/__tests__/integration/account-data.test.ts` |
| Integration | Existing set logging and records tests stay green after the move to `workout-records.ts` | `src/__tests__/integration/workout-sets.test.ts` |
| Integration | Migration: existing exercises keep their names; two users can hold the same custom name; a custom cannot take a system name in one user's list | `src/__tests__/integration/migrations.test.ts` |
| e2e | Coach memory: add an entry, edit it, make it inactive, delete it; `testDb()` shows the rows and revisions | `e2e/coach-memory.spec.ts` (*new*) |
| e2e | Extend `e2e/mcp-oauth.spec.ts`: `tools/list` shows the new tools; a read-only token refuses `manage_coach_memory` | `e2e/mcp-oauth.spec.ts` |

Then `pnpm verify`, the full e2e suite (the records helpers move out of the set logging file),
and the smoke pass in `CLAUDE.md`.

## 7. Order of work

1. Wait for A4 to merge; rebase on it. Read its merged `withPlanWrite` and adjust section 4.
2. Migration and schema; the move of `rebuildPRsFrom` and `insertAutoSessions` to plain modules
   (existing tests green before and after).
3. Pure limits module with unit tests; server limits module; `withPlanWrite` hook and column.
4. MCP: cycle fields and `set_volume`, owner refusals, limits on the checked tools, then exercises,
   sessions, notes. Integration tests per tool, "today fails" first.
5. Coach memory: module, actions, tools, screen; tests.
6. Instructions, rules doc, UI labels (override line, scheduled start, assistant-logged).
7. Privacy steps, e2e specs, `pnpm verify`, full e2e, smoke pass.

## 8. Plan corrections (in this PR)

- B1 and B4 status `brief`; D2 split recorded in the plan (owner decision, 2026-11-12): the
  long-run cap and hard sessions per week ship here; D2 later adds the weekly load ramp, no hard
  session after a low-readiness day, heavy legs within 48 h, warnings on sync output (T4), and
  the limits for users without Garmin data.
- B1's "list and restore revisions" and the version check on existing tools are in A4 (A4's brief
  section 11 corrects the B1 text).

## 9. Risks

- **Set logging.** The records helpers move files. Pure move, existing tests, full e2e and smoke.
- **Home screen.** The scheduled start adds a write to `getActiveCycleForUser`. One indexed read
  when no scheduled cycle is due; an integration test for both cases.
- **Limits that block too often.** The rise rule and the override keep a false alarm cheap: one
  resend with a reason.
- **A4 API drift.** Section 4 lists every point of contact; step 1 of the order of work re-reads
  the merged code.
- **Migration clash** with A4 or other branches: rebase and regenerate before merge.

## 10. Defaults chosen

- Limits check assistant writes only; restores by the assistant get warnings; the weekly sync is
  not checked yet.
- A limit blocks only when the write makes things worse (rise rule).
- No run in the last 30 days counts as over the cap.
- Indoor runs count for duration, not distance (as `demands.ts`).
- Hard sessions limit 3, counted on day-of-week cycles only.
- Sync-owned zone and rest are refused with a way out (`sessionRole: null`), not silently
  overwritten.
- `set_volume` range 50-110 percent, for the current week only.
- A future start is at most 120 days ahead.
- No explicit change-set argument; A4's 30-minute window per client.
- `log_session` at most 60 days back; logs against no planned set; duplicate per program and day
  refused.
- `confirm_session` writes the same `auto` row as a day tracked outside the app.
- Coach memory: four kinds, 1000 chars, 200 live entries, for every user, never sent to the
  in-app AI.
- Notes returned in both history tools.

## 11. Files

New: `src/lib/utils/training-limits.ts`, `src/lib/training-limits.ts`, `src/lib/coach-memory.ts`,
`src/lib/actions/coach-memory.ts`, `src/lib/workout-records.ts`, `src/lib/mcp/tools/exercises.ts`,
`src/lib/mcp/tools/coach-memory.ts`, `src/db/schema/coach-memory.ts`, `src/app/more/coach-memory/`,
the tests in section 6, `drizzle/0083_*.sql`.
Changed: `src/lib/mcp/tools/{cycles,programs,workouts}.ts`, `src/app/api/[transport]/route.ts`,
`src/lib/mcp/instructions.ts`, `docs/mcp/app-rules.md`, `src/lib/actions/workout-sets.ts`,
`src/lib/actions/training-cycles.ts`, `src/lib/actions/exercises.ts`, `src/lib/plan-revisions.ts`
(A4), `src/lib/account-data.ts`, `docs/privacy/data-inventory.md`, `src/app/privacy/page.tsx`,
`src/app/oauth/consent/page.tsx`, `src/lib/constants/legal.ts`, `src/components/features/MoreClient.tsx`.

## 12. Owner decisions (2026-11-12)

The owner took every recommendation. The defaults in section 10 are accepted too.

1. **Hard-sessions limit:** for every user with the endurance switch on, from the plan alone.
   The long-run cap runs only with Garmin data.
2. **A hard session** is an interval session: a `work` role or heart rate zone 4-5 on an
   endurance set. At most 3 a week. Long easy sessions do not count.
3. **An assistant volume change lasts one week.** The next weekly sync computes its own percent.
   For a lasting change the assistant edits the peaks.
4. **Injuries and availability** go in coach memory as `limit` or `observation` entries until C3.
   C3's interview moves them to their tables and makes the entries inactive.
5. **Discipline and timed** on `create_exercise` and on the app's custom-exercise form. The form
   shows discipline only with the endurance switch on.
6. **Custom exercise names** are fixed in this PR: unique among system exercises and per user,
   with a test that fails first.
7. **Future start:** the cycle stays a draft with the date set; it starts on that day and
   completes the old block then; the cycle list shows "Starts <date>".
8. **`LEGAL_VERSION` only.** `CONSENT_VERSION` stays: coach memory is free text, the same
   category as the free-text notes the health-data consent already names.
