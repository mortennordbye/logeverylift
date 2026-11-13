# Training limits part 2, strength by phase and readiness swaps

Packages D2 (training limits engine, part 2), D3 (strength by phase and heavy-legs placement)
and D4 (readiness-based session suggestions) of [`triathlon-coach-plan.md`](triathlon-coach-plan.md),
in one branch and one PR (`feat/limits-strength-readiness-d2-d4`). Inputs: the audit
(`docs/triathlon-coach-audit.md`, sections 4 and 5, decisions D3, D4, D10, D18, D21, T2, T4), the
research (`docs/research/endurance-training-reference.md`: "CTL ramp limits are conventions, and
the ACWR is not an injury predictor", "Readiness signals change the next session, not the plan",
"Placement matters more than the program", "Plans become data"), `CLAUDE.md`, `TESTING.md`, and
the merged briefs [`ai-coach.md`](ai-coach.md) (D2 part 1), [`seasons.md`](seasons.md),
[`athlete-profile.md`](athlete-profile.md), [`sessions.md`](sessions.md) and
[`workouts-and-compliance.md`](workouts-and-compliance.md). Package D1 (load without Garmin) is
built in parallel; its brief is `docs/plans/endurance-app.md` on its branch. Section 13 lists what
this PR needs from D1's final code.

Status: building, 2026-11-13. The hub decided the open questions on 2026-11-13 (section 17, "Decisions"). The findings describe `main` at d03b371 (after PR #231); every
`file:line` in them was opened then. Open questions are in section 17; the owner is away and the
hub decides them from the recommendations.

## 0. Goal

After this PR, for a user with the endurance switch on:

1. Three new training limits run in the engine that D2 part 1 built, with the same refuse,
   override and store flow (D3): the **weekly load ramp**, **no hard session after a
   low-readiness day**, and **no heavy legs within 48 h before a key session**.
2. A fourth limit, **strength sessions per week by phase** (D3, D21), refuses an assistant write
   that moves a phase's strength count away from the default for the athlete's strength goal,
   unless the assistant overrides it with a reason.
3. The limits also run as **warnings, never blocks** (T4) on the weekly sync, on an applied
   Garmin volume suggestion, on the chained start of a season's next phase, and on a change-set
   undo over MCP. `manage_season` `resume` over MCP gets the full check.
4. The long-run cap also works from runs logged in the app, so a user without Garmin is checked
   too (plan, D2 part 2).
5. The calendar and the session detail show a strength session with heavy leg work 1-2 days
   before a key bike or run session, from the same rule (D3, "no second rule").
6. When the athlete wakes with HRV low for two days and resting HR up (two agreeing signals),
   the home screen suggests making today's hard session easy. The user taps; the app writes the
   change as a revision. The assistant sees the same suggestion and can apply it (D4).

Never changes:
- A lifter (switch off) sees nothing new and no new check runs. The only new read on a lifter's
  path is the switch itself, once per weekly sync.
- User edits in the app are never checked (D4).
- Nothing changes a plan by itself. The readiness swap waits for a tap or an assistant write.
- No logged data changes. No migration.

## 1. Findings in the code

### 1.1 The limits engine today (D2 part 1)

- Rule ids are a const list of two: `long_run_cap` and `hard_sessions_per_week`
  (`src/lib/utils/training-limits.ts:12`). The stored check has `checked`, `notChecked`,
  `passed`, `overridden`, `overrideReason` and `warnings` (`src/lib/utils/training-limits.ts:210-219`).
  The user-facing line already prints warnings as "Breaks a training limit"
  (`limitOverrideLine`, `src/lib/utils/training-limits.ts:222-227`).
- A session is hard when an endurance set is a `work` rep or targets zone 4-5
  (`isHardSession`, `src/lib/utils/training-limits.ts:155-159`). A week is a list of
  `{ dayOfWeek, hard }` (`src/lib/utils/training-limits.ts:162`). The rise rule: a limit breaks
  only when the count after the write is over the limit and over the count before
  (`hardSessionsPerWeek`, `src/lib/utils/training-limits.ts:166-181`).
- `limitContext` reads the switch, then Garmin runs for 30 days; without Garmin the long-run cap
  is "not checked" (`src/lib/training-limits.ts:86-126`).
- `planFacts` reads the facts before and after a write: program runs, the template week of a
  cycle, every calendar week of a dated cycle to the block end, and weeks a session change
  touches (`src/lib/training-limits.ts:378-433`). Calendar weeks read only status `planned`
  (`src/lib/training-limits.ts:319`).
- `evaluateLimits` runs the rules and splits by override (`src/lib/training-limits.ts:442-507`).
  `withLimits` runs a write inside `planWrite` and throws `LimitRefusedError` on a block, so the
  transaction rolls back (`src/lib/training-limits.ts:522-542`).
- Callers: program tools (`src/lib/mcp/tools/programs.ts:397`, `:541`), cycle tools including
  `start` and `set_volume` (`src/lib/mcp/tools/cycles.ts:296`, `:342`, `:373`, `:502`), dated
  sessions (`src/lib/planned-sessions.ts:894`, `src/lib/mcp/tools/planned-sessions.ts:145`),
  library workouts (`src/lib/workouts.ts:161`) and `confirm_planned_session`
  (`src/lib/mcp/tools/workouts-compliance.ts:146`).

### 1.2 T4 gaps (the two BACKLOG entries this PR closes)

- `restore_revision` with one `revisionId` runs the limits as warnings and stores them on the
  restore's revisions (`src/lib/mcp/revisions.ts:200-228`). With a `changeSetId` it runs none
  (`src/lib/mcp/revisions.ts:230-234`). `restoreScope` covers programs, cycles and dated
  sessions (`src/lib/mcp/revisions.ts:108-128`). `restoreChangeSet` already sorts the touched
  objects (`src/lib/plan-revisions.ts:1793-1815`).
- The weekly sync writes as `sync` (or `apply` for a Garmin suggestion) through `planWrite` and
  runs no limit (`syncPeriodizedTargets`, `src/lib/periodization-sync.ts:245-294`).
  `syncDueCycle` first starts a due scheduled cycle (`src/lib/periodization-sync.ts:46-58`).
- `chainSeason` schedules the next phase; the start itself runs later as `sync`
  (`src/lib/plan-revisions.ts:832-871`). `resumeSeason` starts or schedules the next phase with
  no check (`src/lib/seasons.ts:705-737`).

### 1.3 Load (for the ramp)

- `computePmc`: CTL 42 days, ATL 7 days, per sport (swim, bike, run, strength, other) and in
  total; seeded from the first 28 days; calibrating for 42 days; `ramp` is total CTL now minus 7
  days ago (`src/lib/garmin/analytics/pmc.ts:46-81`). `rampBand`: over 5 fast, over 8 warning
  (`src/lib/garmin/analytics/pmc.ts:86-88`). The Garmin insight warns over 8
  (`src/lib/garmin/analytics/insights.ts:13`, `:109`).
- The research: "Planned 7-day CTL ramp over 8: Reject or cut the week" and "CTL 45 or below and
  ramp over 6: Cut to 3-5/week", both coach or vendor convention; the acute:chronic ratio does
  not predict injury (Study, Impellizzeri). So the rule uses the CTL ramp, not ACWR. The
  existing Garmin volume suggestion uses an uncoupled ACWR (`wearableSignals`,
  `src/lib/periodization-sync.ts:363-397`); this PR does not change that.
- Garmin daily rows store the PMC per track, HRV state and the resting HR flag in
  `garmin_daily_metrics.metrics` (read at `src/lib/periodization-sync.ts:369-371`).
- Garmin is on only for admins with the key (`garminAllowedFor`, `src/lib/garmin/access.ts:20`).

### 1.4 Readiness (Garmin only today)

- `hrvSeries`: 7-day mean of ln(rMSSD) with 4 of 7 nights; band = 60-day mean ± 0.75 SD on ln
  after 30 nights (Garmin's band before that); state `fatigued` (below band) or `strained` (below
  band with CV rising), `calibrating` without a band (`src/lib/garmin/analytics/recovery.ts:33-67`).
  The app's band is stricter than the research's 0.5 SD, so it flags less often.
- `restingHrSeries`: 7-day mean against a 60-day baseline (14 days needed); flag at +5 bpm or
  +2 SD (at least 2 bpm) (`src/lib/garmin/analytics/recovery.ts:72-86`). The research row: "about
  5-7 bpm above the 30-day baseline: easy day" (Inference).
- The readiness score already caps at 45 when HRV is low and resting HR is flagged
  (`src/lib/garmin/analytics/readiness.ts:90`). The insight "rhr_up" needs the flag two days in a
  row (`src/lib/garmin/analytics/insights.ts:96-106`). Both are display only.
- The app's own "readiness" (1-5 before a workout) is asked at session start
  (`src/db/schema/workout-sessions.ts:62`): too late and too coarse for a morning flag.
- The cycle-wide Garmin suggestion changes this week's volume percent, writer `apply`
  (`wearableSuggestion`, `applyWearableSuggestion`, `src/lib/periodization-sync.ts:406-447`;
  Server Action at `src/lib/actions/training-cycles.ts:948`). No session swap exists.

### 1.5 Key sessions, heavy legs and strength

- Priority: stored `key`, `support`, `optional`, or derived: key when hard, or when it is the
  longest bike or run of its week at 90 minutes or more; strength reads `support`
  (`effectivePriorities`, `src/lib/utils/session-compliance.ts:436-472`).
- `suggestMoveDay` already keeps a moved key session off days next to a key or hard day
  (`src/lib/utils/session-compliance.ts:257-284`).
- Exercises carry `bodyArea`, `muscleGroup`, `movementPattern` and `exerciseType`
  (`src/db/schema/exercises.ts:102-110`; enums at `:30`, `:66`, `:85`). The seed puts squats,
  lunges, step-ups and leg press under `squat`, and RDL, hip thrust and good morning under
  `hinge`, all `lower_body` (`scripts/seed.ts:99-128`); the deadlift is `full_body`, `hinge`
  (`scripts/seed.ts:37`). Leg curls and leg extensions are `pull`, calf raises `push`.
- Program sets hold `targetReps`, `repRangeMax`, `setType` (`working` or `warmup`) and
  `sessionRole` (`src/db/schema/programs.ts:159`, `:167`, `:190`, `:198`).
- The only heavy-legs signal today is a Garmin session insight after a strength load of 40 or
  more the day before (`src/lib/garmin/analytics/session-insights.ts:28`, `:135-142`).
- `strengthDefault` gives sessions per week by goal and phase: 2 in general, base and maintain
  (1 for minimal), 1 in build and peak, 1 light in taper, 0 in transition
  (`src/lib/utils/strength-goal.ts:63-69`). Its header says the refuse-and-override check belongs
  to D3 (`src/lib/utils/strength-goal.ts:5-8`). `activeCyclePhase` reads a season phase's
  `phaseType` or the block curve (`src/lib/athlete-profile.ts:160-175`); phase types are
  `src/db/schema/training-cycles.ts:29`.

### 1.6 Dated sessions and the swap path

- `applySessionOp` `set_workout` gives a session its own workout and clears its program; a
  restore brings the program back (`src/lib/planned-sessions.ts:998-1005`). It refuses past days.
- The MCP tool's operations and which of them run limits: `src/lib/mcp/tools/planned-sessions.ts:96`,
  `:146`.
- Home: today's sessions (`TodaySessionsList`, `src/components/features/TodaySessionsList.tsx:10`)
  and the endurance-only "Did you do these?" card (`src/app/page.tsx:274`).

## 2. Design overview

- One engine. The four new rules are pure functions in `src/lib/utils/training-limits.ts`, next
  to the two from part 1, each with its research line and evidence label. The server module
  reads more facts; the override flow, the stored check and the user line do not change shape.
- Every rule keeps the rise rule: it breaks only when the write makes the measured thing worse
  than before. A plan already over a limit never blocks an unrelated edit.
- Each rule has its own "not checked" reason, so the assistant always knows what ran.
- A warn mode on the same engine serves T4: the check runs, nothing is refused, and the broken
  rules go to `warnings`.
- D3's UI and D4's suggestion call the same pure functions as the limits.

## 3. The rules (D2)

New rule ids, added to the const list: `weekly_load_ramp`, `hard_after_low_readiness`,
`heavy_legs_before_key`, `strength_per_week` (section 4). The `overrideLimits` enum on every
checked tool grows with them.

### 3.1 `weekly_load_ramp`

**Research.** "CTL ramp limits are conventions, and the ACWR is not an injury predictor": planned
7-day CTL ramp over 8, reject or cut the week (Coach convention); CTL 45 or below and ramp over 6,
cut to 3-5 a week (Vendor/coach convention). Evidence label stored: "Coach convention (Friel,
TrainingPeaks); the planned load is an estimate (Inference)".

**Inputs.**
- The fitness series from D1's one reader: Garmin when the user has Garmin daily rows, else the
  app series (D1's source rule; never both added). Only the endurance tracks count:
  CTL(endurance) = CTL(swim) + CTL(bike) + CTL(run). The PMC is linear in load, so this is the
  CTL of endurance load alone. Strength is left out of the rule because a planned strength
  session has no load estimate (open question 1).
- Actual daily endurance load up to yesterday from the series, and today's done sessions.
- Planned daily endurance load from today on: each planned (not done, not skipped, not missed)
  session's estimate (3.1.1).

**Formula.** Start from yesterday's CTL. For each day d from today to the last day in scope:
CTL(d) = CTL(d-1) + (load(d) - CTL(d-1)) / 42 (the existing model). For each calendar week
(Monday to Sunday) in scope: ramp = CTL(Sunday) - CTL(the Sunday before). Limit = 6 when CTL at
the start of the week is 45 or less, else 8.

**Broken** when, for any week in scope, ramp after the write is over that week's limit and over
the ramp before the write.

**Window.** The calendar weeks the write touches (the same scope as `hard_sessions_per_week`:
every week of a dated cycle to the block end, the touched weeks of a session change). For a
cycle with no dated sessions yet (a start, a draft), the first week at its share, as the start
check does today.

**Not checked** when: the series is calibrating (under 42 days of history): "Weekly load ramp
not checked: fitness is still calibrating (N of 42 days)"; there is no series at all; the cycle is
a rotation (no fixed week).

**Message.** "The week of 2027-05-10 would raise fitness (endurance CTL) by 9.4 in 7 days, from
52 to 61. Limit 8 a week (6 while fitness is 45 or less). Planned load is an estimate; 2 sessions
have no time." Numbers: week, ctlStart, ctlEnd, ramp, limit, plannedLoad, partialSessions.

#### 3.1.1 Planned load of one session

- A session with its own workout or a library workout: D1's planned load estimate from the steps.
- A program session: each live working endurance set becomes one step for D1's estimate. Step
  type: `work` when `sessionRole` is `work` or the zone is 4-5; `recovery` for zone 1; else
  `warmup` (D1's default IF 0.65). Time: `durationSeconds`; with a distance only, time =
  distance / (IF x the threshold speed) for a run with a threshold pace, or the swim CSS for a
  swim; otherwise unknown. For future weeks a set with a peak anchor uses peak x that week's
  share (the curve times 100%), as `programRuns` already does for one share.
- A step with no time adds nothing and marks the session partial. The rule still runs on what is
  known, and the message says how many sessions are partial. All of it is Inference.

### 3.2 `hard_after_low_readiness`

**Research.** "Readiness signals change the next session, not the plan": "7-day mean below mean
- 0.5 SD for 2+ days AND one other marker agrees (resting HR up, poor sleep, high fatigue):
replace the next intensity session with Z1-Z2 or rest" (Study for the method; thresholds are
coach convention). "Never act on one bad day; require two agreeing signals for any downgrade"
(Study plus inference). Evidence label stored: "Study (HRV-guided method); thresholds Coach
convention; resting HR threshold Inference".

**The readiness flag** (shared with D4). A day F is a low-readiness day when, in the Garmin daily
rows:
1. HRV state is `fatigued` or `strained` on F and on F-1 (below the band two days running), and
2. the resting HR flag is set on F.
A day with HRV `calibrating` or no reading is not flagged. Only the two newest days count: F is
today or yesterday in the user's zone. A row older than yesterday is "no fresh readiness data".

**Broken** when the write raises the number of hard sessions (`isHardSession`, or the C4 hard
workout rule) planned on the window: day F and day F+1, from today on.

**Data source.** Garmin only. Without Garmin daily rows: not checked, "Hard session after a
low-readiness day not checked: no HRV and resting HR data (needs Garmin)." Open question 6.

**Message.** "Today (2026-11-13) is a low-readiness day: HRV 7-day mean 48 ms is below your band
(52-68) for 2 days and resting HR is 6 bpm over your normal 50. This write adds a hard session on
2026-11-14 ('Threshold run'). The research says make the next intensity session easy."

### 3.3 `heavy_legs_before_key`

**Research.** "Placement matters more than the program": a lower-body session impaired running
economy at 24 and 48 h; "Long run, long ride, brick or interval run within 48 h: no heavy
lower-body lifting; upper-body/pull is fine" (Study for the RE impairment, plus inference);
"Key endurance session in the same day: lift after it, 3-6+ h later" (Study). Evidence label
stored: "Study (running economy down 24-48 h after lower-body lifting) plus Inference (which
sessions count)".

**Heavy leg set.** A live working set (`setType` `working`) on an exercise with category
`strength`, no discipline, and:
- `movementPattern` `squat` or `hinge`, with `bodyArea` `lower_body` or `full_body`, and
  equipment that is not `bodyweight` or `bands`; or
- resolved `exerciseType` `plyometric` with `bodyArea` `lower_body` (jumps are heavy on the legs at
  any load);
- and the set's planned reps (`repRangeMax`, else `targetReps`) are 12 or fewer, or not set.
  Light 12-20 rep "toning" sets do not count (the research says they are not the heavy stimulus).

**Heavy-legs session.** A strength session (program) with 3 or more heavy leg sets. Leg curls,
leg extensions, calf raises and bodyweight bridges never count. Open question 13.

**Key session.** A bike or run session whose effective priority is `key` (C5's stored or derived
priority). A brick counts by its bike or run part. A key swim does not count (open question 14).

**Conflict.** A heavy-legs session on day L and a key session on day K, both planned or done
(not skipped, not missed), with K - L = 1 or 2 days, or K = L with the lift earlier in the day's
order (the lift first). A lift later on the same day as the key session is fine ("hard days
hard").

**Broken** when the write raises the number of conflicts in scope. The scope is the touched
calendar weeks plus the two days before the first one, so a Sunday lift before a Tuesday key run
is seen. For a cycle with no dated sessions, the template week read as a loop (Sunday is followed
by Monday).

**Message.** "'Leg day' on Mon 2027-05-10 (5 heavy leg sets) is 1 day before the key session
'Long run' on Tue 2027-05-11. No heavy legs within 48 h before a key run or ride; upper body is
fine."

**Not checked** for rotation cycles (no fixed days).

### 3.4 The long-run cap from app runs

Today the cap needs Garmin. After D1, completed runs logged in the app (source `app` or
`assistant`) have time and distance. The 30-day longest run becomes the longest of the Garmin
runs and the app runs. Taking the longest of both can never count a run twice, so no pairing is
needed. Indoor app runs (a run set with an incline) count for time, not distance, as the Garmin
rule does. With no run of either kind in 30 days the rule reads "no run" as today (broken on a
rise). With the switch on and no Garmin, the cap now runs instead of "not checked".

## 4. Strength sessions per week by phase (D3, D21)

**Rule `strength_per_week`.** Research: the strength-by-phase table ("Competition / peak: 1/wk
minimum; never less than weekly", Study; the rest Coach convention), through `strengthDefault`.
Evidence label stored: "Study for frequency (2/wk to build, 1/wk to keep); phase table Coach
convention".

- **Applies** to a cycle with a `phaseType` (a season phase, C1). A cycle with no phase type
  follows one template through base, build and peak, so it cannot match a per-phase count: not
  checked, with that reason. Needs a strength goal in the athlete profile; without one: not
  checked, "No strength goal set."
- **Strength session:** a session with 3 or more live working sets on strength exercises
  (category `strength`, no discipline). Two core sets after a run do not make it a strength
  session.
- **Count:** strength sessions in the template week (weekday cycle without dated sessions), or
  in each full calendar week of a dated cycle inside the block. A partial first or last week is
  not counted.
- **Broken** when, for a week in scope, the count after the write is further from the default
  than the count before (|after - default| > |before - default|). Both directions: a third
  session in base, or none in peak. Taper "light" is not checked here.
- **Message.** "Build phase 'Build 1' would hold 2 strength sessions a week (Tue, Fri). The
  default for 'Get stronger' in build is 1. Override with a reason if the athlete wants 2 (for
  example to keep muscle)."
- Lifters are not touched: it needs the switch and a strength goal.

**D3 UI (heavy legs).** The same conflict function as 3.3, with the switch on only:
- The cycle calendar's day list (C2) shows an amber line under a heavy-legs strength session:
  "Heavy legs 1 day before key 'Long run' (Tue). Move it or make it upper body." Read only.
- The planned session detail shows the same line on both sessions of the pair.
- Over MCP, `list_planned_sessions` adds `heavyLegsBeforeKey: { keySessionId, days }` on the
  strength session.
No second rule: the UI and the limit call one pure function.

## 5. Readiness swap (D4)

**When.** The user has Garmin daily rows, today (user zone) is a low-readiness day by the flag in
3.2 (F = today only: the suggestion needs this morning's reading), and today holds a hard
session (a weekday cycle's dated session, status planned, not done). A taper phase gets the same
suggestion with one more line: "In a taper HRV often drops. If you feel well, keep the plan."

**What.** "Make it easy": the session gets its own easy workout (`set_workout`), same sport, one
steady step at heart rate zone 2, the session's planned time capped at 60 minutes, named
"Easy <sport> (readiness)". It must pass the C4 schema and read as not hard. The hard session is
not moved to another day (research: "Missed sessions are skipped, not stacked"; "change the next
session, not the plan"). The program or workout before is in the revision, so the user or the
assistant can restore it.

**Data model.** None new. The suggestion is computed on read. Nothing records a dismissal: the
card goes away when the session is done or the day ends (open question 12).

**Flow (user).**
1. Home, under today's sessions (switch on): a card "Low readiness today. HRV below your normal
   for 2 days (48 ms, band 52-68) and resting HR 6 bpm up. Make 'Threshold run' an easy 50 min
   zone 2 session?" with one button "Make it easy".
2. The tap calls a Server Action through `callAction()`. The action takes only the session id,
   reads the suggestion again on the server (the client never sends the workout), and refuses
   when it no longer holds ("Readiness changed; nothing to swap").
3. It runs the C2 session op as writer `apply` (T2: wearable suggestion), reason "Readiness: HRV
   low 2 days and resting HR up; hard session made easy". One revision, so the session history
   can restore it.
4. A failure leaves the card and shows the error.

**Flow (assistant).** The same suggestion, from the same server function, appears in
`list_planned_sessions` (on today's session, as `readinessSwap`) and in `get_garmin_status`. The
assistant applies it with a new `manage_planned_session` operation `apply_readiness_swap` (`id`,
`reason`), writer `assistant`, through the same function. It makes the plan easier, so no limit
can break; it still runs the limit check like any session op so the result carries the summary.

## 6. T4: warnings on writes the app makes

A warn mode on the engine: the same before and after read, the same rules, but broken rules go to
`warnings`, `passed` is the rest, and nothing is refused. The check is stored on the write's
revisions in `limit_check`, so the history rows show "Breaks a training limit: ..." (existing
line).

| Write | Writer | Mode | Scope |
|---|---|---|---|
| Weekly sync | `sync` | warn | The cycle and its slot programs, this week |
| Garmin volume suggestion applied | `apply` | warn | Same as the sync |
| Readiness swap applied in the app | `apply` | warn | The session's week |
| Chained start of a season's next phase | `sync` | warn | The cycle, its first week (before = nothing active) |
| `restore_revision` with `changeSetId` | `assistant` | warn | The union of the scopes of every touched program, cycle and dated session |
| `manage_season` `resume` over MCP | `assistant` | check (refuse, override) | As `manage_training_cycle` `start` |
| `resume` in the app | `user` | none (D4) | |

Shown:
- To the user: the history row line (exists), and on the active cycle's page one amber line when
  this week's sync revision holds warnings.
- To the assistant: `get_training_cycle` adds `limitWarnings` from this week's sync revision;
  `restore_revision` with a change set returns `limits` like the single restore.

The warn mode costs nothing for lifters: with the switch off the context returns at once and no
facts are read.

## 7. Engine changes

- Pure module `src/lib/utils/training-limits.ts`: the four rule functions, the readiness flag,
  the heavy-leg classifier, the strength-session test, the CTL projection, the planned load of a
  program session, the easy workout builder, the message text. Each rule's header cites its
  research section and label.
- The week facts grow. A week entry keeps `dayOfWeek` and `hard` and gains optional `date`,
  `position`, `sport`, `key`, `heavyLegSets`, `strength` and `plannedLoad` (with `partial`), so the
  part 1 rules do not change.
- The context grows: the endurance fitness series (or why not), the readiness flag (or why not),
  the strength goal, the threshold anchors, and the app runs for the cap. Read once per tool call,
  only with the switch on.
- `planFacts` reads the extra fields in the same queries where it can (sets with exercise fields,
  priorities through C5's priority function over the week's rows, status planned and done for
  heavy legs).
- `withLimits` gains a mode (`check` or `warn`). `evaluateLimits` gains the four rules.
- No change to the stored shape (`v: 1`): new rule ids are strings in the same lists.

## 8. MCP

| Tool | Change |
|---|---|
| Every checked tool | `overrideLimits` takes the four new ids; descriptions list them |
| `restore_revision` | `changeSetId` runs the limits as warnings and returns `limits` |
| `manage_season` | `resume` takes `overrideLimits`, `overrideReason`; runs the check |
| `manage_planned_session` | New operation `apply_readiness_swap` (`id`, `reason`) |
| `list_planned_sessions` | `readinessSwap` on today's hard session when flagged; `heavyLegsBeforeKey` on a strength session in a conflict |
| `get_garmin_status` | `readinessSwap` (same function) |
| `get_training_cycle` | `limitWarnings` from this week's sync |
| `get_athlete_profile` | The strength default says it is checked by `strength_per_week` |
| Instructions, `docs/mcp/app-rules.md` | The six rules, who is checked, the warn mode, the readiness flag, the swap |

## 9. Migration and rollback

No schema change and no data migration. The new rule ids are strings inside the existing
`plan_revisions.limit_check` jsonb; the readiness swap uses the existing `planned_sessions.workout`
column and writer `apply`.

Rollback: revert the PR. Stored checks with the new ids stay and read fine (the user line prints
each rule's stored message). Sessions made easy keep their easy workout; each can be restored from
its revision. No data is lost.

## 10. Privacy (`privacy-compliance` skill)

- No new table, column or browser storage. No new recipient.
- New derived output to the user's own assistant: the readiness swap (HRV and resting HR numbers)
  and the limit messages with load, readiness and placement numbers. These come from data the MCP
  row of the data inventory already lists (Garmin readiness and body signals for admins, plans,
  workout history). Update that row's text to name the readiness suggestion and the new limits.
  No `LEGAL_VERSION` or `CONSENT_VERSION` bump: same categories, same recipient (owner rule in
  `src/lib/constants/legal.ts`).
- Logs: ids and rule ids only (`[mcp:limits] refused`, `[readinessSwap] stale`). Never HRV,
  resting HR or load numbers in logs.
- Nothing new shows to friends.

## 11. Tests per layer

| Layer | What | File |
|---|---|---|
| Unit | CTL projection: matches the existing PMC model on a known series; ramp per calendar week; limit 6 at CTL 45 or less, 8 above; rise rule (an unrelated edit to a week already over passes); calibrating and no series give not checked; partial sessions counted | `src/__tests__/training-limits.test.ts` |
| Unit | Planned load of a program session: zone to step type, distance to time by threshold pace and CSS, peak anchor at a week's share, no time gives partial | same |
| Unit | Readiness flag: HRV low 2 days and resting HR up flags; HRV low 1 day, or resting HR alone, or HRV alone does not; calibrating; stale (older than yesterday) | same |
| Unit | Hard after low readiness: window F and F+1 from today; a write that adds a hard session there breaks; moving one out passes; no flag passes | same |
| Unit | Heavy leg classifier: squat and hinge loaded sets count; deadlift (full body hinge) counts; jumps count; bodyweight bridge, leg curl, calf raise, 15-rep sets and warm-up sets do not; under 3 sets is not a heavy-legs session | same |
| Unit | Heavy legs before key: K-1 and K-2 break; K-3 does not; same day lift first breaks, lift after does not; key swim ignored; derived key (90 min long run) counts; Sunday lift before Tuesday key across weeks; template loop; rise rule | same |
| Unit | Strength per week: distance from default both ways; transition default 0; no phase type and no goal give not checked; partial weeks skipped; 2 core sets is not a strength session | same |
| Unit | Easy workout: passes the C4 schema, reads not hard, 60 minute cap, sport kept | same |
| Unit | Long-run cap with app runs: longest of both sources; indoor app run counts for time only | same |
| Integration | Each new rule: an assistant write that breaks it is refused with nothing written and no revision; the resend with an override applies and the revision holds `limit_check`; the same change as a user Server Action is not checked (D4); switch off gives every rule not checked and no extra reads | `src/__tests__/integration/mcp-limits.test.ts` |
| Integration | Warn mode: the weekly sync and an applied Garmin suggestion store warnings on their revisions and never fail; a lifter's sync is unchanged | `src/__tests__/integration/limits-warnings.test.ts` (*new*) |
| Integration | Chained start warns; `resume` over MCP refuses and accepts an override; `resume` in the app is not checked | same |
| Integration | Change-set undo over MCP returns and stores warnings (closes the BACKLOG item) | same |
| Integration | Readiness swap action: with seeded Garmin rows it writes the easy workout as writer `apply` with one revision; a stale suggestion is refused; the session restores to the program; another user's session is refused; MCP `apply_readiness_swap` and the `readinessSwap` field in `list_planned_sessions` | `src/__tests__/integration/readiness-swap.test.ts` (*new*) |
| Component | Readiness card: shows the numbers, the tap goes through `callAction()`, a failed action leaves the card and shows the error, no card with the switch off | `src/__tests__/components/readiness-swap.test.tsx` (*new*) |
| Component | Calendar heavy-legs line shows on the strength session only with the switch on | `src/__tests__/components/cycle-calendar.test.tsx` (existing or *new*) |
| e2e | Endurance user with seeded flagged Garmin rows and a hard session today: the card shows, the tap makes it easy, `testDb()` holds the workout and an `apply` revision; a lifter's home has no card | `e2e/readiness-swap.spec.ts` (*new*) |

The home screen changes for endurance users, so run `make e2e` and the smoke pass in `CLAUDE.md`
before merge.

## 12. Order of work

1. Re-read D1's merged API (section 13). Rebase.
2. Pure rules and unit tests, one rule at a time, tests first.
3. Context and facts in the server module; mode on `withLimits`; integration tests for the new
   rules on the existing tools.
4. Warn mode on the sync, the Garmin apply, the chained start; `resume` check; change-set undo.
5. Readiness swap: server function, Server Action, MCP operation, home card.
6. D3 UI lines and the MCP field.
7. Instructions, app rules doc, data inventory text, BACKLOG cleanup.
8. `pnpm verify`, `make e2e`, smoke pass.

## 13. What depends on D1's final code

This PR cannot build its ramp rule before D1 merges (the plan's order: D1 before D2).
- **The fitness reader.** D1's brief names one server reader that returns the Garmin series when
  the user has Garmin daily rows, else the app series, never both. This PR needs from it: the
  source, the per-day PMC with per-sport tracks (swim, bike, run), and the calibrating flag. If
  the reader returns only the total track, this PR reads the per-sport tracks the same way.
- **Planned load.** D1's planned load estimate from workout steps and its default IF table. The
  program-set mapping in 3.1.1 feeds steps into it. D1 says it is "not used by compliance or
  limits until D2 decides"; this brief decides: the ramp rule uses it.
- **App runs.** D1's session load reader lists completed app and assistant sessions with sport,
  date, time and distance. The long-run cap (3.4) reads the same rows.
- **Threshold anchors.** D1's anchor reader (run threshold speed, CSS).
If a name differs when D1 merges, this PR follows the merged code and records it in a "where the
build differs" section.

## 14. Defaults chosen

- The ramp uses endurance CTL (swim + bike + run), limit 8 a week, 6 at CTL 45 or less; not
  checked while calibrating.
- The readiness flag needs HRV below the band two days running and the resting HR flag today.
- Heavy legs: 3+ working squat or hinge sets (loaded) or lower-body jumps at 12 reps or fewer, 1-2
  days before a key bike or run, or earlier the same day.
- Strength per week runs only on phases (cycles with a phase type) and only with a strength goal.
- The swap makes today's hard session an easy zone 2 session of the same sport, at most 60
  minutes; never moves it.
- Warnings, not blocks, on every write the app makes; full check on assistant writes only.

## 15. Risks

- **False alarms.** Four more rules can refuse more assistant writes. The rise rule and the
  override keep each false alarm to one resend with a reason.
- **Planned load is rough.** Default IFs and missing times make the ramp an estimate. The message
  says so and counts partial sessions.
- **Home screen.** A new card on home for endurance users. The card is outside the workout flow;
  the e2e spec and the smoke pass cover it, and lifters do not render it.
- **Sync path.** The warn mode adds reads to the weekly sync for endurance users. Lifters read
  the switch only. The integration test pins a lifter's sync output.
- **D1 drift.** Section 13; step 1 re-reads the merged code.

## 16. Plan corrections (in the build PR)

- `triathlon-coach-plan.md`: D2, D3 and D4 to `done` when merged.
- `src/lib/utils/strength-goal.ts` header: the D3 check now exists.
- BACKLOG: delete "Training-limit warnings on a change-set undo over MCP" and the first bullet of
  "Seasons: limits and Garmin views across phases" (the projection bullet stays). Add "Readiness
  without Garmin" if the hub takes open question 6.

## 17. Open questions, with recommendations

The owner is away; the hub decides. Each recommendation is the safe choice: lifters see no change,
user edits stay unchecked, nothing changes the plan by itself, and every number without a source
says so.

1. **Ramp on endurance CTL or total CTL?** Recommend: endurance (swim + bike + run). The research
   ramp is about endurance TSS, and a planned strength session has no load estimate. The Garmin
   page's ramp (total) stays as it is; the limit message says "endurance CTL" so the two are not
   confused.
2. **Ramp limits?** Recommend: 8 a week, 6 when CTL at the week's start is 45 or less, straight
   from the research table.
3. **Ramp while fitness is calibrating?** Recommend: not checked, and the result says so, as the
   long-run cap does without data. Numbers from a 3-week series would mislead.
4. **Planned load of program sessions?** Recommend: the mapping in 3.1.1 (zone to step type, time
   from distance by threshold), labelled Inference, partial sessions counted in the message.
5. **Readiness flag?** Recommend: HRV below the band on the day and the day before, and the
   resting HR flag on the day (the research's "2+ days" and "two agreeing signals"). Sleep and
   the composite scores are not used (the research ranks them below HRV and resting HR).
6. **Readiness without Garmin?** Recommend: none in this PR. The rule says "not checked" and no
   swap is suggested. Add a BACKLOG entry "Readiness without Garmin" (a morning resting HR entry
   or another wearable). The 1-5 feel at session start is too late for a morning decision.
7. **Taper?** Recommend: the rule and the suggestion run in a taper too, with the line "In a
   taper HRV often drops. If you feel well, keep the plan." The raised resting HR is the second
   signal, and the user still decides.
8. **Window of `hard_after_low_readiness`?** Recommend: the flagged day and the day after, from
   today on.
9. **Swap or replace?** Recommend: replace today's hard session with an easy version; do not move
   the hard session to a later day. Moving it risks stacking hard days, and the research says skip,
   not stack.
10. **Easy session length?** Recommend: the planned time, at most 60 minutes (Inference; the
    research gives no length).
11. **Writer of the swap?** Recommend: `apply` for the user's tap (T2's wearable suggestion
    writer), `assistant` over MCP.
12. **Dismiss button?** Recommend: none. The card goes when the session is done or the day ends.
    No browser storage, nothing new stored.
13. **Heavy-legs classification?** Recommend: section 3.3 (3+ working sets, squat or hinge with
    load, or lower-body jumps, 12 reps or fewer). Calf raises and leg curls do not count.
14. **Which key sessions?** Recommend: bike and run sessions with effective priority `key`
    (stored or C5's derived), bricks by their parts. Not swims.
15. **Same day?** Recommend: a lift before the key session in the day's order counts; a lift after
    it does not ("lift after it, 3-6+ h later").
16. **Done sessions in the heavy-legs rule?** Recommend: yes, planned and done count; skipped and
    missed do not. A heavy leg day already done yesterday is the case the research is about.
17. **Strength rule scope?** Recommend: only cycles with a phase type, only with a strength goal.
18. **What is a strength session?** Recommend: 3 or more working sets on strength exercises.
19. **Strength rule both ways?** Recommend: yes. Fewer than the default in peak breaks too
    ("never less than weekly", Study).
20. **Where do sync warnings show?** Recommend: the history row (exists), one line on the active
    cycle's page, and `limitWarnings` in `get_training_cycle`.
21. **Warnings on the Garmin volume apply?** Recommend: yes, warn mode, like the sync: the app
    computed the numbers.
22. **`resume` in the app?** Recommend: not checked (D4). Over MCP: full check with override.
23. **Rotation cycles?** Recommend: the ramp, heavy legs, strength and readiness rules are not
    checked on rotation cycles (no fixed days), and the result says so. The swap needs a weekday
    cycle's dated session.
24. **D3 UI places?** Recommend: the cycle calendar and the session detail; the home screen gets
    only the readiness card.
25. **Long-run cap from app runs?** Recommend: yes, the longest of Garmin and app runs, so users
    without Garmin are checked (plan, D2 part 2).

### Decisions

Decided by the hub on 2026-11-13, owner may change. The hub took every recommendation above.

1. The ramp uses endurance CTL (swim + bike + run), not total CTL.
2. Ramp limits: 8 a week, 6 when CTL at the week's start is 45 or less.
3. The ramp is not checked while fitness is calibrating.
4. Program sessions get planned load by the mapping in 3.1.1, labelled Inference, partial sessions counted.
5. The readiness flag is HRV below the band on the day and the day before, and the resting HR flag on the day.
6. No readiness without Garmin in this PR; BACKLOG entry "Readiness without Garmin".
7. The readiness rule and the suggestion run in a taper too, with the taper line.
8. The window of `hard_after_low_readiness` is the flagged day and the day after, from today on.
9. The swap replaces today's hard session with an easy version; it never moves the hard session.
10. The easy session keeps the planned time, at most 60 minutes.
11. The swap's writer is `apply` for the user's tap and `assistant` over MCP.
12. No dismiss button and nothing stored for a dismissal.
13. Heavy legs as in 3.3: 3+ working sets, loaded squat or hinge or lower-body jumps, 12 reps or fewer.
14. Key sessions for heavy legs are bike and run sessions with effective priority key, bricks by their parts; not swims.
15. On the same day, a lift before the key session counts; a lift after it does not.
16. Planned and done sessions count for heavy legs; skipped and missed do not.
17. The strength rule runs only on cycles with a phase type and with a strength goal.
18. A strength session is 3 or more working sets on strength exercises.
19. The strength rule checks both directions from the default.
20. Sync warnings show in the history row, on the active cycle's page and as `limitWarnings` in `get_training_cycle`.
21. The Garmin volume apply gets warnings, like the sync.
22. `resume` in the app is not checked; over MCP it gets the full check with override.
23. Rotation cycles are not checked for the ramp, heavy legs, strength or readiness; the swap needs a weekday cycle.
24. The D3 lines show in the cycle calendar and the session detail; home gets only the readiness card.
25. The long-run cap uses the longest of Garmin and app runs.

## 18. Where the build differs from the brief

Stage 1 of the build (2026-11-13) shipped everything that does not need D1's API.

- **New rules are listed only when they have days to read.** `heavy_legs_before_key`,
  `hard_after_low_readiness` and `strength_per_week` run, or say "not checked", only when the
  write touches a weekday cycle's days. A program in no cycle or a rotation cycle gets no line
  for them, so the part 1 results stay the same. The brief said each rule always has a reason.
- **Long-run cap with no data at all.** With no Garmin data and no run logged in the app in 30
  days, the cap stays "not checked" (as part 1), instead of "no run" (broken on a rise). A user
  with app runs is checked.
- **Today's reading wins.** When the watch measured HRV last night, only today decides the
  readiness flag; a flagged yesterday followed by a normal today is no flag.
- **Every scheduled start warns.** The warning on a start the app makes runs for any scheduled
  start (writer `sync`), not only a season's chained phase.
- **The easy workout** targets 60-70% of max heart rate: heart-rate zones on LTHR are not
  allowed on a swim, and max heart rate fits every sport.
- **Heavy legs:** an exercise with no equipment set counts as loaded.

Stage 2 (2026-11-13) shipped the readiness swap (server module, Server Action, home card,
`apply_readiness_swap`, `readinessSwap` in `list_planned_sessions` and `get_garmin_status`), the
D3 heavy-legs lines and `heavyLegsBeforeKey` over MCP, the sync warning line on the cycle page
with `limitWarnings` in `get_training_cycle`, and the data inventory text. Differences:

- **The calendar day sheet is the session detail.** The app has no separate page for a planned
  session; the day sheet lists each session with its actions, so the heavy-legs line shows there,
  on both the lift and the key session. The lines are built on the server (`shortDay`).
- **No component test for the calendar line:** the calendar has no component test harness; the
  e2e spec covers the line, and a unit test covers its text.
- **Readiness swap card placement:** after the today card, before "Did you do these?".

Stage 3 (2026-11-13, after D1 merged in PR #232) shipped `weekly_load_ramp`. Section 13 against
D1's merged code: the one reader is `getTrainingLoad` in `src/lib/training-load.ts` (source,
days with every track's CTL, ATL, TSB and load, and a calibrating flag); the planned estimate is
`plannedLoad` with `DEFAULT_IF` in `src/lib/utils/training-load.ts`, and `workoutPlannedLoad` with
`loadAnchors` in `src/lib/utils/step-results.ts` for a workout. All as the brief expected.
Differences:

- **Calibrating needs history, not only D1's flag.** D1's app series starts at the window's
  first day when a user has logged nothing, so its flag is off for a user with no history, whose
  fitness reads 0 and any plan a steep ramp. The rule reads the 60 days before today: no load at
  all is "no training load yet"; a first day with load less than 42 days ago is "calibrating".
- **A template week** (a cycle with no dated sessions) is laid on this week, from today, and the
  next week.
- **Future weeks of the active block** scale peak-anchored sets by that week's curve at 100%
  volume; this week uses the values the weekly sync stored.
- **Each group is projected alone:** a dated cycle or a session week, as the other rules read
  them; sessions of another cycle in the same week are not added.
- **A session with a heart-rate target or none** uses D1's default IF and counts as a rough
  estimate in the message ("N sessions have no time or no power or pace target").
- **Today's done load** comes from today's row of the series; with no row yet (the Garmin job has
  not run), it counts 0.

## 19. The e2e reset deadlock (2026-11-13)

`e2e/fixtures/reset.ts` failed once with "deadlock detected while deleting tuple in relation
workout_sessions" (miss-sheet, WebKit). The previous spec's last set write can still run on the
server when the next spec's reset starts. A set write takes the records lock (`lockRecords`),
writes a set into one session, then a record on an earlier session's set (`rebuildPRsFrom`).
The reset deleted the sessions first, in heap order, so it could lock the earlier session and
wait on the later one while the write waited on the earlier one. A lock watcher on the e2e
database saw app writes (`training_cycles ... FOR NO KEY UPDATE`) wait on a running reset, and a
script with the write's order reproduced the same error every time. The reset now takes the
records locks for every exercise the account has sets or records for, then its cycles, then
its programs, in the app's order, before it deletes anything. `e2e/reset-lock-order.spec.ts`
fails with the old reset ("deadlock detected") and passes now.

## 20. Review fixes (2026-11-13)

Two independent reviews. Each code fix came with a test that failed first.

1. **A start read stored values, not week 1 at its share.** Template weeks now take the write's
   share for peak-anchored sets. Test "1: a start reads the template at its first week's share"
   (`src/__tests__/integration/limits-ramp.test.ts`, as 2, 3 and 5).
2. **Today's load counted twice** for a session done through a Garmin pick or a C5 match. Those
   read as done. Test "2: today's session matched to a logged workout counts once".
3. **A session week far ahead was projected over empty days.** The ramp now projects through the
   user's dated sessions from today to the group's first week. Test "3: a session week far ahead".
4. **A mixed program added no load.** The ramp counts any session with an estimate. The unit test
   that pinned the old rule now pins the new one (`src/__tests__/training-limits-ramp.test.ts`).
5. **A returning athlete read as calibrating.** History counts from the source's first day with
   load, however long ago; the count is days before today. Test "5: a returning athlete".
6. **`writeLoggedSession` took the records lock last.** It now takes it first, before any row, as
   a set write and the e2e reset do. Test `src/__tests__/integration/logged-session-locks.test.ts`;
   `e2e/reset-lock-order.spec.ts` covers the path.
7. **A double tap could make two revisions.** App writers keep the version (A4), so the swap
   checks under the row lock that the session still runs what it ran. The second tap reads "Readiness
   changed". Test "7: a double tap on two devices writes one revision".

Nits: live cycles only in the session reader; restores read dated cycles on their sessions; an
incline of 0 is no incline; a long run planned by distance gets its time from threshold pace for
the key rule; sync warnings need the endurance switch; a session with a workout in progress is
left out of the swap; the swap clears a stored key priority (a brick keeps its link); the reset
also clears Garmin rows and the role. A `SessionInputError` was already mapped (it is a
`PlanStateError`).
