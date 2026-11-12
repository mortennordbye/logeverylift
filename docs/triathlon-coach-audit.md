# Triathlon and AI coach audit

<!-- doc-claims: skip — a point-in-time audit (2026-11-12); its file references describe the code as measured, not as it is now. -->

What LogEveryLift has and misses for two kinds of user: a normal lifter, and a triathlete who
trains for a half or full Ironman with an AI coach connected over MCP. The research behind the
"needs" column is a separate reference on endurance training (periodization, zones, load,
recovery, strength, nutrition, workout data models). It is not in the repo yet.

Status words: **has** (works), **partial** (some of it works), **missing**.

## Principle: lifters first, triathlon opt-in

Most users only lift. Every triathlon feature must be additive and hidden until the user turns
it on. Today the "Triathlon plan" entry
(`src/components/features/CyclesListClient.tsx:394-400`) and the race field on the cycle edit
form are shown to every user. Garmin features are admin-only
(`src/lib/garmin/access.ts:15-17`), because the Garmin Personal API terms do not allow a shared
key (see the Garmin entry in `BACKLOG.md`). So any triathlon feature for normal users must also
work without Garmin, from sessions logged in the app.

## Bugs found

1. **MCP set editor drops fields without an error.** The `edit_program_exercise` description
   tells the model to set `repRangeMin`, `repRangeMax` and `targetRir`
   (`src/lib/mcp/tools/programs.ts:229`), but `setShape` does not accept them
   (`src/lib/mcp/tools/programs.ts:64-73`). Zod strips the keys, so the change is lost and the
   model is told it worked. `targetHeartRateZone`, `sessionRole` and the peak fields are also
   missing.
2. **MCP update does not check the exercise.** `add` checks that the exercise is a system
   exercise or the user's own (`src/lib/mcp/tools/programs.ts:297-308`). `update` sets any
   `exerciseId` with no check (`src/lib/mcp/tools/programs.ts:387-391`), so a slot can point
   to another user's custom exercise.
3. **Doc drift in the triathlon generator.** The header of `src/lib/utils/triathlon-plan.ts`
   says three strength sessions, but the code builds two. A comment says the sets are
   "RIR-capped", but no `targetRir` is set.
4. **Sessions left open.** Real data has "completed" sessions with no sets and a duration of
   11-24 hours. Check whether an open session should close itself or be flagged.

## What exists today

Strength planning is mature: programs, cycles (`day_of_week` or `rotation`), the progression
engine with RIR and readiness hold, and AI Setup for strength plans.

For triathlon the app already has:
- A rule-based triathlon plan generator (`src/lib/actions/triathlon-plan.ts`): weeks, rest
  days, goal (`build`/`maintain`) and level. It builds swim, bike, run and two strength
  sessions.
- A periodization curve (`src/lib/utils/periodization.ts`): ramp, deload every 3rd or 4th week,
  peak, taper. A weekly sync rewrites endurance distance and duration
  (`src/lib/periodization-sync.ts`) and nudges volume from adherence, readiness and RPE.
- Endurance sets with duration, distance, incline, HR zone 1-5 and a "work" role, and a run
  logger with RPE.
- Race date and distance (`full`/`half`) on the cycle.
- Garmin (admin-only): per-activity load (power, HR/TRIMP, session RPE for strength),
  fitness/fatigue/form, ramp and monotony, FTP/CP/run critical speed/LTHR estimates with
  history, time in zone and a weekly polarized/pyramidal label, a readiness score against
  personal baselines, aerobic decoupling, best efforts, a race page with a key-session
  checklist, form projection, bike and run pacing, brick detection, fuel logs and sweat rate,
  and planned against real hours per sport.
- An MCP server with OAuth and 22 tools: read profile, programs, cycles, workouts, records,
  volume and Garmin; write profile, weight, programs, program exercises and sets, cycles and
  cycle slots.

## What is missing

Priority is for the triathlete and AI coach use case. "Lifter risk" says whether the change can
hurt normal lifters if it is done carelessly.

### 1. Season level and plan structure

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Season above cycles (goal, A/B races, later goal) | missing | The cycle is the top level. | high | low (new table) |
| Phases as stored, ordered blocks | partial | Phases are computed from the week number, never stored. | high | low |
| Taper placed from the race date | missing | Taper is the last ~10% of weeks (`periodization.ts:81-92`), not tied to `raceDate`. | high | low |
| Chained blocks (base → build → peak) | missing | `endAction` only changes a banner link. | medium | low |
| Recovery-week pattern choice (2:1, 3:1) | partial | Fixed by level. | medium | low |
| More than one session per day | missing | `uniq_cycle_day` on slots (`src/db/schema/training-cycles.ts`). | high | **high**: missed-workout detection, the rotation walker and the auto-session index assume one session per day |
| Weekly hours budget and available days as input | missing | Triathlon generator takes rest days only (`triathlon-plan.ts:24-29`). | high | low |
| Race distances other than half/full | missing | No Olympic or sprint. | low | low |

### 2. Athlete profile

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Triathlon opt-in (sport/discipline on the profile) | missing | Goals have `endurance` but no triathlon; onboarding is lifter-only. | high | low if it gates UI |
| Thresholds entered by hand, field test results | missing | Only Garmin estimates. Design decision O-6 said "not for now". | high | none |
| Threshold history per test | partial | Weekly estimates from Garmin only. | medium | none |
| Injuries and limits | missing | Only per-plan "avoid" areas. | medium | none |
| One experience scale | partial | Profile uses beginner/intermediate/advanced, cycle uses novice/intermediate/advanced. | low | low |

### 3. Endurance workouts

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Structured steps (warmup/interval/recovery/cooldown, repeat blocks) | partial | Each segment is a flat `program_sets` row. | high | low (endurance only) |
| Targets relative to FTP, LTHR, threshold pace, CSS | missing | HR zone 1-5 only. | high | none |
| Power, pace and cadence targets | missing | No columns. | high | none |
| Swim: pool length, CSS, stroke | missing | Two swim exercises ("Swim" and "Swimming"). | medium | low |
| Brick as one unit | partial | Two exercises in one program; detected afterwards in Garmin data. | low | none |
| Planned vs completed matching for endurance | missing | Only strength sessions are matched to Garmin activities. `autoComplete` marks a day done without a check. | high | low |
| Export (FIT file, ZWO, calendar) | missing | The app reads FIT but does not write it. Push to the watch needs Garmin's business Training API. | medium | none |

### 4. Load, readiness and safety

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Swim load and CSS | missing | Swims use wrist HR or Garmin's TSS. | medium | none |
| Run pace load | missing | Runs use HR only. | medium | none |
| Run spike guard (one run vs longest run in 30 days) | missing | The best-supported injury rule in the research. | high | none |
| Intensity split from power and pace | partial | HR only. | low | none |
| Readiness changes the next session | partial | Advice text and a cycle-wide Apply; no session swap. | medium | low |
| Illness, injury and travel log | missing | Models cannot tell a sick week from a planned rest week. | medium | none |
| Endurance volume without Garmin | partial | `weekly_volume` counts kg × reps only. | medium | none |

### 5. Strength inside a triathlon plan

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Strength frequency by phase (2×/week in base, 1× in build) | missing | Removed by design in `docs/specs/cycle-periodization.md`. | medium | **medium**: must not touch strength-only cycles |
| Heavy legs vs key run/ride placement check | partial | A generic insight after heavy strength days. | medium | none |
| Heavy (≥80% 1RM) main lifts and plyometrics in the templates | partial | Templates exist; no `targetRir`. | low | none |

### 6. Nutrition and race day

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Carbs-per-hour target and gut-training progress | missing | Fuel logs store totals only. | medium | none |
| Sodium and product details in fuel logs | missing | | low | none |
| Race-day plan (timeline, transitions, fuel schedule, per-leg IF) | missing | Pacing covers bike and run only. | medium | none |

### 7. MCP and AI coach

| Need | Status | Notes | Priority | Lifter risk |
|---|---|---|---|---|
| Set race date, distance, goal, level, future start date over MCP | missing | Columns exist; the MCP schema leaves them out. `start` always uses today. | high | none |
| Call the triathlon generator over MCP | missing | | medium | none |
| Exercise library search tool | missing | Needed to get an `exerciseId` for `add`. | high | none |
| Server instructions and knowledge resources | missing | `createMcpHandler` gets `{}` (`src/app/api/[transport]/route.ts:59-68`). | high | none |
| Coach memory (goals, limits, decision log) | missing | No table. Each conversation starts from nothing. | high | none |
| Proposals the user accepts, change history, undo | missing | Every write applies at once; a set replace keeps no snapshot. | high | low |
| Guardrails on load change | missing | Only a 9999 kg max on weight. | high | none |
| Integration tests for MCP write tools | missing | Only read tools have integration tests. | high | none |
| Revoke a connected assistant in the app | missing | | medium | none |
| Consent text names workout history and Garmin reads | partial | | low | none |

## Suggested order

1. **Fix the two MCP bugs** with tests. Small and independent.
2. **MCP coach basics:** cycle race fields over MCP, exercise search, server instructions and a
   knowledge resource, a coach-memory table, proposals with accept and history, load guardrails.
   This makes the AI coach usable on the current model.
3. **Season level:** goal, races, ordered phases as cycles, taper from the race date, chained
   blocks, more than one session per day (with care for the lifter flows listed above).
4. **Athlete profile:** triathlon opt-in that gates the UI, available days and hours,
   thresholds by hand and field tests, injuries.
5. **Structured endurance workouts:** steps, repeats, targets relative to thresholds,
   planned-vs-done matching, FIT export.
6. **Analytics and safety:** run spike guard, swim and run-pace load, illness log, readiness
   proposals.
7. **Strength by phase, nutrition targets, race-day plan.**

Each step should get its own brief in `docs/plans/` before code.
