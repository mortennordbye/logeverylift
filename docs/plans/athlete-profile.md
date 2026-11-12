# Athlete profile, thresholds and the intake interview

Package C3 of [`triathlon-coach-plan.md`](triathlon-coach-plan.md). One branch and one PR
(`feat/athlete-profile-c3`). Inputs: the audit (`docs/triathlon-coach-audit.md`, sections 2, 5
and 9, decisions D10, D12, D15, D18, D21, T5 and T10), the research
(`docs/research/endurance-training-reference.md`), `CLAUDE.md`, `TESTING.md` and the merged
briefs [`foundations.md`](foundations.md) (endurance switch, display units),
[`revisions.md`](revisions.md) (the revision layer) and [`ai-coach.md`](ai-coach.md) (coach
memory, MCP conventions).

Status: building, 2026-11-12. The owner settled the open questions on 2026-11-12 (section 12). The findings describe `main` at 2bdac35; every `file:line` in them
was opened then. Names marked *new* do not exist yet. Package C1 (seasons, races and phases) is
built in parallel; section 2.6 names the one place where the two meet.

## 0. Goal

After this PR:

1. Every user can enter thresholds by hand and log field tests, with history: FTP, threshold
   heart rate for bike and run, threshold run pace, swim CSS and max heart rate (D12, D15).
2. An admin with Garmin data sees the Garmin estimate next to each threshold as a suggestion,
   and can take it with one tap (D12).
3. A user with the endurance switch on has an athlete profile: available days, hours per week,
   the longest day, endurance experience, injuries and limits, and a strength goal (keep muscle,
   get stronger, minimal) (D10, D18).
4. An intake interview fills that profile, in the app and over MCP. It writes the profile
   tables, not coach memory (T10). It offers the user's existing coach memory entries about
   injuries and availability, so they move to their new home and the old entries become
   inactive (ai-coach.md, owner decision 4).
5. The strength part of a plan follows the strength goal. The default frequency by phase is one
   pure rule that the app, the AI and the generator share (D10, D21).
6. Every write is a revision (T5). The assistant can read and write all of it over MCP.

For a lifter with the endurance switch off, the only change is a "Thresholds" entry in More
(open question 1).

## 1. Findings in the code

### 1.1 The switch, Garmin access and units

- The endurance switch is one flag on the user, read with `enduranceEnabledFor`
  (`src/lib/endurance.ts:18`; column at `src/db/schema/users.ts:60`). Nothing may check the
  admin role instead (D15).
- Garmin is on only for admins with the key set (`garminAllowedFor`,
  `src/lib/garmin/access.ts:20`).
- Display units are `distanceUnit` (km or mi) and `swimUnit` (m or yd) on the user
  (`src/db/schema/users.ts:55`, `src/db/schema/users.ts:56`). The helpers in
  `src/lib/utils/units.ts` convert at the edge; MCP and export stay metric
  (`src/lib/utils/units.ts:12`). Pace text already follows the units (`formatPace`,
  `src/lib/utils/format.ts:88`; `formatSwimPace`, `src/lib/utils/format.ts:96`).
- The user has a lifting `experienceLevel` (beginner, intermediate, advanced,
  `src/db/schema/users.ts:39`). The cycle has its own `athleteLevel` (novice, intermediate,
  advanced, `src/db/schema/training-cycles.ts:51`), which the periodization uses
  (`AthleteLevel`, `src/lib/utils/periodization.ts:22`). The audit names the two scales as a gap
  (section 2, "One experience scale").

### 1.2 Thresholds today

- There are no stored thresholds. The Garmin section derives them each time: weekly FTP,
  critical power, run critical speed (m/s), LTHR for run and bike, and the watch's LTHR, each
  from the 90 days before the week (`thresholdHistory`, `src/lib/garmin/analytics/trends.ts:96`;
  the shape at `src/lib/garmin/analytics/trends.ts:84`; the window at
  `src/lib/garmin/analytics/trends.ts:74`). FTP is 0.95 times the best 20-minute power
  (`FTP_FACTOR`, `src/lib/garmin/analytics/trends.ts:76`). Max HR comes from the watch per
  activity (`thresholdsFor`, `src/lib/garmin/analytics/thresholds.ts:36`).
- No swim CSS estimate exists in the Garmin code.
- The MCP Garmin trends tool returns the weekly estimates (`src/lib/mcp/tools/garmin.ts:92`).
- Decision O-6 of the Garmin design said no manual thresholds
  (`docs/plans/garmin-insights-design.md:679`, the question at
  `docs/plans/garmin-insights-design.md:686`). D12 reverses it.

### 1.3 Coach memory holds injuries and availability for now

- Coach memory kinds are preference, limit, observation and decision
  (`src/db/schema/coach-memory.ts:19`). The MCP tool tells the assistant to put injuries and
  weekly availability there "until the app has a place for them"
  (`src/lib/mcp/tools/coach-memory.ts:52`). The server instructions and the rules doc say the same
  (`src/lib/mcp/instructions.ts:36`, `docs/mcp/app-rules.md:42`).
- `listCoachMemory` reads active entries; `changeCoachMemory` deactivates one through the
  revision layer (`src/lib/coach-memory.ts:40`, `src/lib/coach-memory.ts:90`).
- Entries are free text. Nothing tells an injury from a life limit except the words.

### 1.4 The revision layer

- `planWrite` runs one transaction, locks each touched object, checks its version and stores a
  revision with a full snapshot (`src/lib/plan-revisions.ts:385`). The context carries writer,
  reason and change set (`PlanWriteContext`, `src/lib/plan-revisions.ts:62`).
- Object types are a text enum: program, cycle, memory (`PLAN_OBJECT_TYPES`,
  `src/db/schema/plan-revisions.ts:21`). The comment there plans for a threshold type. A new
  type touches: the table lookup (`src/lib/plan-revisions.ts:117`), snapshots
  (`src/lib/plan-revisions.ts:181`), restore (`restoreInSession`,
  `src/lib/plan-revisions.ts:1062`), the change-set undo order
  (`src/lib/plan-revisions.ts:1131`), the deleted list and purge
  (`listDeleted`, `src/lib/plan-revisions.ts:1332`; `purgePlanRevisions`,
  `src/lib/plan-revisions.ts:1368`), and the pure side (snapshot types and names,
  `src/lib/utils/plan-revisions.ts:17`, `src/lib/utils/plan-revisions.ts:24`; fields a restore
  keeps, `MEMORY_KEPT`, `src/lib/utils/plan-revisions.ts:285`). Coach memory is the model to copy:
  one row per object with id, user id, version and soft delete.

### 1.5 The triathlon generator

- `buildTriathlonPlan` builds one fixed weekly template for a full Ironman, with peak volumes by
  level and up to two rest days (`src/lib/utils/triathlon-plan.ts:166`; inputs at
  `src/lib/utils/triathlon-plan.ts:105`). It ignores race distance and hours per week.
- Strength is always two sessions, Workout A on Monday and Workout B on Thursday, at 8-15 reps
  (`src/lib/utils/triathlon-plan.ts:12`, the lifts at `src/lib/utils/triathlon-plan.ts:227` and
  `src/lib/utils/triathlon-plan.ts:238`). The research says light high-rep work does not improve
  economy, and heavy work (at least 80% 1RM, 3-6 reps) plus plyometrics does
  (`docs/research/endurance-training-reference.md:208`).
- The action checks the endurance switch (`src/lib/actions/triathlon-plan.ts:74`) and takes
  weeks, rest days, goal and level (`src/lib/actions/triathlon-plan.ts:28`). Its only caller is
  the "Triathlon plan" page, linked from the cycles list
  (`src/components/features/CyclesListClient.tsx:409`).
- The seed has plyometric exercises: "Jump Squat", "Box Jump" and "Pogo Hops"
  (`scripts/seed.ts:109`, `scripts/seed.ts:185`, `scripts/seed.ts:186`).
- The weekly template has one phase for all its weeks. The phase is computed from the week
  number (`TrainingPhase`, `src/lib/utils/periodization.ts:24`; `periodizedLoad`,
  `src/lib/utils/periodization.ts:95`). So one cycle cannot hold two strength days in base and one
  in build. Frequency by phase needs phases as separate cycles, which C1 adds (T8).

### 1.6 The race

- The race is on the cycle: `raceDate` and `raceDistance` (full or half)
  (`src/db/schema/training-cycles.ts:65`, `src/db/schema/training-cycles.ts:67`), with the goal at
  `src/db/schema/training-cycles.ts:44`. C1 moves it to the season.

### 1.7 MCP

- Tools are registered per request; Garmin tools only when Garmin is allowed
  (`src/app/api/[transport]/route.ts:103`, `src/app/api/[transport]/route.ts:116`).
- A tool is a read tool only with `readOnlyHint` (`isReadTool`, `src/lib/mcp/scopes.ts:53`). The
  read-only server refuses prompt registration (`src/lib/mcp/scopes.ts:58`), so a prompt is
  registered on the raw server, as resources are.
- The instructions list "No tables yet for injuries, availability or thresholds" under "Not in
  the app yet" (`src/lib/mcp/instructions.ts:36`).

### 1.8 Privacy

- Coach memory is already in the export (`src/lib/account-data.ts:139`).
- The health-data line of the inventory names heart rate zones, notes and Garmin thresholds,
  but not injuries or thresholds entered by hand (`docs/privacy/data-inventory.md:33`).
- The sign-up consent names "body weight, heart rate zones, readiness and notes"
  (`src/components/features/ConsentChecks.tsx:38`). `CONSENT_VERSION` is 2026-10-25 and
  `LEGAL_VERSION` 2026-11-12.4 (`src/lib/constants/legal.ts:16`, `src/lib/constants/legal.ts:7`).
- Friends see completed workouts but never heart rate zones, RIR/RPE, notes or readiness
  (`docs/privacy/data-inventory.md:49`; `getFriendSessionDetail`,
  `src/lib/actions/friends.ts:1096`).

## 2. Design

### 2.1 Data model

Three new tables (*new*), each with `user_id` (FK to `user`, cascade), `version` (integer,
default 1), `deleted_at` (soft delete) and `created_at`/`updated_at`, like `coach_memory`, so the
revision layer can lock, version and restore them.

**`athlete_profiles`**: one row per user (unique `user_id`). Created on the first write.

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `endurance_level` | text enum `novice`, `intermediate`, `advanced`, null | Endurance experience, on the cycle's scale, so a plan can use it as the cycle's athlete level |
| `available_days` | integer[], null | Days the athlete can train, 1 = Monday to 7 = Sunday |
| `hours_per_week` | real, null | Hours a normal week can hold, 1-40 |
| `longest_day_minutes` | integer, null | The most time one day can hold, 30-720 |
| `long_day` | integer, null | The day that can hold it (1-7) |
| `strength_goal` | text enum `keep_muscle`, `stronger`, `minimal`, null | D10 |
| `interview_completed_at` | timestamp, null | When the user (or the assistant) finished the interview |

**`athlete_thresholds`**: one row per value, so the history is the rows.

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `kind` | text enum `ftp`, `lthr_bike`, `lthr_run`, `run_threshold_pace`, `swim_css`, `max_hr` | |
| `value` | real, not null | Metric: watts (ftp), bpm (the three heart rates), m/s (run pace and CSS). Pace is stored as speed, as the research says, because pace ranges invert |
| `measured_on` | date, not null | The day of the test or estimate, in the user's zone |
| `source` | text enum `manual`, `test`, `garmin` | `garmin` means the user took the Garmin suggestion |
| `protocol` | text enum, null | The field test used (2.3), when `source` is `test` |
| `test_data` | jsonb, null | The test's inputs (for example the 400 m and 200 m times), so the value can be checked |
| `notes` | text, null, at most 500 chars | |

Index `(user_id, kind, measured_on)`. The current value of a kind is the live row with the latest
`measured_on`, then the highest id. Cap: 100 live rows per kind per user.

**`athlete_injuries`**:

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `area` | text enum: `foot`, `ankle`, `achilles`, `calf`, `shin`, `knee`, `hamstring`, `quad`, `hip`, `groin`, `lower_back`, `upper_back`, `neck`, `shoulder`, `elbow`, `wrist`, `other` | Structured, so the AI and later rules (D3) can read it |
| `side` | text enum `left`, `right`, `both`, null | |
| `description` | text, not null, 1-500 chars | In the user's words |
| `avoid` | text, null, at most 300 chars | What training to avoid, for example "no downhill running" |
| `status` | text enum `active`, `managed`, `past` | Active: hurts now. Managed: lives with it. Past: healed, kept as history (the research counts injury history as a risk input) |
| `started_on`, `ended_on` | date, null | |

Index `(user_id, status)`. Cap: 50 live rows per user.

Not in this PR: an entry check of current base (research, "Entry check" row in the audit), and
anything about illness (C5).

### 2.2 Revisions (T5)

Three new object types in `plan_revisions`: `athlete` (the profile row), `threshold` (one row)
and `injury` (one row). Each is a one-row snapshot like `memory`: `{ v: 1, athlete: row }`,
`{ v: 1, threshold: row }`, `{ v: 1, injury: row }`. The revision layer gets, for each type: the
table lookup, the snapshot, restore of one row by the same id, the history text ("FTP 250 W →
265 W", "Injury knee: active → past", "Strength goal: keep muscle → stronger"), the change-set
undo (after memory in the lock order), Recently deleted (thresholds and injuries; the profile is
never deleted) and the 90-day purge of deleted rows.

Writers: `user` (the app) and `assistant` (MCP). Restore keeps id, user id and timestamps, as
memory does. A restore of a deleted threshold or injury checks the cap, as memory does.

### 2.3 Thresholds and field tests

Pure rules in `src/lib/utils/thresholds.ts` (*new*), unit tested, each citing the research line.

| Kind | Unit stored | Field test | How the value is computed | Evidence |
|---|---|---|---|---|
| `lthr_run` | bpm | `run_30min`: 30 min solo all-out run after a warm-up | Mean HR of the last 20 min | Research line 96 (Friel) |
| `run_threshold_pace` | m/s | Same test | Mean pace of the last 20 min: distance of the last 20 min / 1200 s | Inference: the research gives HR only |
| `lthr_bike` | bpm | `bike_30min`: 30 min solo all-out ride | Mean HR of the last 20 min | Research line 96 |
| `ftp` | W | Same test, with a power meter | 0.95 x mean power of the best 20 min | Coach convention; the app's Garmin rule uses the same factor. Not in the research doc: the build adds it there with a source, or labels it as the app's rule |
| `swim_css` | m/s | `css_400_200`: 400 m then 200 m all-out, full rest between | 200 / (T400 - T200) | Research line 92 |
| `swim_css` | m/s | `swim_t1000`: 1000 m time trial | 1000 / T1000 (Friel T-time) | Research line 92 |
| `max_hr` | bpm | none | Entered by hand or taken from the watch's max | No protocol in the research; the app says so |

- **Manual entry.** Every kind can be typed in directly (source `manual`), in the user's units:
  pace as min:ss per km or mile, CSS as min:ss per 100 m or 100 yd, converted to m/s at the edge
  with the units helpers.
- **Ranges.** FTP 50-600 W; heart rates 80-230 bpm, and LTHR below max HR when both exist (a
  warning, not a block); run pace 2:00-12:00 per km; CSS 0:50-4:00 per 100 m. Values outside are
  refused.
- **Staleness.** A threshold older than 8 weeks shows "Last tested 9 weeks ago. Retest after a
  recovery week." Research line 103: retest every 4-8 weeks is a convention, no tested interval.
- **Zones** from thresholds are not shown in this PR (C6 shows targets in the user's numbers).

### 2.4 Garmin suggestions (admins only)

Only where `garminAllowedFor` is true and a Garmin connection has synced. A server function
reads the latest week of the Garmin threshold history and the watch's max HR, and returns one
suggestion per kind: FTP, LTHR run, LTHR bike, run pace (from run critical speed), max HR. No CSS
(no estimate exists).

- Shown next to the current value: "Garmin estimate: 265 W (from your rides, last 90 days).
  Use this". "Use this" adds a threshold row with source `garmin` and today's date.
- Hidden when the current value equals the estimate (rounded), or is newer than the estimate's
  week and came from a test.
- Run pace carries the research warning: Garmin's own auto-detected LT pace reads about 12% slow
  (research line 96). The app's estimate is from critical speed, not Garmin's auto pace, but it
  is still an estimate: "A 30-minute test is better."
- MCP: `get_athlete_profile` returns the same suggestions for admins, never for other users.
- Nothing in the threshold tables is ever written by the Garmin sync. Only a user or assistant
  write stores a value (D12: "suggestion").

### 2.5 Strength goal and frequency by phase (D10, D21)

One pure rule in `src/lib/utils/strength-goal.ts` (*new*): the default strength sessions per
week and the scheme, by goal and phase. Phases: today's `TrainingPhase` values, plus C1's
general prep and transition when they exist.

| Goal | General prep, base | Build | Peak | Taper | Maintain | Transition |
|---|---|---|---|---|---|---|
| Keep muscle | 2 | 1 | 1 | 1 light | 2 | 0 |
| Get stronger | 2 | 1 | 1 | 1 light | 2 | 0 |
| Minimal | 1 | 1 | 1 | 1 light | 1 | 0 |

Schemes, with the research rows (`docs/research/endurance-training-reference.md:214-222`):
- **Keep muscle:** main lifts 3 x 6-10 at RIR 2-3, accessories 2 x 10-15. Concurrent training
  costs no muscle size (Schumann 2022, line 206).
- **Get stronger:** main leg lifts 3-4 x 3-6 at about 80-90% 1RM, RIR 1-3, plus plyometrics
  2-4 x 5-10 contacts in base; 2-3 x 3-5, RIR 2-3, no new exercises, in build and peak.
- **Minimal:** one 30-40 minute full-body session: 2 x 5-8 on the main lifts.
- **All:** taper "light" means the last heavy session 7-10 days before the race, then light
  activation only. Transition: 1-2 weeks off heavy lifting.

The rule is a default (D21). In this PR:
- `get_athlete_profile` returns the default for the active cycle's current phase and the whole
  table, and the instructions tell the assistant to follow it, or to give the reason for a
  different count in the write's `reason`, which the revision stores.
- The generator uses it (2.7).
- No code refuses an assistant write that differs from the default. One weekly template cannot
  vary its strength days by phase (1.5), so a check today would compare a whole block against one
  phase. The check with refuse-and-override belongs in D3, which already owns "strength by
  phase", once C1 stores phases as cycles. Open question 4.

### 2.6 The intake interview

**Steps** (same order in the app and over MCP; each step can be skipped and answered later):

1. **Race.** Shows the race of the active cycle (date and distance). If none: "No race set" with
   a link to the cycle. This step reads only. *Contact point with C1:* one function,
   `interviewRace(userId)` (*new*, in `src/lib/athlete-profile.ts`), reads the race. C1 changes
   only that function to read the season's A race. Nothing else in C3 reads race fields.
2. **Experience:** endurance level (novice, intermediate, advanced), with one line each.
3. **Availability:** days (seven chips), hours per week (stepper, 0.5 h), longest day (hours and
   minutes) and which day.
4. **Strength goal:** three cards (keep muscle, get stronger, minimal), each with two lines from
   2.5 and the frequency by phase.
5. **Thresholds:** for each kind, the current value or "Not set", with three choices: type it,
   do a field test (the protocol and its inputs), or skip. Admins see the Garmin suggestion.
6. **Injuries and limits:** the list, add an injury, mark one as past.
7. **From your coach memory:** only when the user has active coach memory entries of kind
   `limit` or `observation`. Each is shown in full with two buttons: "Moved" and "Keep in
   memory". The user first enters the fact in the step it belongs to (the step 6 form opens from
   here with the text in the description), then taps "Moved". "Moved" makes the entry inactive
   (writer `user`, reason "Moved to the athlete profile by the intake interview"). "Keep" does
   nothing. Life limits (travel, equipment) stay in memory.
8. **Done:** a summary; "Finish" sets `interview_completed_at`.

**Why the memory step does not parse text.** Entries are free text ("left knee sore after runs
over 90 min"). A parser would guess the area, the status and what to avoid, and a wrong guess
writes a health fact the user never stated. Showing the entry and letting the user (or the
assistant, in a conversation) restate it is safe and short: the owner has a handful of entries.

**Saving.** Each step saves when the user taps Next, through its own Server Action, so a half-done
interview keeps what was answered. Each save is one revision. All saves of one interview run
share one change set (the app passes a change-set id it makes when the interview opens), so the
user can undo the whole interview in one step.

**Again later.** The profile page has "Run the interview again", which starts at step 1 with the
current answers filled in.

**Over MCP.**
- An MCP prompt `intake_interview` (*new*), registered on the raw server like the resources. The
  read-only wrapper refuses prompt registration, so the prompt bypasses the scopes check. That is
  safe because a prompt only returns text and writes nothing; every write it asks for goes through
  the scoped write tools. A test checks that getting the prompt writes no row. It
  tells the model the steps above, to ask one step at a time, to read `get_athlete_profile` first,
  to write each answer with the tools in 2.8 as soon as the user gives it, and, for step 7, to
  restate each memory entry, ask the user, write the fact to its table, then deactivate the entry
  with `manage_coach_memory` and the reason "Moved to the athlete profile".
- `get_athlete_profile` returns `interview`: whether it is complete, which steps have no answer
  yet, and the memory entries to offer (step 7). Clients without prompt support get the same steps
  from the server instructions.
- D10: "the AI can ask the same interview over MCP". The prompt and the tools do that.

**Gate.** The interview, the profile, availability, injuries and the strength goal need the
endurance switch (D18). Thresholds do not (D15; open question 1).

### 2.7 The generator: change it now, retire it later

Decision (open question 3): keep `buildTriathlonPlan`, and change it in two small ways now:

1. **The interview comes first.** The "Triathlon plan" page sends a user who has not finished
   the interview to it, then back. D10 says making a plan starts with the interview. The form is
   filled from the profile: rest days are the days not available (at most two kept, the rest
   shown as a note), level is the endurance level.
2. **Strength follows the goal** through the rule in 2.5, at the base phase, since a generated
   cycle is one template:
   - Keep muscle: Workout A and B as today.
   - Get stronger: Workout A and B with Front Squat and Romanian Deadlift at 4 x 5 (rest 180 s),
     and Box Jump 3 x 5 at the start of A and Pogo Hops 3 x 10 at the start of B.
   - Minimal: one session on Monday (Front Squat, Romanian Deadlift, Pull-up, Dumbbell Bench
     Press, Pallof Hold, 2 working sets each). Thursday becomes a rest day.
   - No strength goal set (a user who skipped step 4): as today.
3. The header comment and the page say what the generator does not use: hours per week, the
   longest day, the race distance (it plans a full) and thresholds.

Why not retire it now: it is the only way to make a plan in the app, and the owner may want it
until the AI builds plans from structured workouts (C4) and seasons (C1). Why not rewrite it: a
plan from hours, days, race distance and phases is what the AI does from parts, and C1, C2 and C4
change the model under it. A BACKLOG entry records "retire the triathlon generator after C4",
with the reason and the files.

### 2.8 MCP tools

Conventions from ai-coach.md: `readOnlyHint` on reads; every write takes `reason` (stored in the
revision) and `expectedVersion` on an existing object; results return the new `version` and the
`changeSetId`. All values are metric. No training limits on these writes: they are facts about
the athlete, not plan changes.

| Tool | Hint | Registered | What |
|---|---|---|---|
| `get_athlete_profile` (*new*) | read | always | Thresholds: current value per kind (metric, plus pace text in min:ss per km and per 100 m), date, source, protocol, age in weeks, stale flag; `history: true` adds every live row per kind. With the switch on, also: profile fields, race (from `interviewRace`), injuries (active and managed; past with `includePast`), the strength default (2.5) for the active cycle's phase and the full table, and `interview` (2.6). Garmin suggestions for admins |
| `manage_thresholds` (*new*) | write | always | `add`: kind, value (`watts`, `bpm`, `paceSecondsPerKm` or `paceSecondsPer100m` by kind), `measuredOn` (default today), `source` (`manual`, `test`, `garmin`), optional `protocol` and `testData` (the server computes the value from the test inputs and refuses a value that disagrees), `notes`. `update`: id and any field. `delete`: id (the user can restore it) |
| `manage_athlete_profile` (*new*) | write | switch on | Set any of `enduranceLevel`, `availableDays`, `hoursPerWeek`, `longestDayMinutes`, `longDay`, `strengthGoal`; `completeInterview: true` |
| `manage_injuries` (*new*) | write | switch on | `add`, `update`, `resolve` (status `past`, `endedOn` default today), `delete` |
| `intake_interview` (*new*) | prompt | always on the raw server; the text says to stop if `get_athlete_profile` shows the switch off | 2.6 |

Changed:
- `manage_coach_memory`: the description drops "Injuries and weekly availability go here as
  'limit' or 'observation' entries until the app has a place for them" and says where they go
  now.
- Server instructions and `docs/mcp/app-rules.md`: the athlete profile in the model section;
  "No tables yet for injuries, availability or thresholds" leaves "Not in the app yet"; the
  review steps read `get_athlete_profile` after `get_coach_memory`; a short "Strength" line: follow
  the strength default, or give the reason for a different count.
- The unit tests that pin tool groups and the instructions get the new tools.

### 2.9 UI

- **Thresholds** at `/more/thresholds` (*new*), for every user, in More under Training. One row
  per kind: the value in the user's units, the date, the source ("Field test", "Entered",
  "Garmin estimate"), and a stale line. Tap a row: a sheet with "Enter value", "Field test" (the
  steps of the protocol in plain words, then its inputs; the computed value shows before saving)
  and the history (newest first, each with delete). Admins see the Garmin suggestion with "Use
  this". Lifters see the same page; nothing else changes for them.
- **Athlete profile** at `/more/athlete` (*new*), behind the switch, in More under Training:
  availability, strength goal, experience, injuries (active and managed, past folded), a link to
  Thresholds, and "Start the interview" or "Run the interview again".
- **Interview** at `/more/athlete/interview` (*new*): one step per screen, "Step 3 of 8", Back
  and Skip at the top, Next in a pinned bottom bar. Step 7 as in 2.6.
- **Injury sheet:** area (picker), side, description, what to avoid, status, dates; delete at the
  bottom with a confirm.
- **Triathlon plan page:** the interview gate and the prefill (2.7).
- Recently deleted thresholds and injuries on their pages, like coach memory.
- 44 px targets, `:active` feedback, primary actions in a pinned bottom bar, destructive actions
  at the bottom (CLAUDE.md UI rules). Server Actions are called through `callAction()`.

### 2.10 Code layout

- Pure: `src/lib/utils/thresholds.ts` (protocols, ranges, conversion, staleness, the current
  value per kind), `src/lib/utils/strength-goal.ts` (2.5), the snapshot and diff text in
  `src/lib/utils/plan-revisions.ts`.
- Server: `src/lib/athlete-profile.ts` (*new*, plain module that takes a resolved user id, like
  `src/lib/coach-memory.ts`): reads, writes through `planWrite`, `interviewRace`, the Garmin
  suggestions, the memory entries to offer.
- Server Actions: `src/lib/actions/athlete-profile.ts` (*new*), following the CLAUDE.md template:
  `requireSession`, Zod, the switch check where 2.6 says so, ownership through the revision
  layer, `[athleteProfile]` log tags.
- MCP: `src/lib/mcp/tools/athlete-profile.ts` (*new*).
- Schema: `src/db/schema/athlete-profile.ts` (*new*).

## 3. Migration and rollback

One migration, generated with `pnpm db:generate` (create, not rename), SQL and `drizzle/meta/`
committed together. The number follows `0083_ai_coach.sql`; if C1 merges first, the hub
renumbers and regenerates.
- `CREATE TABLE athlete_profiles`, `athlete_thresholds`, `athlete_injuries`, with FKs (cascade),
  the unique index on `athlete_profiles.user_id` and the indexes in 2.1.
- No `CREATE TYPE` (text enums). No data step: memory entries move only by user action (2.6).
- `plan_revisions.object_type` gets three values; it is a text column, no SQL.

**Rollback.** Data lost: athlete profiles, thresholds, injuries and their revisions. Memory
entries that the interview made inactive stay inactive; the user can turn them on again in
Coach memory.
1. Before the old image runs, delete the new revisions (the old image's history and AI changes
   feed fail on an unknown snapshot, as noted for memory in ai-coach.md section 3):
   ```sql
   DELETE FROM plan_revisions WHERE object_type IN ('athlete', 'threshold', 'injury');
   ```
2. Deploy the previous image. It ignores the new tables.
3. Then, optionally:
   ```sql
   DROP TABLE athlete_injuries;
   DROP TABLE athlete_thresholds;
   DROP TABLE athlete_profiles;
   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<hash of this migration>';
   ```

## 4. Privacy steps (`privacy-compliance` skill)

1. **Inventory** (`docs/privacy/data-inventory.md`), first:
   - New row "Athlete profile": the three tables; what each holds; purpose (planning endurance
     training with the user and their connected assistant); Art. 6(1)(b) + 9(2)(a); retention
     until the user deletes it or the account; deleted thresholds and injuries restorable for 90
     days; revisions follow the Plans row.
   - Health line: add thresholds (heart rate, power and pace), injuries and their history.
   - MCP recipient row: reads add the athlete profile, thresholds and injuries; writes add them.
   - Garmin row: the threshold suggestion is computed on our server from the admin's own data
     and is stored only when the user taps "Use this".
2. **Policy** (`src/app/privacy/page.tsx`): the athlete profile and injuries in plain words; the
   assistant can read and change them; friends never see them.
3. **MCP consent page** (`src/app/oauth/consent/page.tsx`): name thresholds, the athlete profile
   and injuries.
4. **Sign-up consent text** (`ConsentChecks`): add "injuries".
5. **Versions:** `LEGAL_VERSION` to the merge date. `CONSENT_VERSION` raised to the same value
   (open question 2). Reason: an injury is a new kind of health data (a medical condition), and
   the skill says a new kind needs consent again. Thresholds alone would not need it: heart rate
   is already named, and power and pace are performance data.
6. **Export:** the three tables in `collectUserData`; the coverage test fails until then.
7. **Delete:** cascade on `user_id`.
8. **Friends:** none of the three tables is read by any friends code. A test checks that a
   friend's session detail and profile carry no threshold or injury fields.
9. **In-app AI:** not sent to AI Setup or the check-in. Only the user's own connected assistant
   reads them.
10. **Logs:** ids and tags only (`[athleteProfile]`, `[mcp:athlete]`). Never values, injury text
    or notes.

## 5. Tests per layer

| Layer | What | File |
|---|---|---|
| Unit | Field tests: CSS from 400/200 (example from the research formula), T-time, FTP 0.95 x 20 min, LTHR and pace from a 30 min test; refused inputs (T200 >= T400, zero times) | `src/__tests__/thresholds.test.ts` (*new*) |
| Unit | Ranges; pace and CSS conversion both ways in km, mi, m and yd (round trip within 1 s); current value per kind (latest date, then id; deleted ignored); stale after 8 weeks | same |
| Unit | Strength default for each goal and phase, including C1's phase names; scheme text | `src/__tests__/strength-goal.test.ts` (*new*) |
| Unit | Generator: keep muscle equals today's plan; stronger has 4 x 5 main legs and the plyometrics; minimal has one strength day and Thursday free; no goal equals today's plan; rest days from availability | `src/__tests__/triathlon-plan.test.ts` |
| Unit | Snapshot names and diff text for the three new types | `src/__tests__/plan-revisions.test.ts` |
| Unit | Tool registration: `get_athlete_profile` is a read tool; the three write tools are not; instructions name the new tools | `src/__tests__/mcp-tools.test.ts`, `src/__tests__/mcp-resources.test.ts` |
| Integration | Server Actions: profile, thresholds, injuries: write, update, delete, restore; one revision per write with writer `user`; stale `expectedVersion` refused; caps; switch off refuses profile and injury writes and allows thresholds | `src/__tests__/integration/athlete-profile.test.ts` (*new*) |
| Integration | Interview: each step saves alone; all saves share one change set; undoing the change set restores the old profile; "Moved" deactivates the memory entry with the reason; "Finish" sets the time | same |
| Integration | Garmin suggestions: admin with Garmin rows gets them; a non-admin with the same rows gets none; "Use this" writes source `garmin` | same |
| Integration | MCP: every tool and operation, writer `assistant` and the client's change set; another user's ids refused and nothing changed; switch off hides the profile and injury tools; pace inputs converted; a test value that disagrees with `testData` refused | `src/__tests__/integration/mcp-athlete-profile.test.ts` (*new*) |
| Integration | Every new write tool refuses on a read-only connection | `src/__tests__/integration/mcp-scopes.test.ts` |
| Integration | `restore_revision` and `list_revisions` work on the three types; the change-set undo covers them | `src/__tests__/integration/plan-revisions.test.ts` |
| Integration | The triathlon plan action builds by strength goal and refuses nothing new | `src/__tests__/integration/endurance-switch.test.ts` |
| Integration | Export holds the three tables; deletion removes them; a friend's view carries none of it | `src/__tests__/integration/account-data.test.ts`, `src/__tests__/integration/friends.test.ts` |
| Integration | Migration: tables, FKs and indexes exist; cascade on user delete | `src/__tests__/integration/migrations.test.ts` |
| e2e | Interview, as a user with the switch on: availability, strength goal, CSS by field test, an injury, one memory entry moved; `testDb()` shows the rows, the inactive memory entry and the revisions | `e2e/athlete-interview.spec.ts` (*new*) |
| e2e | Thresholds as a lifter (switch off): add FTP by hand, see it in the history, delete it; the Athlete profile entry is not in More | `e2e/thresholds.spec.ts` (*new*) |
| e2e | `tools/list` shows the new tools; a read-only token refuses `manage_thresholds` | `e2e/mcp-oauth.spec.ts` |

No critical flow changes (no set logging, timers or workout code). `pnpm verify` and the full
e2e suite run before the PR. The smoke pass is skipped: the change does not touch a critical
flow.

## 6. Order of work

1. Schema, migration, export; the three object types in the revision layer with tests.
2. Pure modules (thresholds, strength goal) with unit tests.
3. Server module and Server Actions with integration tests.
4. MCP tools, prompt, instructions, rules doc; integration tests.
5. UI: Thresholds, Athlete profile, interview; generator changes.
6. Privacy steps; e2e specs; `pnpm verify`; full e2e.

## 7. Plan corrections (in this PR)

- C3 status `brief`, then `building`.
- D21 enforcement: the refuse-and-override check for strength frequency moves to D3, which needs
  C1's phases as cycles (2.5), if the owner agrees (open question 4).
- D15 and D18 disagree on thresholds (D15: thresholds by hand for everyone; D18: thresholds
  behind the switch). This brief follows D15, as the more specific decision (open question 1).
- `docs/plans/garmin-insights-design.md`: a line under O-6 that D12 reverses it.
- BACKLOG: "Retire the triathlon generator after C4" (2.7).

## 8. Risks

- **Revision layer.** Three new types touch shared code (restore, undo, purge, the feed). The
  existing revision tests stay green, and each new type gets the same tests as memory.
- **Consent screen.** Raising `CONSENT_VERSION` sends every user through `/consent` once
  (open question 2).
- **C1 in parallel.** Only `interviewRace` reads the race. Migration numbers: the hub renumbers.
- **Wrong health facts.** No text parsing; the user states each fact.

## 9. Defaults chosen

- Max HR is a threshold kind, as the hub's scope lists it (D12 does not name it).
- Endurance level is a new field on the athlete profile, on the cycle's scale; the lifting
  `experienceLevel` stays as is.
- Pace and CSS stored as m/s; MCP takes seconds per km and per 100 m and returns both.
- Thresholds: 100 live rows per kind; injuries: 50 live rows; both soft deleted and restorable
  for 90 days.
- Stale after 8 weeks.
- The interview is required before the in-app generator (D10), but every step can be skipped.
- Memory entries move by user action only; nothing parses their text.
- The profile and injury tools are registered only with the switch on; thresholds always.
- An MCP prompt plus the same steps in the instructions.
- No training limits on profile, threshold or injury writes.
- The generator stays and changes lightly (open question 3).

## 10. Files

New: `src/db/schema/athlete-profile.ts`, `src/lib/utils/thresholds.ts`,
`src/lib/utils/strength-goal.ts`, `src/lib/athlete-profile.ts`,
`src/lib/actions/athlete-profile.ts`, `src/lib/mcp/tools/athlete-profile.ts`,
`src/app/more/thresholds/`, `src/app/more/athlete/` (with `interview/`), their components, the
tests in section 5, one `drizzle/*.sql`.
Changed: `src/db/schema/plan-revisions.ts`, `src/db/schema/index.ts`, `src/lib/plan-revisions.ts`,
`src/lib/utils/plan-revisions.ts`, `src/lib/utils/triathlon-plan.ts`,
`src/lib/actions/triathlon-plan.ts`, the triathlon plan page and form,
`src/lib/mcp/tools/coach-memory.ts`, `src/lib/mcp/instructions.ts`, `docs/mcp/app-rules.md`,
`src/app/api/[transport]/route.ts`, `src/components/features/MoreClient.tsx`,
`src/lib/account-data.ts`, `docs/privacy/data-inventory.md`, `src/app/privacy/page.tsx`,
`src/app/oauth/consent/page.tsx`, `src/components/features/ConsentChecks.tsx`,
`src/lib/constants/legal.ts`, `docs/research/endurance-training-reference.md` (the FTP 20-minute
rule with its source), `docs/plans/garmin-insights-design.md`, `BACKLOG.md`.

## 11. Open questions for the owner (settled, see section 12)

1. **Thresholds for lifters.** D15 says thresholds by hand ship to everyone; D18 lists thresholds
   behind the endurance switch. Recommended: everyone, as D15 says, with a "Thresholds" entry in
   More under Training. A lifter can use max HR and LTHR for heart rate zones on cardio sets.
   The rest of C3 stays behind the switch.
2. **Raise `CONSENT_VERSION` for injuries.** Recommended: yes, in this PR, with "injuries" added
   to the sign-up consent text. Every user sees the consent screen once. The alternative, waiting
   to raise it once with C5's illness log, would store injuries before users consented to that
   kind of health data.
3. **The generator.** Recommended: keep it and change it lightly (interview first, prefill,
   strength by goal; 2.7), and retire it after C4. The alternative is to retire it now and leave
   plan building to the assistant.
4. **Strength frequency override (D21).** Recommended: in C3, the default rule, its read over
   MCP, the instructions and the generator; the assistant's reason for a different count is
   stored in the revision as on every write. The refuse-and-override check moves to D3, after C1
   stores phases as cycles. The alternative is a check now against the cycle's current phase,
   which would misfire because one template serves every phase.

## 12. Owner decisions (2026-11-12)

The owner took every recommendation, and the defaults in section 9 too.

1. **Thresholds for everyone**, with a "Thresholds" entry in More under Training. The rest of C3
   stays behind the endurance switch. This settles the D15/D18 conflict for thresholds: D15 wins
   for thresholds entered by hand; D18 still gates the athlete profile, injuries, the strength
   goal, the interview and every later endurance view.
2. **`CONSENT_VERSION` is raised in this PR**, with "injuries" in the sign-up health consent text.
3. **The generator stays and changes lightly** (interview first, prefill, strength by goal). A
   BACKLOG entry retires it after C4.
4. **The D21 refuse-and-override check moves to D3.** C3 ships the default rule, its MCP read,
   the instructions and the generator's use of it. The plan text says so.

**Contact with C1** (hub, 2026-11-12): C1 moves the race to the season and adds one race reader in
`src/lib/seasons.ts` (the season's A race, or the cycle's own race for a cycle with no season).
`interviewRace(userId)` stays C3's only contact point and reads the active cycle's race fields
for now. Whichever PR merges second wires it to C1's reader. Both PRs bump `LEGAL_VERSION` and add
a migration; the hub settles the numbers at merge.

## 13. Where the build differs from the brief

- **The FTP rule is not added to the research doc.** T1 says the research changes only by a new
  research pass. The code labels FTP = 0.95 x 20-minute power as coach convention and the app's
  own Garmin rule (`FTP_FACTOR`), in the protocol text the user and the assistant see.
- **Garmin suggestions** come from the week of the latest Garmin activity, not today, so a gap in
  syncing still gives the last estimate. Threshold heart rate falls back to the watch's LTHR when
  no estimate exists for the sport.
- **Undoing the interview's change set** also undoes the profile's creation when the interview
  made it. The profile row is then soft deleted and reads as "no profile"; the next write brings
  the same row back, empty, so the one-profile-per-user index holds.
- **The interview's change set** is made in the browser when the interview opens
  (`interview:<uuid>`); every interview Server Action takes it, and the server accepts only that
  shape.
- **"Keep in memory"** writes nothing. Only "Moved" writes (the entry goes inactive).
- **Next sits at the end of each step**, not in a pinned bottom bar: each step's own form owns
  its save, and the steps are short.
- **`missingSteps`** leaves out injuries: none is an answer, so there is no unanswered state.
- **`manage_athlete_profile`** needs no `expectedVersion` for the first write (no profile yet),
  and refuses without one after that.
- **No component tests.** The screens are covered by `e2e/athlete-interview.spec.ts` and
  `e2e/thresholds.spec.ts`; the logic they use is in the pure modules with unit tests.
