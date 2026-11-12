# Triathlon and AI coach audit

<!-- doc-claims: skip — a point-in-time audit (2026-11-12); its file references describe the code as measured, not as it is now. -->

What LogEveryLift has and misses for two kinds of user: a normal lifter, and a triathlete who
trains for a half or full Ironman with an AI coach connected over MCP. The research behind the
"needs" column is a separate reference on endurance training (periodization, zones, load,
recovery, strength, nutrition, workout data models, a half-distance addendum). It is not in the
repo yet.

Status words: **has** (works), **partial** (some of it works), **missing**, **out of scope**.

This audit is the input for build briefs in `docs/plans/`. The owner's answers are in
[Decisions](#decisions-owner-2026-11-12) at the end. They win over any row above that says
otherwise. A brief author asks the owner only about decisions marked "open".

## Design principles for the build

These come from the owner and apply to every brief that follows from this audit.

1. **Change the app, do not work around it.** Where the current model is in the way (one
   session per day, flat segment rows, the race on the cycle), the brief changes the model.
   Endurance and triathlon must feel native to LogEveryLift, not bolted on.
2. **Layers of complexity.** Normal users keep the simple app. More complex parts are add-ons
   the user switches on: endurance, triathlon, structured workouts, the AI coach. Nothing from
   an add-on shows until it is on.
3. **The AI can do everything the UI can.** Over MCP, an assistant can create and adapt
   seasons, cycles, programs and workouts end to end. Every AI change is tracked: what changed,
   the reason, when, and a way to undo it.

## Where the app breaks the principles today

- **Principle 2.** The "Triathlon plan" entry
  (`src/components/features/CyclesListClient.tsx:394-400`) and the race field on the cycle edit
  form (`src/components/features/EditCycleForm.tsx:120-132`) show to every user.
- **Principle 2, Garmin.** Garmin features are admin-only (`src/lib/garmin/access.ts:15-17`),
  because the Garmin Personal API terms do not allow a shared key (see the Garmin entry in
  `BACKLOG.md`). So every triathlon feature for normal users must also work without Garmin,
  from sessions logged in the app. Each row below says when it depends on Garmin.
- **Principle 3.** MCP covers programs, cycles, profile and weight, and reads history. It cannot
  log or edit a workout, search or create exercises, or change settings (BACKLOG entry "MCP tool
  coverage is partial"). An AI write leaves only a log line (`audit` in
  `src/lib/mcp/result.ts:46-48`), so there is no change record and no undo.

## Bugs found

1. **MCP set editor drops fields without an error.** The `edit_program_exercise` description
   tells the model to set `repRangeMin`, `repRangeMax` and `targetRir`
   (`src/lib/mcp/tools/programs.ts:229`), but `setShape` does not accept them
   (`src/lib/mcp/tools/programs.ts:64-73`). Zod strips the keys, so the change is lost and the
   model is told it worked. `targetHeartRateZone`, `sessionRole` and `startDelaySeconds` are
   also missing. The peak anchors cannot be set directly; a set replace re-derives them from the
   old rows by set number (`src/lib/mcp/tools/programs.ts:445-474`).
2. **MCP update does not check the exercise.** `add` checks that the exercise is a system
   exercise or the user's own (`src/lib/mcp/tools/programs.ts:297-308`). `update` sets any
   `exerciseId` with no check (`src/lib/mcp/tools/programs.ts:387-391`), so a slot can point
   to another user's custom exercise.
3. **Doc drift in the triathlon generator.** The header of `src/lib/utils/triathlon-plan.ts`
   says three strength sessions (line 12), but the code builds two (Workout A on Monday,
   Workout B on Thursday). The comment at line 164 says the block is "RIR-capped", but no set
   gets a `targetRir`, and the comment at lines 40-44 says there is no RIR cap.
4. **Sessions left open get a false duration.** Real data has "completed" sessions with no sets
   and a duration of 11-24 hours. The cause: `closeStaleOpenSessions`
   (`src/lib/actions/workout-sessions.ts:193-207`) marks any session open for more than 10
   hours as completed with `endTime` set to now, not to the last logged set, and it keeps
   sessions with no sets. These sessions distort duration, load and adherence numbers, which
   the periodization sync reads.

## What exists today

Strength planning is mature: programs, cycles (`day_of_week` or `rotation`), the progression
engine with RIR and readiness hold, and AI Setup for strength plans.

For triathlon the app already has:
- A rule-based triathlon plan generator (`src/lib/actions/triathlon-plan.ts`): weeks, up to
  two rest days, goal (`build`/`maintain`) and level. It builds swim, bike, run and two
  strength sessions, one session per day.
- A periodization curve (`src/lib/utils/periodization.ts`): ramp, deload every 3rd or 4th week,
  peak, taper. A weekly sync (`src/lib/periodization-sync.ts`) rewrites the distance and
  duration of every set with a peak anchor, swaps zone and rest on `work` sets
  (lines 230-235), and nudges volume from adherence, readiness and RPE.
- Endurance sets with duration, distance, incline, HR zone 1-5 and a "work" role, and a run
  logger with RPE.
- Race date and distance (`full`/`half`) on the cycle.
- Missed-workout prompts with "make up" (`workout_sessions.intended_date`), which a user can
  switch off (`users.missed_workouts_enabled`).
- An offline write queue for logged sets (`src/lib/utils/pending-queue.ts`).
- A GDPR export and account delete that cover every user table (`src/lib/account-data.ts`,
  guarded by a coverage test).
- Garmin (admin-only): per-activity load (power, HR/TRIMP, session RPE for strength),
  fitness/fatigue/form, ramp and monotony, FTP/CP/run critical speed/LTHR estimates with
  history, time in zone and a weekly polarized/pyramidal label, a readiness score against
  personal baselines, aerobic decoupling, best efforts, a race page with a key-session
  checklist, form projection, bike and run pacing, brick detection, fuel logs and sweat rate,
  and planned against real hours per sport.
- An MCP server with OAuth and 22 tools (4 of them Garmin, for admins only): read profile,
  programs, cycles, workouts, records, volume and Garmin; write profile, weight, programs,
  program exercises and sets, cycles and cycle slots.

## What is missing

Priority is for the triathlete and AI coach use case. "Lifter risk" says whether the change can
hurt normal lifters if it is done carelessly. "Garmin" in the notes means the row needs Garmin
data and so works for admins only, unless the row says how it works without it.

### 1. Season level and plan structure

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Season above cycles (goal, A/B/C races, later goal) | missing | The cycle is the top level. A season holds more than one race, for example a B half 8-12 weeks before an A full. | high | low (new table) |
| Phases as stored, ordered blocks (base, build, peak, taper, recovery) | partial | Phases are computed from the week number, never stored. | high | low |
| Taper placed from the race date, length by distance | missing | Taper is the last ~10% of weeks, 1-3 weeks (`src/lib/utils/periodization.ts:81-92`), not tied to `raceDate`. Research: half 7-14 days, full 14-21 days, volume down 40-60%, intensity and session count kept. | high | low |
| Chained blocks (base → build → peak) | missing | `endAction` only changes a banner link. | medium | low |
| Recovery-week pattern choice (2:1, 3:1) | partial | Fixed by level (`deloadCadenceForLevel`). | medium | low |
| More than one session per day | missing | `uniq_cycle_day` on slots (`src/db/schema/training-cycles.ts:107`). The draft brief "Quick workout and session-only swap" (`docs/plans/quick-workout-and-swap.md`) also changes the session model; the two must agree. | high | **high**: missed-workout detection, the rotation walker (BACKLOG "Two workouts in one day") and the auto-session index assume one session per day |
| Session priority (key, support, optional) | missing | Research: 2-3 protected key sessions a week; cut support sessions first when life gets busy. Needed by the guardrails and by readiness swaps. | high | none |
| Weekly hours budget and available days as input | missing | The generator takes rest days only (`src/lib/actions/triathlon-plan.ts:24-29`). | high | low |
| Entry check (minimum base before a plan) | missing | Research: about 5-7 h/week and continuous 1,000-1,500 m swim, 1.5-2 h ride, 45-60 min run before a 16-20 week half plan. A warning, not a block. | low | none |
| Race distances other than half/full | missing | No Olympic or sprint. | low | low |

### 2. Athlete profile

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Add-on switches (endurance, triathlon, structured workouts, AI coach) | missing | Goals have `endurance` but no triathlon; onboarding is lifter-only. Every later row is gated by these switches (principle 2). | high | low if it only gates UI |
| Thresholds entered by hand, field test results (FTP, LTHR, threshold pace, CSS) | missing | Only Garmin estimates, so normal users have none. Decision O-6 in `docs/plans/garmin-insights-design.md` said "no manual thresholds for now", for the Garmin page. | high | none |
| Threshold history per test, with source (test or estimate) | partial | Weekly estimates from Garmin only. | medium | none |
| Injuries and limits | missing | Only per-plan "avoid" areas. Health data: see section 9. | medium | none |
| One experience scale | partial | Profile uses beginner/intermediate/advanced, cycle uses novice/intermediate/advanced. | low | low |

### 3. Endurance workouts

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Structured steps (warmup/interval/recovery/cooldown/rest, repeat blocks, end by time, distance or lap) | partial | Each segment is a flat `program_sets` row. Research model: one level of repeat nesting; flatten on export. | high | low (endurance only) |
| Targets relative to FTP, LTHR, threshold pace, CSS, or a zone | missing | HR zone 1-5 only. Store relative to an anchor; resolve to watts, bpm or pace only for display and export. | high | none |
| Power, pace and cadence targets | missing | No columns. Research: store pace as speed (m/s), because pace ranges invert. | high | none |
| Swim: pool length, CSS, stroke, open water | missing | Two swim exercises ("Swim" and "Swimming"). BACKLOG "Sport-specific endurance fields" covers the logged-set side. | medium | low |
| Brick as one unit | partial | Two exercises in one program; detected afterwards in Garmin data. | low | none |
| Planned vs completed matching for endurance, with compliance bands | missing | Only strength sessions are matched to Garmin activities. `autoComplete` marks a day done without a check. Research: green within ±20% of plan, yellow 50-79% or 121-150%, red missed. Without Garmin, match the session logged in the app. | high | low |
| Export to the watch and other apps (FIT, ZWO, intervals.icu text, calendar) | missing | The app reads FIT but does not write it. Push to Garmin needs the business Training API. Research: intervals.icu already has Garmin push rights and is the cheapest bridge. | medium | none |

### 3b. Endurance workouts inside the app

The watch runs outdoor sessions, but the user also needs to see the plan in LogEveryLift and to
follow indoor sessions (trainer, treadmill, pool) in the app. Today an endurance set is a
segment row that is logged after the fact in `src/components/features/LogRunModal.tsx`
(distance, duration, RPE, incline, HR zone). The exercise timer runs one timed set at a time.

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Today and week view of planned swim/bike/run with steps, total time and distance per sport | partial | Program detail and the cycle calendar list segments; no step view, no week totals per sport. | high | none |
| Targets shown as the user's own numbers (watts, pace, bpm, swim pace per 100 m) | missing | Needs the threshold anchors from section 2. | high | none |
| Guided workout player for indoor sessions: step timer, current and next target, a cue at each step change, pause/skip/extend | missing | The timer for timed sets is the closest part to reuse; it is a critical flow. iOS Safari ignores the Vibration API (`src/lib/utils/haptics.ts:4-5`), so on iPhone the cue is sound and screen only. | high | low if it reuses the timer with care |
| Player keeps the screen awake and survives the lock screen and app switch | missing | No Wake Lock use in `src/`. BACKLOG "iOS backgrounding" lists gaps that apply to a 60-minute player more than to a rest timer. | high | low |
| Player works offline | partial | Logged sets queue offline; the planned workout must also be on the device before the session starts. | medium | low |
| Pool view: big text, sets such as 10×100 with send-off times | missing | | medium | none |
| Outdoor session: "do this on your watch", with the file to load | missing | Depends on export (section 3). | medium | none |
| Log the result per step (actual vs planned, RPE, notes), or link the Garmin activity when it arrives | partial | Per-segment logging exists; no per-step compare, no link to Garmin laps. | high | none |
| Reusable endurance workout library (for example "3×10 min sweet spot") | missing | | medium | none |
| Smart trainer control (ERG over Bluetooth) | out of scope | iOS Safari has no Web Bluetooth. Use a ZWO or FIT export to Zwift or the trainer app instead. | n/a | n/a |

### 4. Load, readiness and safety

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Load per session without Garmin (session RPE × minutes, all sports) | partial | Session RPE exists in Garmin load; `weekly_volume` counts kg × reps only. The base for every load rule for normal users. | high | none |
| Swim load and CSS | missing | Swims use wrist HR or Garmin's TSS. | medium | none |
| Run pace load | missing | Runs use HR only. | medium | none |
| Run spike guard (one run vs longest run in 30 days, cap 1.10×) | missing | The best-supported injury rule in the research. Works from logged runs, no Garmin needed. | high | none |
| Intensity split from power and pace | partial | HR only, Garmin only. | low | none |
| Readiness changes the next session | partial | Advice text and a cycle-wide Apply (Garmin); no session swap. Research: swap or shorten the next session, keep the plan; two agreeing signals for any downgrade. | medium | low |
| Missed sessions are skipped, not stacked | partial | The app offers "make up" for any missed day. Research: for endurance, skip and continue; move only a missed key session, and only to an easy day with no hard session within 24 h. | medium | **medium**: the make-up flow is used by lifters; change it for endurance only |
| Illness, injury and travel log (IOC severity grades) | missing | Models cannot tell a sick week from a planned rest week. Health data: see section 9. | medium | none |

### 5. Strength inside a triathlon plan

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Strength frequency by phase (2×/week in base, 1-2× in build, 1× in peak) | missing | The cycle spec retired phase re-prescription of strength reps and rest (`docs/specs/cycle-periodization.md`, "Strength periodization: considered, not implemented"), and decision D-6 gives `target_reps` to the progression engine alone. Frequency by phase was never built. | medium | **medium**: must not touch strength-only cycles |
| Heavy legs vs key run/ride placement (no heavy lower body within 48 h of a key session) | partial | A generic insight after heavy strength days (Garmin). | medium | none |
| Strength taper (last heavy session 7-10 days before the race) | missing | | low | none |
| Heavy (≥80% 1RM, 3-6 reps) main lifts and plyometrics in the templates | partial | The generator runs fixed 8-12 rep ranges by choice, "to spare the CNS" (cycle spec). The research says light high-rep work does not improve economy. Decided by the intake interview (D10). | low | none |

### 6. Nutrition and race day

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Carbs-per-hour target and gut-training progress (GI score after fueled sessions) | missing | Fuel logs (Garmin page) store totals only. | medium | none |
| Sodium and product details in fuel logs | missing | | low | none |
| Fuel logs and sweat rate without Garmin | missing | Both sit in the Garmin section today. | low | none |
| Race-day plan (timeline, transitions, fuel schedule, per-leg intensity) | missing | Pacing covers bike and run only (Garmin). | medium | none |
| Daily food intake by training load | out of scope | The app is not a food tracker. The AI coach can give the advice in text. | n/a | n/a |

### 7. MCP and AI coach

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Set race date, distance, goal, level, future start date over MCP | missing | Columns exist; the MCP schema leaves them out. `start` always uses today. | high | none |
| UI parity: log and edit sessions, create and search exercises, settings, seasons, workouts | missing | Principle 3. BACKLOG "MCP tool coverage is partial". Each new UI feature in these briefs ships with its MCP tool. | high | none |
| Call the triathlon generator over MCP | missing | Lower value once the AI can build a plan from parts. | low | none |
| Server instructions and knowledge resources | missing | `createMcpHandler` gets `{}` (`src/app/api/[transport]/route.ts:59-68`). Resources should hold the workout step syntax and the app's rules (one owner per field, guardrails). | high | none |
| Coach memory (goals, limits, decision log) | missing | No table. Each conversation starts from nothing. | high | none |
| Revisions for every plan object, with restore (decided, see D2) | missing | Every write applies at once and leaves only a log line. A set replace deletes and inserts rows, so it keeps no snapshot and the set ids change. AI and UI edits both make revisions. | high | low |
| Accept step before an AI change applies | missing | Research recommends proposals the user accepts. Decided: no accept step (D1). | n/a | n/a |
| Guardrails in code, not in the prompt | missing | Only a 9999 kg max on weight. Research list: weekly load ramp cap, 1.10× long-run cap, key sessions per week, no hard session after a flagged low-readiness day, no heavy legs within 48 h of a key run, schema check of every workout. | high | none |
| Safe writes during an open workout | missing | A set replace on a slot in an open session unlinks the logged sets, because `workout_sets.program_set_id` is `set null` (`src/db/schema/workout-sets.ts:71-73`). | high | **medium**: a lifter mid-workout loses the plan link |
| One owner per field (AI, progression engine, weekly sync) | partial | See section 8. | high | **medium** |
| Read-only or limited connections (OAuth scopes) | missing | One token can read and write everything. | medium | none |
| Integration tests for MCP write tools | missing | Only read tools have an integration test (`src/__tests__/integration/mcp-workouts.test.ts`). | high | none |
| Revoke a connected assistant in the app | missing | No screen lists OAuth consents or tokens. | medium | none |
| Consent text names workout history and Garmin reads | partial | The consent page names programs, cycles, profile and body weight only (`src/app/oauth/consent/page.tsx:41`). | low | none |

### 8. How AI edits, the progression engine and the weekly sync interact

Three writers can change the same planned set. The briefs must give each field one owner.

| Field | Owner today | What an AI edit does today | Need |
|---|---|---|---|
| `target_reps`, `weight_kg` on strength sets | progression engine (decision D-6) | Overwrites it; the engine moves it again after the next session. | The AI changes the progression settings, or makes a one-off change that is logged as such. |
| `distance_meters`, `duration_seconds` on sets with a peak anchor | weekly sync (`src/lib/periodization-sync.ts:230-235`) | A set replace re-derives the peak from the new value, so the change survives as a new peak. | Keep, and say it in the tool description, so the model knows it edits the peak, not the week. |
| `target_heart_rate_zone`, `rest_time_seconds` on `work` sets | weekly sync, by phase | Cannot be set (bug 1). After the fix, the sync overwrites it next week. | The AI changes the phase recipe, or the field leaves sync control. |
| Cycle `adaptation_pct` | weekly sync from adherence and readiness | No tool. | An AI write that changes volume goes through the same factor, so the guardrails see one number. |

### 9. Privacy and data (GDPR)

Every brief that adds a table follows `.claude/skills/privacy-compliance/SKILL.md`.

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| New tables in export and delete (seasons, phases, thresholds, workouts, coach memory, change log, illness log) | missing | Add each to `collectUserData` in `src/lib/account-data.ts`; the coverage test fails until then. `onDelete: "cascade"` on the user. | high | none |
| Illness, injury, GI and coach-memory text are health data | missing | New kinds of health data: add them to `docs/privacy/data-inventory.md` and the policy, bump `LEGAL_VERSION` and raise `CONSENT_VERSION`. | high | low (every user sees the consent screen once) |
| The MCP recipient row lists the new reads | partial | `docs/privacy/data-inventory.md:53` lists what assistants can read today and says "without free-text notes". Coach memory and logs are free text. | high | none |
| Retention for the change log | missing | It grows with every AI write. Needs a rule in the inventory. | medium | none |
| What friends see of endurance data | partial | Friends see activity when `show_activity_to_friends` is on. HR, illness and thresholds must never show to friends. | medium | low |

### 10. Platform: units, time, notifications

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Units (kg/lb, km/mi, pace per km/mile, swim per 100 m/100 yd) | missing | The app is metric only. Store metric, convert for display. | medium | **high** if storage changes; low if display only |
| User time zone for "today", week numbers and the weekly sync | missing | The sync computes today in the server's time zone (`src/lib/periodization-sync.ts:48-49`). A morning session in Norway can fall on the wrong day near midnight UTC. | medium | low |
| Week start | has | Monday-based `day_of_week` 1-7. Keep fixed. | n/a | n/a |
| Reminders and step cues outside the app | missing | In-app Notification API only. Covered by the draft brief `docs/plans/web-push-and-reminders.md`. | low | low |

### 11. Existing data and tests

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Migrate existing triathlon cycles into the new model | missing | Cycles with `goal`, `athlete_level`, `race_date` and sets with peak anchors and `session_role` must keep working, and land in a season. | high | low |
| Existing strength cycles unchanged | has | Must stay so: a lifter with no add-on on sees no change. Each brief proves it with a test. | high | **high** |
| Tests per layer (`TESTING.md`) | partial | Pure rules (guardrails, compliance, taper, step model, unit conversion) → unit tests in `src/lib/utils/`. Every new MCP tool and migration → integration test. The workout player and one-session-per-day changes → component test plus e2e spec, since they touch critical flows. | high | none |

## Suggested order

1. **Fix the four bugs** with tests. Small and independent.
2. **Add-on switches** (section 2, first row), so every later feature has a gate (D15). Move
   the triathlon entry and the race field behind it. Add the user's time zone and display
   units (D14), since every later step uses dates and numbers.
3. **MCP coach basics:** cycle race fields over MCP, exercise search, server instructions and a
   knowledge resource, coach memory, revisions with restore (D2), safe writes during an open
   workout, one owner per field, training limits that warn the AI (D3), read-only and
   read-write scopes (D5), notes and illness log readable by assistants (D6), integration tests
   for the write tools, a revoke screen. This makes the AI coach usable on the current model.
4. **Season level:** season and races (D8), stored phases, taper from the race date, chained
   blocks, session priority, several slots per day and dated sessions (D7, with care for the
   lifter flows listed above, and agreed with the quick-workout brief). Migrate existing
   triathlon cycles.
5. **Athlete profile and intake interview:** the interview (D10), available days and hours,
   thresholds by hand and field tests (D12), injuries.
6. **Structured endurance workouts:** steps, repeats, targets relative to thresholds,
   planned-vs-done matching with compliance bands, export. Then the in-app side (section 3b):
   a today and week view, targets in the user's own numbers, a guided player for indoor
   sessions, a pool view, per-step results and a workout library.
7. **Analytics and safety without Garmin:** session-RPE load, run spike guard, swim and
   run-pace load, illness log, confirm-then-skip for missed endurance sessions (D11), readiness swaps.
8. **Strength by phase (D10), nutrition targets, race-day plan.**

Each step gets its own brief in `docs/plans/` before code. Each brief also covers the MCP tools
for what it adds (principle 3), the privacy checklist (section 9) and the test layers
(section 11).

## Decisions (owner, 2026-11-12)

The owner answered the open questions from the review pass. Briefs build to these. Where a
decision says "open", the brief must ask the owner before code.

### AI changes and control

**D1. AI changes apply at once.** No accept step. The safety net is revisions (D2). The MCP
tool result tells the model what changed, so it can report it to the user.

**D2. Revisions with restore.** Every plan object (season, cycle, program with its exercises
and sets, endurance workout) keeps a revision history.
- Every change makes a new revision, from the AI or from the UI. The revision records who made
  it (user or assistant), when, and the reason (required for AI changes).
- The user can see the revisions of an object and restore any earlier one. A restore makes a new
  revision, so a restore can itself be undone. Nothing is deleted by a restore.
- A restore works on the whole object, not on one field. It must not touch logged workout data
  (`workout_sets`, `workout_sessions`); logged sets keep their link to the plan.
- A deleted object can be restored from its last revision.
- The AI can list revisions and restore over MCP (principle 3).
- Revisions are user data: they go into export and delete, and the data inventory gets a
  retention rule (section 9).

**D3. Training limits warn the AI, and the AI decides.** The limits (weekly load ramp, the
1.10× long-run cap, hard sessions per week, no hard session after a low-readiness day, no
heavy legs within 48 h of a key session) are checked in code. When an AI write breaks one:
1. The write is not applied. The tool returns each broken limit with its reason, the numbers
   (for example "run 1:45 h is 1.31× your longest run in 30 days, 1:20 h; limit 1.10×") and
   the evidence level.
2. The AI may send the write again with an explicit override and a reason, if it judges the
   change still fits (for example, the athlete confirmed a longer run done outside the app).
3. The applied revision stores the override, the limits it passed and the reason, so the user
   sees it.
The schema check of a workout (valid steps, targets in range) is not a training limit. It is
always enforced and cannot be overridden.

**D4. No limit checks on the user's own UI edits.** Only AI writes are checked.

### MCP access

**D5. Two scopes: read-only and read-write.** The user picks one on the consent page.

**D6. Assistants can read free-text notes and the illness and injury log.** No separate
opt-in: the MCP consent page must say it plainly, and the data inventory and privacy policy
must list it (MCP is a recipient of health data). Notes stay hidden from friends.

### Model and structure

**D7. Both: a weekly template with several slots per day, and dated sessions.** The cycle stays
a weekly template, and a day can hold more than one slot (for example strength AM, run PM).
The template creates dated planned sessions. Each dated session can be moved, skipped or
changed alone, and compliance is tracked per dated session. The lifter flows that assume one
session per day (missed-workout detection, the rotation walker, the auto-session index) must be
changed with tests, so a lifter with one slot per day sees no change.

**D8. The race lives on the season, and a cycle without a season can have its own race.** A
season holds a list of races with A/B/C priority. A cycle inside a season shows the season's
races and stores none of its own, so each fact has one home. A cycle with no season (a simple
user) keeps its own race fields. Existing triathlon cycles migrate into a season.

**D9. Workout steps are a JSON tree, checked with Zod.** One schema is used by the app, MCP
and export.

### Training rules

**D10. Strength in a triathlon plan comes from an intake interview, not a fixed default.**
Making a triathlon plan (in the app or by the AI) starts with an interview. It asks the
strength goal (keep muscle, get stronger, minimal), along with race, available days and hours,
experience, thresholds and injuries. The strength part follows the answer:
- Keep muscle: moderate rep ranges with the main lifts kept heavy enough to keep strength.
  Research: concurrent training cost no muscle growth (Schumann 2022).
- Get stronger / performance: heavy main leg lifts at 3-6 reps plus plyometrics (research
  favourite for running economy).
- Minimal: one short session a week to keep what is there.
Frequency drops by phase in all three (2× in base, 1× in race-specific phases). The answers
are stored in coach memory, and the AI can ask the same interview over MCP.

**D11. Missed endurance sessions: confirm first, then skip or move.**
1. When a planned session's day passes, look for a matching Garmin activity (sport, day, time
   or distance). If one matches, mark the session done and link the activity.
2. If none matches, ask the user: "Did you do it?" The user may only have forgotten to log
   it. They can confirm it as done (with time, distance and RPE) or say it was missed.
3. A confirmed miss is skipped for easy sessions. A missed key session (long ride, long run,
   race-specific session) moves to a free day in the same week if one exists. Never stack two
   hard days.
The AI sees the same state over MCP, and it can read Garmin activities to check.

**D12. Everyone can enter thresholds by hand and log field tests.** FTP, threshold HR (bike and
run), threshold run pace and swim CSS. Garmin estimates show next to the value as a
suggestion. This reverses decision O-6 in `docs/plans/garmin-insights-design.md`.

### Platform and scope

**D13. Getting workouts to the watch: open.** The owner will come back to it. Briefs must not
depend on a delivery route. FIT export, ZWO and intervals.icu stay on the list as options.

**D14. Time zone and units both now.** The user's time zone decides "today", week numbers and
the weekly sync. Units (kg/lb, km/mi, pace per km or mile, swim per 100 m or 100 yd) are a
display setting; storage stays metric.

**D15. Owner only for now, built for everyone.** The endurance and triathlon add-on is on for
the owner (admin) at first. It must not depend on the admin role in its data model or logic:
gate it with a per-user add-on switch that only an admin can turn on for now. Each feature
should work without Garmin where it can (logged sessions, RPE load), so it can open to other
users later by changing who may turn the switch on. Features that are useful to every user
(revisions, time zone, units, thresholds by hand, MCP scopes, exercise search) ship to everyone.
