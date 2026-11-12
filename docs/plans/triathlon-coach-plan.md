# Endurance, seasons and AI coach: build plan

This is the master plan for making LogEveryLift a native endurance and triathlon app with an AI
coach, while normal lifters keep the simple app they have. It splits the work into packages,
says what each package needs from the others, and gives the order. Each package becomes its
own brief in `docs/plans/` before code. Agents build from those briefs with no conversation
history, so this file and the documents it links must be enough.

Written 2026-11-12. Read this file first, then the two inputs:

- **The audit:** [`docs/triathlon-coach-audit.md`](../triathlon-coach-audit.md). What the app has
  and misses, the bugs found, and the owner's decisions **D1-D23** and technical decisions
  **T1-T10** at the end. When this plan and a decision disagree, the decision wins; fix this
  plan. A D decision wins over a T decision, except where the T decision says it replaces part
  of a D decision (T10 replaces where D10 stores the interview answers).
- **The research:** [`docs/research/endurance-training-reference.md`](../research/endurance-training-reference.md).
  The training rules (periodization, zones, load, recovery, strength, nutrition, workout data
  models), each with an evidence label. Every training rule in code cites it.

## 1. Vision

**Who it serves.** Two users in one app:
- A **normal lifter** who logs strength workouts. They must see no change unless they turn
  something on, and every change to a shared flow is proven by tests.
- An **endurance athlete** (triathlon first; running-only and cycling-only follow from the same
  model) who also lifts, and who plans and adapts training with an AI coach.

**The first user** is the owner. They lift twice a week and train for a first half-distance
triathlon in late summer 2027, as the first step to a full distance later. They use Garmin.
They connect Claude to the app's MCP server about once a week and ask it to review and adapt
the plan. The coach adapts **only when the owner asks**; nothing changes the plan on its own
except the existing weekly periodization sync.

**The end state.**
- A user sets a long goal (a **season**) with races, and the season holds the phases (general,
  base, build, peak, taper, transition) as training cycles.
- A day can hold several sessions. Each planned session has a date, can be moved or skipped on
  its own, and is matched to what was really done (logged in the app or found in Garmin).
- Endurance sessions are structured workouts (steps, repeats, targets as a share of the user's
  own thresholds). The app shows today's and this week's plan in the user's own numbers and can
  guide an indoor session step by step.
- The AI can do everything the UI can over MCP. Every change, by anyone, makes a **revision**
  that can be restored. The AI writes with a reason, and training limits in code warn it with
  the numbers before a risky change; it may override with a reason that is stored.
- The user's context (goals, limits, preferences) persists between conversations, so each talk
  with the AI starts from what it already knows.

**What must never break.**
1. A lifter's workout logging, timers, set editing, drag-reorder, finishing a workout (critical
   flows in `CLAUDE.md`).
2. Logged workout data. No plan change or restore may delete or unlink logged sets.
3. Privacy: new health data is covered by export, delete, the data inventory and consent.

## 2. Principles and rules for every package

1. **Change the app, do not work around it** (audit principle 1).
2. **Layers:** endurance features sit behind one endurance switch (D18). Seasons, revisions,
   time zone, units and MCP scopes are for everyone (D18, D22).
3. **AI parity:** every package that adds a UI feature also adds its MCP tools, with
   integration tests (principle 3).
4. **Owner first, built for everyone (D15):** the endurance switch can only be turned on by an
   admin for now. No logic may check the admin role instead of the switch. Garmin-only features
   stay admin-only for licence reasons; every endurance feature should also work from sessions
   logged in the app.
5. **Revisions (D2, T2-T6):** every write to plan data goes through the revision layer from
   package A4 on. No package may add a plan write that skips it.
6. **One owner per field** (audit section 8): each package states which writer owns each field it
   adds.
7. **Tests by layer** (`TESTING.md`): pure rules in `src/lib/utils/` with unit tests; Server
   Actions, MCP tools and migrations with integration tests; critical flows with component tests
   and an e2e spec. Bug fixes start with a failing test.
8. **Privacy:** any package that adds a table or sends data to an assistant runs the
   `privacy-compliance` skill and updates `collectUserData` in `src/lib/account-data.ts`.
9. **Migrations:** one per package, merged one at a time, each with a written rollback note in
   the brief (what to run if it must be undone, and whether data is lost).

## 3. Work packages

Status words: `todo`, `brief` (brief written), `building`, `done`.

### Phase A: foundations

These have no dependencies on new features. A1-A3 can run in parallel. A4 is the base of
everything that writes plan data. A1-A3 share one brief and one PR:
[`foundations.md`](foundations.md).

| ID | Package | Needs | Status |
|---|---|---|---|
| A1 | Bug fixes and ghost-session cleanup | none | building |
| A2 | User time zone and display units | none | building |
| A3 | Endurance switch | none | building |
| A4 | Revisions, stable ids and plan versions | A1 | building ([`revisions.md`](revisions.md)) |

**A1. Bug fixes and ghost-session cleanup.** Audit "Bugs found" 1-4 and D23.
- MCP `edit_program_exercise`: accept every planned-set field the tool description names
  (`repRangeMin`, `repRangeMax`, `targetRir`, `targetHeartRateZone`, `sessionRole`,
  `startDelaySeconds`), or fail loudly on unknown keys.
- MCP `update`: check that a new `exerciseId` is a system exercise or the user's own.
- Fix the doc drift in `src/lib/utils/triathlon-plan.ts`.
- Stop empty sessions from being kept as completed when auto-closed; then a cleanup script with
  a dry run (count and list), owner approval, then delete only sessions with no sets. Prod only
  with the owner's approval.
- Done when: each bug has a test that failed before the fix.

**A2. User time zone and display units (D14).** A time zone on the user (default from the
browser), one helper for "today" and week numbers used by the weekly sync and cycle views, and
a units setting for endurance numbers (km/mi, pace per km or mile, swim per 100 m or 100 yd).
Weight stays kg for now: the owner moved lb to BACKLOG.md ("Pounds for weights") on
2026-11-12. Storage stays metric; only display and input convert. For everyone. Touches dates
in workout logging, so it is near a critical flow: component tests for the date boundary near
midnight.

**A3. Endurance switch (D15, D18).** A per-user flag, settable only by an admin for now. Moves
the "Triathlon plan" entry and the race field on the cycle form behind it. Every later
endurance package gates on this flag, never on the role.

**A4. Revisions, stable ids and plan versions (D2, T2, T3, T5, T6, T9).** The base of all plan
writes.
- Program sets are updated in place, matched by id (diff), never deleted and inserted again.
  This also fixes "safe writes during an open workout" (audit section 7). The plan first named
  two paths that delete sets (the MCP set replace and `deleteProgramSet`); the A4 brief found
  seven delete paths in all, listed in [`revisions.md`](revisions.md) section 1.1, and all of
  them change.
- Soft delete for every plan object (T6): program sets, program exercises, programs and cycles
  now, and seasons, sessions and workouts when they exist. Readers filter out deleted rows.
- A revision store: object type and id, a full snapshot, writer (`user`, `assistant`,
  `progression`, `sync`, `apply`), reason, change-set id, time.
- Restore: whole object, keeps ids, never touches logged data, leaves engine- and sync-owned
  fields as they are and re-runs the sync (T2). A restore is itself a revision.
- A version number on programs and cycles; a write based on an older version shows a conflict
  instead of applying silently (T9). This covers the offline queue and AI writes.
- UI: a revisions list per program and cycle with restore, and a feed of AI changes (writer
  `assistant`), grouped by change set.
- Privacy (D2): revisions are user data. Add them to export and delete, and add a retention
  rule for them to the data inventory.
- Lifter risk: high (set writes are used in the workout). Needs component tests and the e2e
  suite.
- Unlocks: everything in phases B to E.

### Phase B: the AI coach on today's model

After phase B the owner can use Claude as a coach on the current cycle model. B1-B4 can run in
parallel once A4 is done.

| ID | Package | Needs | Status |
|---|---|---|---|
| B1 | MCP parity, part 1 | A1, A4 | todo |
| B2 | MCP scopes, consent and revoke | none | building ([`mcp-access.md`](mcp-access.md)) |
| B3 | MCP knowledge resources and server instructions | research doc (done) | building ([`mcp-access.md`](mcp-access.md)) |
| B4 | Coach memory | A4 | todo |

**B1. MCP parity, part 1.** Cycle fields over MCP (race date and distance, goal, athlete level,
a future start date), exercise search, create a custom exercise, log or confirm a session, read
session notes (D6), an explicit change-set argument for the model (T3), and the optimistic
version check (T9) on the tools B1 adds. Integration tests for every existing and new MCP write
tool. Package A4 already ships `list_revisions`, `restore_revision`, writer tagging, a required
`reason`, a default change set per OAuth client (a 30-minute window) and the version check on
every existing write tool (`revisions.md`, section 2.10), because plan principle 3 puts the MCP
tools in the package that adds the UI.
- Field owners for the existing conflicts (audit section 8). After A1, MCP can set
  `targetHeartRateZone` and rest on `work` sets, but the weekly sync overwrites them the next
  week. The brief decides for each field in that table who owns it, including how an AI volume
  change goes through `adaptation_pct`, and writes it into the tool descriptions.
- What one "AI session" is for the change-set id: A4 settles the default (token client plus a
  30-minute window, since the handler is stateless, `src/app/api/[transport]/route.ts:99-111`). B1
  adds the explicit argument for a model that wants to name its review.

**B2. MCP scopes, consent and revoke (D5, D6).** Read-only and read-write scopes on the consent
page. Consent text names workout history, notes, the illness log (when it exists) and Garmin
reads. A screen that lists connected assistants and revokes them. Privacy: data inventory row
for MCP, policy text, and a `LEGAL_VERSION` bump. `CONSENT_VERSION` stays: assistants are a new
recipient of data already listed as health data, which users are told about, not asked again
(owner, 2026-11-12; rule in `src/lib/constants/legal.ts`).

**B3. Knowledge resources and server instructions (T1).** Server instructions that explain the
app's model (seasons, cycles, programs, dated sessions, who owns which field, revisions, limits,
the endurance switch) and how a weekly review should go. MCP resources: the research reference,
the app's rules, and later the workout step syntax (from C4). Each resource is versioned with
the doc it comes from. The production image does not contain `docs/`: it copies only the
standalone build, `public`, `drizzle` and `scripts-dist` (`Dockerfile:73-78`). So the brief
must bundle the docs into the build or copy them into the image, with a test that reads each
resource from a production build.

**B4. Coach memory (T10).** A per-user table of context entries: kind (preference, limit,
observation, decision), text, date, active flag. Read and write over MCP and in a simple screen.
Revisioned (T5). Facts with their own home (race, thresholds, injuries, availability, strength
goal) do not go here. Health data: privacy checklist.

### Phase C: the endurance model

This phase changes the data model. C1 and C3 can run in parallel. C2 is the riskiest package in
the plan and runs alone.

| ID | Package | Needs | Status |
|---|---|---|---|
| C1 | Seasons, races and phases | A2, A3, A4 | todo |
| C2 | Session model: several slots a day, dated sessions | A2, A4, C1 | todo |
| C3 | Athlete profile, thresholds and intake interview | A3, A4, B4 | todo |
| C4 | Structured endurance workouts | C2, C3 | todo |
| C5 | Planned vs done, missed sessions, sick periods | C2, C4 | todo |
| C6 | Endurance in the app: views and guided player | A2, C3, C4 | todo |

**C1. Seasons, races and phases (D8, D17, D22, T8).**
- A season for every user: name, goal, start, end, next goal.
- Races on the season: date, distance (`full`, `half`, and room for olympic, sprint, run and
  ride events), priority A/B/C. A cycle inside a season stores no race; a cycle with no season
  keeps its own race fields.
- Phases are cycles in order inside the season, with types including general prep and
  transition, and an optional length in days (T8).
- Taper placed from the A race date, not from block length.
- When a race date changes, flag the season for the AI to re-plan (D17); no automatic reshape.
  The flag shows on the season in the app and in the season read tool over MCP. D17 says "the
  MCP status tool", but no general status tool exists (only `get_garmin_status`), so the season
  read tool carries it.
- Migration: existing triathlon cycles move into a season. Rollback note required.
- MCP tools for all of it. Lifter risk: low (new tables; cycles without a season unchanged).

**C2. Session model (D7, D16, T7).** Merge the draft brief
[`quick-workout-and-swap.md`](quick-workout-and-swap.md) into this package, since both change how
a session relates to a program.
- A cycle day can hold several slots (for example strength and a run).
- The cycle template creates dated planned sessions for every cycle, lifter cycles too (D16).
  Each can be moved, skipped or changed alone. A template edit regenerates only untouched future
  sessions (T7). Past sessions never change.
- The brief must settle with the owner: how far ahead dated sessions exist, and how rotation
  cycles map onto dates.
- Rewrite missed-workout detection, the rotation walker, make-up prompts and the auto-session
  index for the new model, with the current lifter behaviour as tests first.
- Lifter risk: high. Critical flow. Component tests, integration tests and e2e specs, plus the
  smoke pass in `CLAUDE.md`.
- The brief may ship the quick-workout part as a second PR after the dated-session model, so
  the riskiest change is reviewed alone.

**C3. Athlete profile, thresholds and intake interview (D10, D12, D21).**
- Thresholds with history: FTP, threshold HR (bike, run), threshold run pace, swim CSS, max HR.
  Manual entry and field tests (protocols from the research); Garmin estimates shown as a
  suggestion for admins.
- Availability (days, hours per week, longest day), injuries and limits, strength goal (keep
  muscle, stronger, minimal).
- The intake interview, in the app and over MCP, writes these tables (not coach memory).
- Strength part of a plan follows the strength goal; frequency by phase is a default the AI can
  override with a reason (D21).
- The existing generator (`src/lib/utils/triathlon-plan.ts`) builds a fixed plan. The brief
  decides whether to change it to use the interview answers and the season, or to retire it
  because the AI builds plans from parts.
- Behind the endurance switch (D18). Health data: privacy checklist. Thresholds and HR never
  show to friends (audit section 9).

**C4. Structured endurance workouts (D9).**
- A step tree in JSON, checked with one Zod schema used by the app, MCP and export: step types
  (warmup, work, recovery, cooldown, rest), repeat blocks, end conditions (time, distance, lap),
  targets (power, HR, pace, cadence) as a share of a threshold anchor or an absolute range.
- Swim: pool length, sets with send-off times, CSS-based targets. Bricks as linked sessions.
- A workout library of reusable sessions.
- How a structured workout attaches to a dated session or a program slot.
- MCP: create and edit workouts, with the step syntax as a resource (B3).
- Delivery to the watch is open (D13); the model must allow FIT export later.

**C5. Planned vs done, missed sessions, sick periods (D11, D19, D20).**
- Match a dated session to a Garmin activity (admins) or to a session logged in the app.
- If nothing matches, ask "did you do it?" (confirm with time, distance, RPE, or mark missed).
- A confirmed missed easy session is skipped (D11). A confirmed missed key session gets a
  suggested free day in the same week, never next to another hard day; the user taps (D19).
- A sick period is one entry; sessions inside it are marked missed by illness; the AI gets the
  return rule (D20).
- Compliance per session and a consistency number (share of weeks above 80% done, from the
  research).
- MCP: read the state, confirm, move, log sickness. Health data: privacy checklist. The illness
  log is a new kind of health data: add it to the consent text and the policy, and bump
  `LEGAL_VERSION` and `CONSENT_VERSION` again. Illness never shows to friends.

**C6. Endurance in the app (audit section 3b).**
- Today and week views with steps, totals per sport, and targets in the user's own numbers and
  units.
- A guided player for indoor sessions: step timer, current and next target, sound cue at each
  step change (iOS ignores vibration), pause, skip, extend, screen kept awake. Reuse the
  existing timer code with care: it is a critical flow.
- A pool view (large text, send-off times).
- Per-step results after the session (planned vs done, RPE, notes).

### Phase D: load, limits and adaptation

| ID | Package | Needs | Status |
|---|---|---|---|
| D1 | Load without Garmin, swim and run-pace load | C3, C5 | todo |
| D2 | Training limits engine (warn the AI) | B1, C1, C2, D1 | todo |
| D3 | Strength by phase and heavy-legs placement | C1, C3, D2 | todo |
| D4 | Readiness-based session suggestions | C2, D2 | todo |

**D1. Load without Garmin.** Session-RPE load for endurance sessions logged in the app, run-pace
load, swim load from CSS. Fitness, fatigue and form from these when there is no Garmin data.

**D2. Training limits engine (D3, D4, T4).** Pure rules in `src/lib/utils/`, each citing the
research: weekly load ramp, the 1.10× long-run cap, hard sessions per week, no hard session
after a low-readiness day, no heavy legs within 48 h of a key session. On an AI write that
breaks one: refuse with the rule, the numbers and the evidence level; accept a resend with an
override and a reason; store both in the revision. Sync output and AI restores get the same
check as warnings (T4). User edits are not checked (D4). The workout schema check (C4) is
separate and never overridable.
- Open question for the owner: split D2. With D2 where it is, the weekly AI reviews from
  December 2026 run with no limits until about May 2027. For Garmin users (the owner), the
  1.10× long-run cap and hard sessions per week can run on Garmin data in phase B, and D2 then
  adds the load-based rules. Settle this before the B1 brief.

**D3. Strength by phase and heavy-legs placement (D10, D21).** Strength frequency follows the
phase as a default the AI can override. The UI shows heavy leg work within 48 h before a key
session, using the rule from D2; D3 does not write a second rule.

**D4. Readiness-based suggestions.** When readiness flags (HRV and resting HR both off), suggest
swapping today's hard session for an easy one; the user taps. The AI sees the same suggestion.

### Phase E: race and nutrition

| ID | Package | Needs | Status |
|---|---|---|---|
| E1 | Nutrition targets and gut training | C4 | todo |
| E2 | Race-day plan | C1, E1 | todo |
| E3 | Workouts to the watch | C4, owner decision D13 | parked |

**E1. Nutrition.** Carbs-per-hour target by session length, gut-training progress, sodium and
products in fuel logs (works without Garmin), sweat-rate test entry.

**E2. Race-day plan.** Timeline, transitions, fuel schedule, pacing per leg (bike IF, run pace,
swim pace), for half and full first.

**E3. Workouts to the watch.** Parked until the owner decides (D13). Options: FIT and ZWO
export, intervals.icu, Garmin's Training API.

## 4. What needs what

The `Needs` column in the tables above decides. This list shows the same edges:

- A1 → A4. A4 feeds B1, B4, C1, C2 and C3.
- A2 feeds C1, C2 and C6. A3 feeds C1 and C3.
- C1 → C2. B4 → C3.
- C2 and C3 → C4. C4 feeds C5, C6 and E1.
- C3 and C5 → D1. B1, C1, C2 and D1 → D2.
- D2 feeds D3 (with C1, C3) and D4 (with C2).
- C1 and E1 → E2.
- B2, B3: independent; B3 adds the step syntax after C4.

Why this order:
- **A4 first among the large items.** Every later package writes plan data. If revisions come
  later, everything written before them has no history, and each package would need a retrofit.
- **Bugs before parity.** B1 widens MCP writes; bug 2 (no exercise check) must be closed first.
- **Phase B before the model change.** The owner gets a working coach on today's model early,
  and the AI can help plan while C is built.
- **C1 before C2.** Seasons are additive and low risk; the session model is high risk and needs
  seasons to know phases and race dates.
- **Limits after load (D2 after D1).** The weekly ramp and key-session rules need load for
  sessions without Garmin and session priority from C1 and C2.
- **C2 alone.** It changes the core lifter flow. Nothing else merges while it is in review.

## 5. Milestones against the owner's season

The owner's race is in late summer 2027. The general block runs now to January; the
race-specific block starts about mid-April 2027.

| Target | Packages | What the owner can do then |
|---|---|---|
| End of December 2026 | A1-A4, B1-B4 | Weekly AI reviews on the current model, with revisions and memory. |
| End of February 2027 | C1, C3 | A season with phases and the race; thresholds and the interview. |
| Mid-April 2027 | C2, C4, C5 | Several sessions a day, structured workouts, planned vs done, at the start of the race-specific block. |
| End of May 2027 | C6, D1, D2 | In-app player and views; limits that warn the AI. |
| End of July 2027 | D3, D4, E1, E2 | Strength by phase, readiness swaps, fueling and race-day plan before the race. |

These are targets, not promises. If C2 slips, the owner trains on the current model with AI
help from phase B.

## 6. How to work from this plan

1. Pick the next package whose needs are `done`.
2. Write its brief in `docs/plans/<name>.md` (format: `docs/plans/README.md`). The brief
   expands the package: findings in the code (with `file:line`), the data model, the migration
   and its rollback note, MCP tools, privacy steps, tests per layer, and open questions for the
   owner. Settle the open questions before code.
3. Add the brief to the table in `docs/plans/README.md` and set the package status here to
   `brief`.
4. Build on a branch, one PR per package, `pnpm verify` before push, `make e2e` and the smoke
   pass for critical flows.
5. When merged, set the status here to `done`, and move any deferred work to `BACKLOG.md`.
6. If the code proves a part of this plan wrong, trust the code, fix this plan in the same PR,
   and say so in the PR body.
