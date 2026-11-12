# Seasons, races and phases

Package C1 of [`triathlon-coach-plan.md`](triathlon-coach-plan.md). One branch and one PR
(`feat/seasons-c1`), on top of A1-A4 and B1-B4 (all on `main`). Inputs: the audit
(`docs/triathlon-coach-audit.md`, section 1 and decisions D8, D15, D17, D18, D22, T5, T6, T8,
T9), the research (`docs/research/endurance-training-reference.md`, the periodization and taper
sections and the half-distance appendix), `CLAUDE.md`, `TESTING.md`, and the merged briefs
[`foundations.md`](foundations.md), [`revisions.md`](revisions.md) and [`ai-coach.md`](ai-coach.md).

Status: building, 2026-11-12. The owner took every recommendation in section 12 and accepted the defaults in section 7. The **Findings**
describe `main` at 2bdac35 (after PR #224); every `file:line` in them was opened then. Names
marked *new* do not exist yet.

Package C3 (athlete profile, thresholds, intake interview) is built in parallel. This brief
does not touch thresholds, availability, injuries or the strength goal. Section 10 lists the
points where C3 meets C1.

## 0. Goal

1. Every user can make a **season**: a long goal above cycles, with a name, a goal, a start and
   an end, and a next goal (D22).
2. A season holds **races** (date, kind, distance, priority A/B/C). Races are endurance fields
   and show only with the endurance switch (D18).
3. A season holds its **phases**: training cycles in order, each with an optional phase type
   (general prep, base, build, peak, taper, transition) and an optional length in days (T8).
4. A cycle in a season stores no race; it shows the season's races. A cycle with no season keeps
   its own race fields and works exactly as today (D8).
5. The **taper** is placed from the A race date. Its default length comes from the race
   distance (research), not from the block length.
6. A change to a race date **flags the season** for the AI to re-plan (D17). Nothing reshapes
   by itself. The flag shows in the app and in the MCP season read tool.
7. Existing triathlon cycles move into a season, each with its race as the A race.
8. Seasons and races are revisioned plan objects (T5), soft deleted (T6), versioned (T9), and
   written only through `planWrite`.
9. The AI can do all of it over MCP (audit principle 3).

For a lifter with no season, nothing changes. A lifter sees a "Seasons" section on the cycles
screen and can make a season such as "Bench 120 kg by summer".

## 1. Findings in the code

### 1.1 The cycle today

- The race lives on the cycle: `race_date` and `race_distance` (`full`, `half`)
  (`src/db/schema/training-cycles.ts:65-67`). Goal and athlete level are cycle columns too
  (`src/db/schema/training-cycles.ts:44-46`, `:51-53`).
- A cycle has soft delete, a scheduled start and a version (`src/db/schema/training-cycles.ts:81`,
  `:86`, `:87`). Slots have unique keys per day and per position
  (`src/db/schema/training-cycles.ts:117-118`).
- The length is in weeks only, from a fixed list: 4, 6, 8, 10, 12, 16, 24, 36, 52
  (`src/lib/validators/training-cycles.ts:8`). A 10-day taper or a 3-week block cannot be made.
- `cycleWeek` computes the week, the end date (`start + weeks * 7`) and whether the block is over
  (`src/lib/utils/cycle-position.ts:57-70`). Seven other places compute the end from
  `durationWeeks * 7` by hand: the cycles list progress bar
  (`src/components/features/CyclesListClient.tsx:24`), the edit form's guard
  (`src/components/features/EditCycleForm.tsx:50`), the Garmin race overview
  (`src/lib/garmin/analytics/overview.ts:93`) and three in metrics (`src/lib/actions/metrics.ts:202`,
  `:1508`, `:1530`).
- The race field on the cycle form shows with the switch or when the cycle has a race
  (`src/components/features/EditCycleForm.tsx:125`). The server refuses to add a race with the
  switch off (`src/lib/actions/training-cycles.ts:698`). MCP gates the same fields
  (`src/lib/mcp/tools/cycles.ts:162-170`, message at `src/lib/mcp/tools/cycles.ts:55`).
- The triathlon generator writes a cycle with goal and level but no race
  (`src/lib/actions/triathlon-plan.ts:108-115`).

### 1.2 Phases today

- Phases are computed from the week number inside one cycle, never stored. `TrainingPhase` is
  base, build, peak, taper or maintain (`src/lib/utils/periodization.ts:24`).
- `phaseLayout` makes the taper the last ~10% of weeks, 1-3 weeks
  (`src/lib/utils/periodization.ts:81-92`), and `periodizedLoad` turns a week into a multiplier
  of the peak (`src/lib/utils/periodization.ts:95`). The taper is not tied to `race_date`.
- `intervalPhaseRecipe` picks the zone and rest of `work` sets by phase
  (`src/lib/utils/periodization.ts:200`).
- The curve is read in seven places: the weekly sync (`src/lib/periodization-sync.ts:96`,
  `:221`), the training limits (`src/lib/training-limits.ts:347`), the Garmin projection
  (`src/lib/garmin/analytics/projection.ts:42`), the Garmin race status
  (`src/lib/garmin/analytics/overview.ts:97`), the Garmin race layout
  (`src/lib/garmin/analytics/race.ts:14`), the cycle periodization summary
  (`src/lib/actions/training-cycles.ts:562-563`) and the generator
  (`src/lib/utils/triathlon-plan.ts:168`).

### 1.3 How cycles follow each other

- One cycle is active at a time. `activateCycle` completes every other active cycle and drops
  every other scheduled start in the same write (`src/lib/plan-revisions.ts:529`,
  `src/lib/plan-revisions.ts:574-581`).
- `scheduleCycle` lets one draft wait for a start day; only one cycle is scheduled at a time
  (`src/lib/plan-revisions.ts:597`). `startDueScheduledCycle` starts it on its day
  (`src/lib/plan-revisions.ts:638`), called from `getActiveCycleForUser`
  (`src/lib/actions/training-cycles.ts:152`) and `syncDueCycle`
  (`src/lib/periodization-sync.ts:46`).
- When a block is over, `getActiveCycleForUser` completes it with writer `sync`
  (`src/lib/actions/training-cycles.ts:187`). `endAction` only changes a banner link (audit
  section 1, "Chained blocks").

### 1.4 The revision layer

- `planWrite` runs a write in one transaction and stores a revision per touched object
  (`src/lib/plan-revisions.ts:385`). `tableOf` maps object types to tables
  (`src/lib/plan-revisions.ts:117`); object types are a text enum
  (`src/db/schema/plan-revisions.ts:21`), so a new type needs no SQL.
- A cycle snapshot is the row plus its slots (`src/lib/plan-revisions.ts:161`). A cycle restore
  writes back every snapshot field except `CYCLE_KEPT` (`src/lib/utils/plan-revisions.ts:291`,
  applied at `src/lib/plan-revisions.ts:943-944`). A snapshot taken before this package has no
  season key, so a restore leaves the season as it is; but it would bring back the old
  `raceDate`, which breaks D8 for a cycle that is now in a season. Section 2.8 fixes this.
- The guard tests scan for plan writes outside the layer and plan reads without the live filter
  (`src/__tests__/plan-write-guard.test.ts:58`, `src/__tests__/plan-write-guard.test.ts:73-78`).
  They do not know the new tables yet.

### 1.5 Race readers

- The Garmin race views read the race from the active cycle (`getActiveCycle`,
  `src/lib/garmin/queries.ts:545-562`; distance at `src/lib/garmin/queries.ts:993`) and fall
  back to the cycle's last day when no race is set (`src/lib/garmin/analytics/overview.ts:94`).
  These are the only readers of the race fields besides the form, the MCP tool and the revision
  diff text.

### 1.6 MCP

- `manage_training_cycle` takes the race fields (`src/lib/mcp/tools/cycles.ts:123-160`). Write
  tools take `reasonArg` and `expectedVersionArg` (`src/lib/mcp/revisions.ts:36-48`); the
  assistant context comes from `assistantContext` (`src/lib/mcp/revisions.ts:53`).
- The instructions and the rules doc both say "No seasons above cycles"
  (`src/lib/mcp/instructions.ts:35`, `docs/mcp/app-rules.md:96`).

### 1.7 Privacy

- The Plans row of the inventory names the cycle's race date and distance
  (`docs/privacy/data-inventory.md:21`); the MCP recipient row lists what assistants read
  (`docs/privacy/data-inventory.md:55`).
- The export already lists `plan_revisions` and `coach_memory` (`src/lib/account-data.ts:138-139`).
- `LEGAL_VERSION` is `2026-11-12.4` and `CONSENT_VERSION` is `2026-10-25`
  (`src/lib/constants/legal.ts:7`, `src/lib/constants/legal.ts:16`).

## 2. Design

### 2.1 Data model

New table `seasons` (*new*):

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `user_id` | text, FK `user`, cascade | Owner |
| `name` | text, 1-100 | "Half Ironman 2027", "Bench 120 kg by summer" |
| `goal` | text, null, max 500 | The long goal in the user's words |
| `start_date` | date, not null | First day |
| `end_date` | date, not null, >= start | Last day |
| `next_goal` | text, null, max 500 | What comes after ("Full distance in 2028") |
| `replan_flagged_at` | timestamp, null | Set when a race change needs a re-plan (2.6). Null = no flag |
| `replan_reason` | text, null | Plain text for the user and the AI: "A race Ironman 70.3 moved from 2027-08-22 to 2027-08-29" |
| `version` | integer, default 1 | T9 |
| `deleted_at` | timestamp, null | T6 |
| `created_at`, `updated_at` | timestamp | |

Index `(user_id, start_date)`.

New table `season_races` (*new*):

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `season_id` | integer, FK `seasons`, cascade | |
| `user_id` | text, FK `user`, cascade | Owner, so ownership checks and the export need no join |
| `name` | text, 1-100 | "Ironman 70.3 Haugesund" |
| `race_date` | date, not null | |
| `discipline` | text enum `triathlon`, `run`, `ride`, `swim`, `other` | |
| `distance` | text enum `full`, `half`, `olympic`, `sprint`, null | Triathlon only |
| `distance_meters` | integer, null | Run, ride, swim or other: the race length |
| `priority` | text enum `A`, `B`, `C` | |
| `created_at` | timestamp | |

Index `(season_id, race_date)`. Races are not soft deleted on their own, like slots: a season
snapshot holds its races, and a season restore writes them back with their old ids. Nothing
points at a race yet (E2's race-day plan will; it then needs soft delete or a stable-id rule).

New columns on `training_cycles`:

| Column | Type | Meaning |
|---|---|---|
| `season_id` | integer, null, FK `seasons`, set null | The season the cycle is a phase of |
| `phase_order` | integer, null | Position in the season, 1-based; null when no season |
| `phase_type` | text enum `general`, `base`, `build`, `peak`, `taper`, `transition`, null | Null = the cycle runs its whole curve, as today |
| `duration_days` | integer, null, 1-364 | T8. When set, the length; `duration_weeks` is then `ceil(days / 7)` |

Index `(season_id, phase_order)`. No unique key on the order (a reorder would need a deferred
key, the problem slots have); the layer keeps the order dense.

Text enums with Drizzle, no `CREATE TYPE`. Object type `season` joins the revision enum (no
SQL).

### 2.2 Field owners

| Field | Owner (writers) | On restore |
|---|---|---|
| Season `name`, `goal`, `start_date`, `end_date`, `next_goal` | user, assistant | Restored |
| Season races (all fields) | user, assistant | Restored with their ids |
| Season `replan_flagged_at`, `replan_reason` | set by a race write (2.6); cleared by user or assistant | Recomputed: a restore that changes a race date sets it like any race write |
| Season `version`, `deleted_at` | the revision layer | Kept, then the version bumps |
| Cycle `season_id`, `phase_order`, `phase_type`, `duration_days` | user, assistant | Restored with the cycle |
| Cycle `race_date`, `race_distance` | user, assistant, only when `season_id` is null | Forced to null when the restored cycle is in a season (2.8) |
| Cycle `scheduled_start_date` of the next phase | `sync` when it chains phases (2.5); user, assistant as today | Kept (already in the cycle's kept list) |

### 2.3 One module for season writes

A plain server module `src/lib/seasons.ts` (*new*), like `coach-memory.ts`: it takes a resolved
user id and a write context, and both the Server Actions (`src/lib/actions/seasons.ts`, *new*)
and the MCP tools (`src/lib/mcp/tools/seasons.ts`, *new*) call it. Every write goes through
`planWrite` with object type `season`:

- Snapshot: `{ "v": 1, "season": {row}, "races": [{row}], "phases": [{ "cycleId", "name",
  "phaseOrder", "phaseType" }] }`. The phase list is there for the history text ("Build phase
  added"). A season restore does not move cycles; a phase change is undone by restoring the
  cycle or the change set.
- A phase write (add, remove, move, length, type) touches the season **and** each cycle whose
  season, order or length changes. The lock order is the season first, then the cycles by id,
  so two phase writes never deadlock. All get revisions in one change set.
- The season version bumps on every user or assistant write to the season, its races or its
  phases. A phase write also bumps the cycle's version (it is a cycle write).
- Soft delete and the 90-day purge follow A4. The purge order deletes seasons after their
  cycles' `season_id` is set to null by the FK.

Pure rules live in `src/lib/utils/seasons.ts` (*new*), unit tested: the timeline, the taper,
the next race, the re-plan trigger, the phase curves and the diff text.

### 2.4 Phases and the timeline

- A phase is a training cycle with `season_id` set. Phases run in `phase_order`. A cycle is in
  at most one season.
- **Length.** A phase has `duration_weeks` as today, or `duration_days` (T8). One helper gives
  the length in days (`days ?? weeks * 7`), and `cycleWeek` takes it, so the end date and
  "is over" follow the days. The seven hand-written `durationWeeks * 7` sites (1.1) use the same
  helper. Week numbers stay `floor(elapsed / 7) + 1`, so a 10-day taper has a week 1 of 7 days
  and a week 2 of 3 days. With `duration_days` null, every number is the same as today; a unit
  test pins that.
- **Free lengths in a season.** A cycle in a season may have any length from 1 to 52 weeks or
  from 1 to 364 days. A cycle outside a season keeps the fixed week list, so the lifter form is
  unchanged.
- **Timeline.** A pure function computes each phase's dates forward: the first phase starts on
  its real start date if it has started, else on the season start; each next phase starts the
  day after the one before ends, or on its real start date once it has started. It returns, per
  phase, start, end, status (done, active, planned), and the gaps or overlaps with the season
  dates. This is the only place phase dates come from; nothing stores them.
- **Chained start (owner question 1).** When a phase becomes active, the layer schedules the
  next phase in the season to start on the day after this one ends, with the existing
  `scheduled_start_date` and writer `sync`. On that day `startDueScheduledCycle` starts it and
  completes the old one, as for any scheduled cycle. A season whose start is in the future gets
  its first phase scheduled for the season start. A change to the active phase's length, or a
  reorder, schedules the next phase again. If the user starts or schedules a cycle outside the
  season, the existing rule drops the season's scheduled start; the season then shows "Paused:
  the next phase is not scheduled" with a "Resume" button that schedules it again.
- **Phase types show only with the endurance switch** (D22). A lifter's phases have no type and
  run like any cycle. The server refuses a phase type when the switch is off, like the race
  fields.

### 2.5 Phase curves and the taper

**Phase curves (owner question 2).** A cycle's `phase_type` picks its curve. One function
replaces the direct `periodizedLoad` calls in the seven readers (1.2):

| Phase type | Curve (multiplier of the peak anchors) | Phase name for the zone recipe |
|---|---|---|
| null | Today's whole curve, unchanged (`periodizedLoad`) | As today |
| `general`, `base` | Ramp 0.80 to 1.00 over the phase, deload week by athlete level | `base` |
| `build` | Ramp 0.80 to 1.00, deload by level | `build` |
| `peak` | Flat 1.00 | `peak` |
| `taper` | 0.60 on the first day's week down to 0.35 on race week, as today's taper | `taper` |
| `transition` | Flat 0.50, no `work` sets rewritten | none: zone and rest left as they are |

The ramp starts at 0.80, not today's 0.60, because each phase ramps to its own peak anchors and
the next phase usually starts from the last one's level; a drop to 0.60 at every phase start
would make a false recovery week. Evidence: the 3-week block pattern and the taper cut are in
the research (Coach convention; the taper is Study). The 0.80 start and the 0.50 transition are
Inference. Each number is a named constant with that label.

`general` and `transition` are new values of the phase name the app shows ("General prep",
"Transition"). Garmin race status and the periodization summary show the phase type when the
cycle has one.

**Taper placement.** The taper is set from the A race, not from the block:
- Default taper length by the A race (research, taper sections and the half appendix): full
  14 days, half 10, olympic and sprint 7; a run of 30 km or more 14, else 7; ride, swim and
  other 7. The full and half numbers are inside the research ranges (14-21 and 7-14 days); the
  short-race and single-sport numbers are Inference.
- Adding a phase of type `taper` with no length gives it that length.
- The taper must end on the A race day. The timeline reports the fit: "Taper ends on race day",
  or "Taper ends 4 days before the A race". The season page and `get_season` show it.
- **Fit taper** (a button for the user, an operation for the AI) changes the length in days of
  the phase before the taper, so the taper ends on race day. It refuses when that phase has
  already ended. It is a normal user or assistant write, never automatic (D17).
- The A race used is the next A race on or after today in the season; with none, the last one.
- B races get no taper phase in C1; a B race is a session-level matter for C2 and later.

### 2.6 The re-plan flag (D17)

- A pure function compares the races before and after a write and returns a reason or nothing.
  It flags: a race date change of any priority, an A race added or removed, and a priority
  change to or from A. It does not flag a name or distance change.
- The flag is set inside the same `planWrite` as the race write, by any writer, including the
  assistant: the AI then sees it and clears it when it has re-planned.
- It never changes phases. The app shows it on the season card on `/cycles`, as a banner on the
  season page, and on the page of the active cycle when that cycle is in the season. The banner
  says what changed and "The plan was not changed. Ask your assistant to re-plan, or change the
  phases yourself." with "Mark as re-planned".
- Cleared by the user ("Mark as re-planned") or the assistant (`manage_season` operation
  `clear_replan`, reason required). Both are revisions.
- `list_seasons` and `get_season` return `replan: { flagged, since, reason }`. The MCP
  instructions tell the AI to check it at the start of every review.

### 2.7 Races on a season and race fields on a cycle (D8)

- Races are endurance fields: adding or changing one needs the switch (server and MCP). A season
  that already has races still shows them with the switch off, as the cycle form does today.
- Joining a season clears the cycle's own race fields in the same write. If the season has no
  race on that date yet, the race moves to the season first (as an A race), so no stored fact is
  lost. The result says so.
- A cycle in a season refuses race fields: the action and `manage_training_cycle` return
  "This cycle is a phase of <season>. Set races on the season."
- Leaving a season (remove phase) does not copy a race back: the cycle has no race.
- One reader gives a cycle's race: the season's A race (2.5 rule) when the cycle is in a live
  season, else the cycle's own fields. `getActiveCycle` in the Garmin queries uses it. Garmin's
  race views know only full and half; any other kind reads as "distance not set", as a cycle
  with no distance does today.
- A cycle whose season is soft deleted acts as a cycle with no season: every gate (race fields,
  length, joining another season, the cycle form) asks for a live season. Deleting a season puts
  its A race back on each phase as the cycle's own race and drops the chained start of the next
  phase. Restoring the season takes the race off its phases again; `season_id` was never
  cleared, so the link comes back (review, 2026-11-12).

### 2.8 Revisions, restore and versions

- Object type `season`, with snapshot, diff text, restore (season row and races with their
  ids, `SEASON_KEPT`: id, user, created, deleted, version), soft delete, Recently deleted, and
  the 90-day purge, as A4 did for coach memory.
- A cycle restore whose result has a season clears the race fields. The same check covers
  revisions from before this package (their snapshot has no season key, so the current season
  stays and the old race is dropped). The result says "Race kept on the season".
- A restore of a phase cycle reschedules the chain (2.4).
- `expectedVersion` is required on every MCP write to an existing season (A4 2.7). Phase
  operations also take the cycle's version (`cycleVersion`) when they change an existing cycle.
- Online edits in the app send no version, as A4 decided.

### 2.9 MCP tools

All write tools take `reason`; writes to an existing season take `expectedVersion`. Results
return the new season version and the change set.

| Tool | Hint | What it does |
|---|---|---|
| `list_seasons` (*new*) | read | Live seasons: id, name, goal, dates, next goal, status from the dates, the next A race, the re-plan flag, phase count, version |
| `get_season` (*new*) | read | One season: fields, races, phases from the timeline (cycle id, name, type, length, dates, status, cycle version), taper fit, gaps and overlaps, paused chain, the re-plan flag, version |
| `manage_season` (*new*) | write | `create`, `update`, `delete` (soft), `clear_replan`; phase operations `add_phase` (an existing cycle by id, or a new draft cycle with name, type and length), `remove_phase`, `move_phase` (to a position), `set_phase` (type, length in weeks or days), `fit_taper`, `resume` |
| `manage_race` (*new*) | write | `add`, `update`, `remove`, on a season. Needs the endurance switch. The result says whether the season is now flagged |
| `manage_training_cycle` | write | `create` takes `seasonId`, `phaseType`, `durationDays`; `update` takes `durationDays` and `phaseType`; race fields refused for a cycle in a season |
| `get_training_cycle`, `list_training_cycles` | read | Add `seasonId`, `phaseOrder`, `phaseType`, `durationDays`, and the race the cycle reads (2.7) |
| `list_revisions`, `restore_revision` | read, write | Accept object type `season` |

No training limits on the season tools: they change no load until a phase starts, and starting
a cycle is already checked (`ai-coach.md`, 2.4). The chained start is a `sync` write and is not
checked; D2 adds the T4 warnings for sync output later.

Instructions and `docs/mcp/app-rules.md`: remove "No seasons above cycles"; describe seasons,
races, phases, the chained start, the taper rule and the re-plan flag; the weekly review starts
with `list_seasons` and the re-plan flag. The unit test that the instructions name every tool
group gets the new tools.

### 2.10 UI

- **Cycles screen** (`/cycles`): a "Seasons" section above the cycles, with a card per season
  (name, dates, goal, current phase, the next A race with days to go when the switch is on, the
  re-plan badge) and "New season". Seasons in Recently deleted next to cycles and programs.
- **Season page** (`/seasons/[id]`, *new*): header with goal, dates and next goal; the re-plan
  banner; races (switch on, or the season has races) with add, edit and remove in a sheet; the
  phase timeline (name, type badge with the switch, dates, length, status), with "Add phase"
  (pick a cycle that is not in a season, or make a new draft), move up and down buttons (not
  drag: drag-reorder is a critical flow and this list does not need it), "Remove from season",
  the taper fit line with "Fit taper", the paused line with "Resume"; "History" link.
- **New and edit** (`/seasons/new`, `/seasons/[id]/edit`, *new*): name, goal, dates, next goal.
  Delete at the bottom of the edit page, with a confirm.
- **History** (`/seasons/[id]/history`, *new*): A4's history list with restore.
- **Cycle page and form**: a cycle in a season shows "Phase 2 of 5 in <season>" with a link and
  the season's races (read only). Its form hides the race field and says "Races are set on the
  season"; it shows phase type (switch on) and a weeks or days length choice.
- All client calls through `callAction()`. 44 px targets, `:active` feedback, destructive at
  the bottom (CLAUDE.md UI rules).

### 2.11 What does not change

- A cycle with no season: same columns, same curve, same end date, same form, same MCP fields.
- The triathlon generator writes a cycle with no season, as today. Whether it should build a
  season is C3's call (plan C3, last point).
- Strength stays out of the curves (`docs/specs/cycle-periodization.md`).

## 3. Migration and rollback

One migration (`drizzle/0085_seasons.sql`, after C3's `drizzle/0084_athlete_profile.sql`; regenerated on the
rebase after C3 merged), from `pnpm db:generate` (create, not rename), SQL and `drizzle/meta/` committed
together:

- `CREATE TABLE seasons`, `CREATE TABLE season_races` with FKs and indexes.
- `ALTER TABLE training_cycles ADD COLUMN season_id`, `phase_order`, `phase_type`,
  `duration_days`, the FK to `seasons` (`ON DELETE SET NULL`) and the index.

**Data step** (hand-written, at the end of the same file, owner question 4). For every live
cycle with `race_date` or `athlete_level` set (the generator's cycles and every cycle with a
race), in a `DO` block loop:
1. Insert a season: name = the cycle's name, start = the cycle's `start_date`, or its
   `created_at` day for a draft; end = `race_date`, or the cycle's last day; goal and next goal
   null.
2. If the cycle has a race date: insert a race, priority A, name "Race", discipline `triathlon`,
   distance = the cycle's `race_distance` (null stays null). If it has a distance but no date
   (review, 2026-11-12): insert the race as "Race (date not set)" on the season's last day, and
   flag the season with a reason that asks for the real date, so the distance is not lost.
3. Set the cycle's `season_id`, `phase_order = 1`, `phase_type = null` (it keeps its whole
   curve, so the sync gives the same numbers), and clear `race_date` and `race_distance`.
4. Bump the cycle's `version`, so an assistant that read the cycle before the deploy reads it
   again instead of writing over the move.

5. Write a `baseline` revision (writer `sync`, reason "Moved into a season") of each new season,
   and of each moved cycle that already has history, in the snapshot shape the app writes. A
   cycle with no history gets A4's lazy baseline on its next write. Without these, the history
   showed the move as part of the next writer's change (review, 2026-11-12).

An integration test runs the step on legacy-shaped rows: a generator cycle with a race, one
without, one with a distance and no date, a cycle with history, a lifter cycle (untouched) and a
deleted cycle (untouched).

**Rollback.** Data lost: seasons, races other than each migrated cycle's A race, phase order,
phase types, day lengths and the re-plan flags.
1. While the new code runs, put the race back on each cycle that has a season with an A race
   (the next A race on or after today, else the last, as the app reads it), and turn day lengths
   into weeks:
   ```sql
   UPDATE training_cycles c
      SET race_date = r.race_date,
          race_distance = CASE WHEN r.distance IN ('full', 'half') THEN r.distance END
     FROM season_races r
    WHERE r.season_id = c.season_id AND r.priority = 'A'
      AND r.id = (SELECT id FROM season_races x WHERE x.season_id = c.season_id AND x.priority = 'A'
                  ORDER BY (x.race_date < CURRENT_DATE), CASE WHEN x.race_date >= CURRENT_DATE
                  THEN x.race_date END ASC, x.race_date DESC LIMIT 1);
   UPDATE training_cycles SET duration_weeks = CEIL(duration_days / 7.0)
    WHERE duration_days IS NOT NULL;
   DELETE FROM plan_revisions WHERE object_type = 'season';
   ```
   The last line is required: the old image's history and AI changes feed read every revision
   and fail on a season snapshot (the same reason as the coach memory rollback in
   `ai-coach.md`, section 3).
2. Deploy the previous image. It ignores the new columns and tables. Weeks that are not on the
   old fixed list still work: only the form validates the list.
3. Then, optionally:
   ```sql
   ALTER TABLE training_cycles DROP COLUMN season_id, DROP COLUMN phase_order,
     DROP COLUMN phase_type, DROP COLUMN duration_days;
   DROP TABLE season_races;
   DROP TABLE seasons;
   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<hash of 0085>';
   ```

## 4. Privacy steps (`privacy-compliance` skill)

1. **Inventory first** (`docs/privacy/data-inventory.md`), Plans row: add `seasons` (a long
   goal in the user's words, dates, the next goal) and `season_races` (race name, date, kind,
   distance, priority). Move "an optional race date and distance" to say a cycle holds a race
   only when it is in no season. Same purpose and basis (Art. 6(1)(b)). A race name and date
   can show where the user will be on a day; that is personal data, not health data. A goal
   in free text can mention health ("lose 10 kg"), the same as program notes today.
   Revisions: object type `season` follows the Plans retention rule.
2. **MCP recipient row:** assistants read seasons, races, phases and the re-plan flag, and
   with read and change they write them.
3. **Policy** (`src/app/privacy/page.tsx`): one sentence on seasons and races in the plans
   section, and in the assistants section.
4. **MCP consent page:** seasons and races in the list of what an assistant reads and changes.
5. **Export:** `seasons` and `season_races` in `collectUserData`; the coverage test fails until
   then. Soft-deleted rows are exported too.
6. **Delete:** `user_id` cascades on both tables.
7. **`LEGAL_VERSION`** bump to the merge date. `CONSENT_VERSION` stays: no new kind of health
   data.
8. **Logs:** ids and tags only (`[seasons]`, `[mcp:seasons]`); never goal text or race names.
9. **Friends:** seasons and races are never shown to other users.
10. **Browser storage:** none.

## 5. Tests per layer

| Layer | What | File |
|---|---|---|
| Unit | Timeline: forward chain, real starts win, day lengths, gaps and overlaps with the season dates, status by today | `src/__tests__/seasons.test.ts` (*new*) |
| Unit | Taper: default length per race kind; the next A race on or after today, else the last; fit (on race day, N days early or late); fit refused when the phase before has ended | same |
| Unit | Re-plan trigger: date change of any priority flags; A added or removed flags; priority to or from A flags; name or distance does not | same |
| Unit | Phase curves: each type's multiplier per week; null type equals today's `periodizedLoad` for every length and level; transition leaves `work` sets alone | same |
| Unit | Length helper and `cycleWeek` with days: a 10-day phase ends on day 11; null days gives the same week, end and "is over" as today | `src/__tests__/cycle-position.test.ts` |
| Unit | Season snapshot diff text; cycle restore rule (race cleared in a season) | `src/__tests__/plan-revisions.test.ts` |
| Unit | Guards: `seasons` and `season_races` writes only inside the layer; reads of `seasons` filter deleted | `src/__tests__/plan-write-guard.test.ts` |
| Unit | Tool registration: `list_seasons` and `get_season` are read tools; `manage_season` and `manage_race` are not; instructions name them | `src/__tests__/mcp-tools.test.ts`, `src/__tests__/mcp-resources.test.ts` |
| Component | Cycle form: in a season, no race field and the season note; phase type only with the switch; weeks or days | `src/__tests__/components/edit-cycle-form.test.tsx` |
| Integration | Season actions: create, update, delete, restore from Recently deleted, history; another user's season refused and unchanged; a revision per write with the right writer; no-op write makes none | `src/__tests__/integration/seasons.test.ts` (*new*) |
| Integration | Races: add, update, remove; refused with the switch off (season and MCP); the flag set on a date change and an A change, not on a rename; cleared by the user | same |
| Integration | Phases: add an existing cycle (its race moves to the season), add a new draft, move, remove, set type and days; versions bump on season and cycle; race fields refused on a phase cycle | same |
| Integration | Chain: starting phase 1 schedules phase 2; on the end day `getActiveCycleForUser` starts phase 2 and completes phase 1; a season in the future schedules its first phase; starting another cycle pauses the chain; resume schedules it again; a length change of the active phase moves the next start | same |
| Integration | Sync: a `taper` phase writes this week's taper numbers; a `transition` phase leaves zone and rest; a cycle with no season writes the same numbers as before (existing sync tests green, plus one explicit compare) | `src/__tests__/integration/periodization-sync.test.ts` |
| Integration | Restore: a pre-package cycle revision with a race restored onto a phase cycle keeps the race null; a season restore brings races back with their ids | `src/__tests__/integration/plan-revisions.test.ts` |
| Integration | Garmin: `getActiveCycle` returns the season's A race for a phase cycle and the cycle's own race otherwise | `src/__tests__/integration/garmin-queries.test.ts` |
| Integration | Every MCP tool in 2.9: happy path, stale `expectedVersion` refused with nothing changed, another user's ids refused, read-only connection refuses the write tools | `src/__tests__/integration/mcp-seasons.test.ts` (*new*), `src/__tests__/integration/mcp-scopes.test.ts` |
| Integration | Migration data step on legacy rows (section 3) | `src/__tests__/integration/migrations.test.ts` |
| Integration | Export has `seasons` and `season_races`; account deletion removes them; the purge deletes a season deleted 90 days ago | `src/__tests__/integration/account-data.test.ts` |
| e2e | Make a season, add an A race (the e2e user has the switch on through `testDb()`), add two phases (a new taper and an existing cycle), see the taper fit, change the race date, see the banner, mark as re-planned; `testDb()` shows the rows, the flag cleared and the revisions | `e2e/seasons.spec.ts` (*new*) |

Then `pnpm verify` and the full e2e suite. The smoke pass in `CLAUDE.md` runs too: the change
reaches `getActiveCycleForUser`, which the home screen and the workout flow read.

## 6. Order of work

1. Migration, schema, data step and its test; the length helper and `cycleWeek` with days
   (existing tests green).
2. Pure module (`src/lib/utils/seasons.ts`) with unit tests; phase curves wired into the seven
   readers, with the null-type equality test first.
3. Revision layer: object type `season`, snapshot, restore, purge, diff; the cycle restore rule;
   guards.
4. `src/lib/seasons.ts`: seasons, races, the flag, phases, the chain. Integration tests.
5. Server Actions, then the MCP tools, instructions and rules doc. Integration tests per tool.
6. UI: cycles screen section, season pages, cycle page and form.
7. Privacy steps, e2e spec, `pnpm verify`, full e2e, smoke pass.

## 7. Defaults chosen

- Seasons are available to every user; none is made for a user who does not ask (D22 says
  seasons are for everyone, not that every user gets one).
- A user can have several seasons, and they may overlap; a cycle is in at most one.
- Phase dates are computed forward from the season start and the real starts, never stored.
- A phase type of null keeps today's whole curve; that is what migrated cycles and lifter phases
  get.
- Phase lengths are free (1-52 weeks or 1-364 days) only inside a season.
- Taper defaults: full 14 days, half 10, olympic and sprint 7, long runs 14, others 7.
- The re-plan flag is set by any writer and cleared only on purpose, by the user or the
  assistant.
- Races need the endurance switch; a lifter's season has a goal, dates and a next goal.
- Joining a season moves the cycle's race to the season; leaving does not move it back.
- A season delete keeps its cycles; they read as cycles with no season until the season is
  restored or purged (owner question 3).
- Phase reorder by up and down buttons, not drag.
- No training limits on season writes.

## 8. Risks

- **Home screen and workout flow.** The chained start adds a write path to
  `getActiveCycleForUser`. It reuses the scheduled start A4 and B1 built and tested; the
  integration tests above cover the end day. Full e2e and the smoke pass.
- **The curve readers.** Seven places switch to one function. The null-type equality test
  keeps every existing cycle on the same numbers.
- **The `* 7` sites.** A missed one would show a wrong end date for a day-length phase. The
  helper is used at every site listed in 1.1, and a grep for `durationWeeks * 7` is part of the
  review.
- **Migration clash** with C3: the hub renumbers at merge; regenerate the snapshot on rebase.

## 9. Plan corrections (in this PR)

- A4, B1 and B4 are `done` (merged in PRs #222 and #224). C1 is `brief`.
- C1 in the plan says "a season for every user". This brief reads it as "available to every
  user" (D22), not "made for every user" (section 7).
- C1 needs the existing scheduled start (B1) for the chained phases; the plan's `Needs` column
  does not list B1. Added.

## 10. Where C1 meets C3

C3 is built in parallel and owns thresholds, availability, injuries, the strength goal and the
intake interview. C1 adds nothing to those. Contact points for C3's brief:
- The interview asks for the race. It writes the race through C1's module
  (`src/lib/seasons.ts`, add a season and an A race), not a cycle field.
- If C3 changes or retires the generator, a generated plan can join a season through C1's
  phase operations.
- C3's "strength frequency by phase" (D21) and D3 read `phase_type` from C1.
- Athlete level stays on the cycle in C1. If C3 moves experience to the profile, the phase
  curves read the deload cadence from there.

## 11. Files

New: `src/db/schema/seasons.ts`, `src/lib/utils/seasons.ts`, `src/lib/seasons.ts`,
`src/lib/actions/seasons.ts`, `src/lib/validators/seasons.ts`, `src/lib/mcp/tools/seasons.ts`,
`src/app/seasons/` (list redirect, `[id]`, `new`, `[id]/edit`, `[id]/history`), season
components in `src/components/features/`, `e2e/seasons.spec.ts`, the tests in section 5,
`drizzle/0085_seasons.sql`.

Changed: `src/db/schema/training-cycles.ts`, `src/db/schema/plan-revisions.ts`,
`src/lib/plan-revisions.ts`, `src/lib/utils/plan-revisions.ts`, `src/lib/plan-live.ts`,
`src/lib/utils/cycle-position.ts`, `src/lib/utils/periodization.ts`,
`src/lib/periodization-sync.ts`, `src/lib/training-limits.ts`, `src/lib/garmin/queries.ts`,
`src/lib/garmin/analytics/{overview,projection,race}.ts`, `src/lib/actions/training-cycles.ts`,
`src/lib/actions/metrics.ts`, `src/lib/validators/training-cycles.ts`,
`src/lib/mcp/tools/cycles.ts`, `src/lib/mcp/revisions.ts`, `src/lib/mcp/instructions.ts`,
`docs/mcp/app-rules.md`, `src/app/api/[transport]/route.ts`, `src/app/cycles/` pages,
`src/components/features/{CyclesListClient,EditCycleForm,CycleDetailClient,RecentlyDeleted}.tsx`,
`src/lib/account-data.ts`, `docs/privacy/data-inventory.md`, `src/app/privacy/page.tsx`,
`src/app/oauth/consent/page.tsx`, `src/lib/constants/legal.ts`.

## 12. Owner decisions (2026-11-12)

The owner took every recommendation. The defaults in section 7 are accepted, including the plan
correction that seasons are open to every user and none is made unasked.

1. **Chained phases.** The next phase starts by itself through the scheduled start (writer
   `sync`). A cycle started or scheduled outside the season pauses the chain, and the season
   shows "Resume".
2. **Phase curves** as in 2.5: base, general and build ramp 0.80 to 1.00 with deloads by
   level; peak flat 1.00; taper 0.60 to 0.35; transition flat 0.50 and `work` sets left alone.
   Named constants labelled Inference.
3. **Deleting a season** keeps its cycles. They act as cycles with no season until the season
   is restored or purged.
4. **Migration:** one season per live cycle with `race_date` or `athlete_level`, completed ones
   included; the race becomes the A race; the cycle becomes phase 1 with a null phase type; its
   race fields are cleared and its version bumps.

C3 contact (hub, 2026-11-12): C3's interview reads the race through its own reader of the race
fields. C1 exports the single race reader from `src/lib/seasons.ts` (2.7); whichever PR merges
second points the interview at it.

## 13. Where the build differs from the brief

- **Phase fields are set on the season, not on the cycle.** `manage_training_cycle` takes no
  `seasonId`, `phaseType` or `durationDays`: phases are made and changed with `manage_season`
  (`add_phase`, `set_phase`). The cycle form of a phase shows its length and a link to the
  season page instead of the week picker and the race field. It sends a length only when the
  user changes it, so a length in days stays.
- **A length in weeks replaces a length in days.** A weeks write (cycle form, MCP update)
  clears `duration_days`.
- **A restore restores the season link too.** A revision made after this package but before the
  cycle joined a season takes the cycle out of the season again (a restore is of the whole
  object). Only a revision from before this package, which has no season key, keeps the season
  and drops the old race ("Race kept on the season").
- **A race moved in on join does not flag the season.** It is the same fact in a new home, not
  a change of plan. A season restore that changes the races flags it.
- **Garmin's race views** read the season's A race and the season's taper phase start for a
  phase cycle. A cycle in no season reads its own fields exactly as before, including a distance
  with no date.
- **The single race reader** is `raceForCycle(userId, cycle)` in `src/lib/seasons.ts`, with
  `activeCycleRace(userId)` for the active cycle. These are the names for C3's interview.
- **No limits on the chained start or on `resume`** (BACKLOG.md, "Seasons: limits and Garmin
  views across phases").
- **Review fixes (2026-11-12).**
  - A phase's length changes only on the season: the cycle action and `manage_training_cycle`
    refuse a new `durationWeeks` on a phase of a live season and point to `set_phase`, which
    schedules the next phase again.
  - Every restore and change-set undo settles each season it touched (`settleSeason` in
    `src/lib/plan-revisions.ts`): a revision of the phase list, dense positions, the 30-phase cap
    and the chain scheduled again. A cycle restored to a season that was purged comes back with
    no season.
  - A season restore brings back the re-plan flag of a flagged revision, so undoing "Mark as
    re-planned" works; a race change in the restore flags it as before. "Mark as re-planned" on a
    season with no flag writes nothing.
  - `resume` runs in one write under the season lock: it checks the version there, makes a
    revision and returns the new version.
  - A read starts every scheduled cycle that is due, in order, so after a long absence the home
    screen shows the phase that runs today.
  - `list_training_cycles` returns `race` on each cycle, as `get_training_cycle` does.
  - The Garmin race projection and the cycle calendar use the phase curve and the length in days.
- **Re-review fixes (2026-11-12).**
  - A race the user set or moved on a phase while its season was deleted goes back to the season
    when the season is restored: it becomes the A race's date (or a new A race), and the season
    is flagged with the reason. It is never dropped.
  - One lock order for every write that touches seasons and cycles: seasons first, in id order,
    then all cycle rows involved (each phase of those seasons included) in id order
    (`lockSeasonsThenCycles`). Season writes, restores, change-set undos and cycle starts take
    their locks this way, so a restore and a season write on the same season cannot deadlock.
  - The 30-phase cap also holds for restores. It is a data cap, not a training limit, so no
    writer can go past it; a restore that would break it is refused with a message that says to
    remove a phase first.
