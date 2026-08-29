# Progression revamp: plan

> **Status:** in build. Phases 0, 1, 3 and 2 shipped; phase 4 is next. See §0 "Build state" — it is the one place that says where the work stands, and every phase updates it before finishing.
> **Design status:** approved, all eleven decisions (`D-1` to `D-11`) decided. Revised 2026-08-29 after an independent design review and a line-by-line fact-check against the code; roughly thirty corrections, several of which would have broken the build. `D-8` was reopened on review and re-decided; `D-11` was added. Section 14: three prerequisites, nineteen edge cases. Section 15: twenty-three consumers outside the engine.
> **Written:** 2026-08-29 against `197dea1`
> **Supersedes on completion:** the `SI` rules in [`specs/smart-incrementation.md`](specs/smart-incrementation.md), rewritten at the end of phase 5
> **Closes:** audit findings `A1`-`A11`, smart-incrementation divergences `SI-D1`-`SI-D6` and `SI-D8`, and cycle divergence `PZ-D3`. `SI-D7` stays open. Section 13 is authoritative; see its note on the three colliding `D` numbering schemes.

Progression is the reason this app exists rather than a notes file. It is also the part with the least honest data behind it. This plan rebuilds it as one machine with a small number of settings, so that every progression scheme a lifter actually runs is the same engine with different values, and the app can say in one sentence what it will do next.

Section 12 holds the eleven decisions this plan refused to make on its own; all are now answered, each with the consequences the build must honour. Nothing in this document is a guess, and nothing outside section 12 assumes an answer to a question section 12 asks.

**This document is written to be picked up cold, one phase at a time, with no memory of the phase before it.** Everything a session needs to know about what has already happened is in §0. Everything a session learns that the next one would need is written back into §0 before it finishes. If you are reading this with no context, you are the intended reader and nothing is missing.

---

## 0. Start here

**You are picking up a planned rebuild of the progressive-overload engine, one phase at a time. This document is the complete brief; it assumes no conversation history.** It is long because the engine is the reason the app exists, and because two independent reviews found about thirty defects in an earlier draft that read as finished.

### Build state

The single source of truth for where the work stands. **Read this before anything else, and update it before you finish** (see "Leaving the doc for the next phase" below).

Phases are listed in **build order**, which is not numeric order. The swap is deliberate and explained in section 11.

| Phase | Delivers | Status |
|---|---|---|
| **0** | Prerequisites: `P-1`, `P-2`, `D-6` | **Done.** Branch `phase-0/progression-prerequisites`, 5 commits. Migrations `0046`, `0047`. |
| **1** | Honest effort: `rpe` nullable, stop forging 7 | **Done.** Branch `phase-1/honest-effort`, 7 commits. Migration `0048`. |
| **3** | Session windows and scope | **Done.** Branch `phase-3/session-windows-and-scope`, 4 commits. Migration `0049`. |
| **2** | Capture: the miss sheet and the reps-correction fix | **Done.** Branch `phase-2/capture`, 4 commits. No migration. |
| **4** | Rep ranges and double progression | **Next.** Not started. |
| **5** | Axes, presets, and the sheet | Not started. |
| **6** | The rest | Not started. |

**Branches.** `main` → `fix/progression-never-lowers-plan` (the audit, one predating bug fix, and this plan; 20 commits, **not pushed**) → `phase-0/progression-prerequisites` (5 commits, **not pushed**) → `phase-1/honest-effort` (7 commits, **not pushed**) → `phase-3/session-windows-and-scope` (4 commits, **not pushed**) → `phase-2/capture` (4 commits, **not pushed**). One phase per branch, each branched off the last. Nothing has been pushed yet, so nothing is deployed and no migration has run outside a throwaway container.

### What is already true in the code

Facts a cold session must not re-derive, re-decide, or accidentally undo. Each is the settled outcome of a shipped phase.

*From phase 0:*

- **A logged set is keyed to its plan slot, not its exercise.** `workout_sets` carries `program_exercise_id` and `program_set_id`, and the unique index is `(session_id, program_exercise_id, set_number)`. Clients pass the program set id they already hold; the server resolves the slot in `logWorkoutSet`, rejecting one that belongs to another program, and falls back to the old exercise-based resolution for payloads queued by a cached bundle. Both new foreign keys are `on delete set null`, deliberately not the `cascade` the older ones use — every read must tolerate a null.
- **A logged set describes its own prescription.** `workout_sets` carries `set_type` and `prescribed_working_sets`, snapshotted at log time. Phase 3 asks its clearance questions of these columns, never by joining back to `program_sets` and reading today's plan.
- **The cycle no longer writes `target_reps`.** `strengthPhaseRecipe` and the `sessionRole = "strength"` branch are deleted; progression owns the column outright. The research is preserved in [`specs/cycle-periodization.md`](specs/cycle-periodization.md) under "Strength periodization: considered, not implemented".
- **`P-3`'s both-shapes rule is live and has two worked examples.** The log and un-log validators take the new `programSetId` as *optional*, and the log validator takes `rpe` as optional, precisely so a bundle cached before phase 0 or phase 1 — and every payload already sitting in the offline queue — keeps working. Every later phase that changes the logging payload owes the same treatment; `P-3` in section 14 is the standing rule, not a one-off.

*From phase 1:*

- **A logged set records effort only when the lifter reported it.** `workout_sets.rpe` is nullable, null means "not logged", and no call site forges a value. **Do not restore a default anywhere.** A `?? 7` in a read is the exact bug this phase removed, and it will look like a harmless convenience. Legacy rows carrying a real 7, and payloads from clients that still send one, are stored as a real 7 — indistinguishable on the wire, and not ours to rewrite.
- **Effort no longer gates clearing, and there is no absolute RPE ladder.** `isConfidentHit` is gone; `metTargetReps` is the whole test. `D-1`'s cap is how effort gates again, per set and opt-in, and phase 5 builds it — `B-22` first, since the history query still does not select `target_rir`. Do not reintroduce a global threshold in the meantime.
- **`held-unknown` exists and every consumer handles it, but nothing emits it.** The engine gains an emitter in phase 5 with the cap. Section 15's `B-2` records which sites needed changing and which did not.
- **Aggregate effort reads mean "of the sets that reported effort".** The cycle adaptation average filters nulls through `meanLoggedRpe` (summing straight through coerces null to 0 and *raises* volume); the RPE trend chart and the cooked-exercise count exclude them in SQL and say so in their labels.
- **Seeded history logs effort about two-thirds of the time and carries its plan slots.** All three seeders. Do not make seeded effort universal again: an account where every set has a value never exercises the unknown paths.

*From phase 3:*

- **The window is sessions, not rows for one set number.** `getProgressiveSuggestions` ranks each plan slot's completed sessions with `DENSE_RANK` and keeps the last `CONSENSUS_WINDOW` of them, so every exercise gets its own five sessions however large the program is. `buildSuggestion` takes `SessionHistory[]`, not `HistoryRow[]`. Do not reintroduce a global `LIMIT` across slots: that was `SI-D6`, and it starved the window on long programs.
- **`program_exercises.progression_scope` names the sets that decide clearing** — `all`, `first`, `last` or `set`. It is `not null default 'all'`, so every existing exercise moved to `all` (`D-3`). Scope `set` is the old per-set-number behaviour, kept for exercises whose sets genuinely differ. **There is no picker yet**; the sheet states the rule and phase 5 builds the control.
- **A session is `cleared`, `missed` or `unknown`, and unknown is inert.** Fewer sets logged than the session prescribed, or a `Tired` session that fell short, is unknown: it neither banks a clear nor counts toward a back-off, and it does not reset the gate. It still consumes a slot in the window. Clears are consecutive (`D-11`) and misses are consecutive too — the deload guard reads `countConsecutiveMisses`, and dropping that would deload a whole 4x12 for one short set three sessions running.
- **Tired sessions are in the window now.** The blanket `feeling IS DISTINCT FROM 'Tired'` filter is gone (`A6`); a Tired session's clears count, its misses are held harmless, and it supplies the "Last: …" numbers. Do not restore the SQL filter.
- **Under scope `all` the exercise moves as one.** Every working set of a slot is judged against the same window, so they get the same advance. `currentLoad` is the *maximum* across the session's working sets deliberately: plans that already drifted apart are levelled up by the first advance rather than proposing a downgrade the plan floor would refuse.
- **The dots are tappable and explain themselves.** `SetSuggestion.sessions` carries the window session by session, and the sheet in `WorkoutSetsList.tsx` renders it. `D-7`'s strictness depends on that view existing (`E-8`); do not drop the field when reshaping the suggestion.
- **The rule sentence says "in N sessions in a row", and names the scope.** `describeProgressionRule` now describes the rule the engine applies. `e2e/progression-settings.spec.ts` asserts that wording.
- **Seeded sessions sometimes drop their last set.** Roughly one exercise in eight, in all three seeders, so a development account actually produces unknown sessions. Do not make seeded sessions complete again.

*From phase 2:*

- **`actual_reps` is what the lifter reported.** A short tap still writes the target — that is the claim the tap makes — but every path now prefers a recorded achieved count: the tapped set, the catch-up sets, a set re-logged after an edit, and the exercise-level checkmark. `A1` is closed. Do not reintroduce `actualReps: targetReps` as an unconditional write anywhere.
- **The set editor's reps field no longer moves the prescription.** During a workout it records reps achieved and `target_reps` stands; in program-edit mode it is still the prescription, and the label says which. This was the trap that let a correction log a perfect hit against a target the lifter had just lowered.
- **A long press on the set toggle opens the miss sheet** — reps achieved (pre-filled with the target) and RIR (pre-selected to nothing). The achieved reps are passed *into* `toggleSet` rather than read back off the override, because the override write and the log happen in the same tick and React state has not caught up. Anything else that logs from a freshly written override owes the same treatment.
- **`SetOverride.actualReps` is independent of `isFailed`.** Coming up short is not the same as going to failure, and only the second implies RIR 0. The old comment tied them together.
- **The finish flush is safe now, and was not before.** `programs/[id]/workout/finish/page.tsx` writes every override's `targetReps` back to the program template when the workout ends, so a reps correction used to lower the *plan* permanently, not just that session. Nothing about the flush changed; it stopped being harmful because the override no longer carries a lowered target.
- **The set row shows what was done beside what was asked for.** Without it a set logged short is pixel-identical to one that went to plan, and the capture is invisible to the person who did it.
- **The exercise-level checkmark writes through the offline queue** (`useWorkoutSetWriter`) and reads the session overrides, like the set list. It used to call the Server Action directly, ignore the result, and overwrite the overrides with the program's planned values.
- **The logging payload did not change shape**, so `P-3` needed no work: `actualReps` was always required and always accepted any count. A payload queued by a pre-phase-2 client replays as a set that hit its target, which is exactly what that client claimed.

*Still true, and still wrong — these are the phases ahead, not oversights:*

- There is no rep range, so double progression cannot be expressed. That is phase 4.
- No exercise can carry an effort cap, so `D-1` does not gate anything and nothing emits `held-unknown`. That is phase 5, and `B-22` comes first.

### Carry-forward: things every phase still owes

- **The Playwright e2e suite has never run on any of these branches.** The webkit browser binary is not installed and an earlier install stalled while holding the cache lock. Resolve with `./node_modules/.bin/playwright install webkit` (kill any stale install process first) before pushing anything that touches the set list. Phases 0, 3 and 2 all touched it, and phase 2 added `e2e/miss-sheet.spec.ts`, which has therefore never run.
- **The `CLAUDE.md` smoke pass is owed for phases 0, 1, 3 and 2** and for every later phase touching the set list (5 and 6 both do). It needs `make dev` running, which is the user's call to start. Phase 3 is the one that most wants it: the new history query has never run against a real database, and no unit test executes SQL. Its rendered statement was checked by hand through `toSQL()`, which proves it parses, not that it returns the right rows.
- **Migrations `0046` to `0049` have not run against a real database.** They are generated, committed and reviewed; nothing has been applied outside a throwaway container. `0048` is a single `DROP NOT NULL`; `0049` is a single `ADD COLUMN … NOT NULL DEFAULT 'all'` whose default *is* the backfill.
- **`E-13` has no owner.** Changing scope or the gate re-judges the existing window under the new rule, so the dot count moves when a lifter touches a setting. Phase 3 did not build the config-version stamp `E-13` asks for, and it is not live yet because nothing can change the scope from the UI — but phase 5 ships the picker, and it owes this. Section 11 does not assign it to a phase; assign it there when phase 5 starts.
- **Three release notes are owed at the end, and none of them is a code change.** Phase 1 retired the RPE ladder, so exercises a lifter grinds will start bumping. Phase 3's `D-3` now holds exercises that were quietly banking per-set counts, and the same phase stopped dropping Tired sessions, so a lifter who reports fatigue will see their numbers move again instead of freezing. Phase 2 has now made the third due (`B-4`): volume has always been planned volume relabelled as achieved, so every volume number in the app falls for anyone who misses a rep, starting the day this ships.

### Read in this order

1. **This section (§0) in full.** It is the handoff.
2. **Section 11, your phase's paragraph**, and every section it names. Section 11 is the per-phase brief; it says what is in scope and what must land in the same change.
3. **Sections 14 and 15, filtered to your phase.** 14 holds the prerequisites (`P-1` to `P-3`) and nineteen pre-specified edge cases; 15 traces twenty-three consumers outside the engine, each tagged with the phase that breaks it. Neither is optional, but neither needs reading end to end for a single phase.
4. **Sections 1 to 10 and 12** as reference. Section 2 is the model, section 7 is the engine pipeline, section 12 is the decisions. Read the whole document once if this is your first phase; after that, read what your phase touches.
5. [`specs/smart-incrementation.md`](specs/smart-incrementation.md) — how the engine behaves today. Accurate against the code, and the reference until phase 5 rewrites it.
6. `src/lib/utils/progression.ts` (the engine), `src/lib/actions/workout-sets.ts` (`getProgressiveSuggestions` and the history query), `src/components/features/WorkoutSetsClient.tsx` and `WorkoutSetsList.tsx` (two of the consumers).
7. `BACKLOG.md`, section "Progression engine audit", for the detail behind each finding.

### Leaving the doc for the next phase

The next session starts with no memory of yours. It gets exactly what you write here, so treat this as part of the phase, not paperwork after it. Before you call a phase done:

1. **Move your phase's row in the Build state table** to Done, with the branch name, commit count and any migration numbers.
2. **Add what your phase made true** to "What is already true in the code", in the same voice: the settled fact, and the thing a later phase might undo by accident. Delete the matching line from "Still true, and still wrong".
3. **Update Carry-forward.** Add anything you left owed; delete anything you discharged. An empty entry is better deleted than left saying "still outstanding".
4. **Mark the section 11 paragraph and the section 14 or 15 entries your phase closed**, so the next session does not re-read work that is finished. Phase 0's rows show the format.
5. **Record anything you learned that contradicts the plan.** If a decision or an edge case turned out wrong in the code, change it in section 12 or 14 and say so — do not work around it silently. That instruction is the whole reason this document is trusted.
6. `pnpm verify` must pass, `check:docs` included.

### Decisions: all eleven are made. Do not re-ask them.

Section 12 holds `D-1` to `D-11` with the consequences each binds the build to, several of which are not derivable from the one-line answer. Read the section, not just this table.

| | Decision |
|---|---|
| `D-1` | A prescribed RIR gates clearing, on capped exercises only. Uncapped exercises clear on target alone. |
| `D-2` | Unlogged effort on a capped exercise is unknown: neither clear nor failure, but it still ages the window. |
| `D-3` | Existing exercises migrate to scope `all`. This visibly changes progression for everything already in the app. |
| `D-4` | `smart` mode is retired. `adjustedRepsForWeight` is deleted; `estimated1RM` survives as a gated display value. |
| `D-5` | Stale after 21 days; a re-approach proposes the last logged load, less ten percent. |
| `D-6` | Delete the cycle's strength-phase branch. Progression owns `target_reps`. Preserve the research in the cycle spec. |
| `D-7` | Scope `all` means literally every working set. No `n_of_m`. |
| `D-8` | The set that decides clearing also decides effort. The floor follows the scope. |
| `D-9` | A partially logged session is unknown: no gate credit, no back-off credit. |
| `D-10` | PRs predating honest logging are kept and flagged unverified, never deleted. |
| `D-11` | The gate is **consecutive** clears. A miss resets it; an unknown session does not. |

If one turns out to be wrong once you are in the code, say so and get it changed in section 12. Do not work around it silently.

### Build order

**`0, 1, 3, 2, 4, 5, 6`.** The swap is deliberate and explained in section 11: shipping honest reps (phase 2) while the engine is still per-set would deload set 4 of every straight-set exercise. Phase numbering is kept stable so references do not move.

One phase per branch, named `phase-N/<what-it-does>`. Because nothing is pushed yet, each phase branches off the previous phase's branch rather than off `main`; once they start landing, branch off whatever carries the phase before yours. Do not start a later phase before the earlier one exists: the order is data dependency, not preference.

`pnpm verify` after every phase. The smoke pass in `CLAUDE.md` after any phase touching the set list — phases 1, 2, 3, 5 and 6 all do.

### How not to repeat the mistakes this plan already made

`pnpm verify` runs `pnpm check:docs`, which verifies every `file:line` citation and symbol name in `docs/` against the code. It exists because an earlier draft of this document cited a function that has never existed and two review passes missed it. When you touch a doc, that check must pass.

The rules it cannot enforce are in `CLAUDE.md`: never cite a file you have not opened at that line; run the check rather than reasoning about it when it is runnable; verify a finding before relaying it as fact, including one from a subagent.

### The one thing to hold onto

**A tap records a claim the lifter made. Silence records nothing.** Most of what is wrong with the engine today comes from inventing an effort value nobody supplied. Judge every design choice against that.

---

## 1. Why this needs rebuilding, not patching

Four problems, in order of severity. Each is recorded in `BACKLOG.md` with file references.

**The engine has never seen a missed rep (`A1`). Closed by phases 1 and 2** — the forged effort value went in phase 1, the forged rep count in phase 2. The paragraph below describes the state this plan started from, and is kept because it is the clearest statement of why the rest of the plan exists. Tapping the set toggle writes `actualReps = targetReps` and, until phase 1, a hardcoded `rpe: 7`. There are **five such call sites across three files**, not one path: `WorkoutSetsList.tsx:321` (catch-up) and `:349` (the toggle), `SetEditView.tsx:296` (re-log on edit), and `WorkoutExerciseList.tsx:125` and `:137` — the exercise-level "complete all sets" checkmark, which fabricates reps and effort for a whole exercise in one tap **and bypasses the offline queue**. RPE 7 is inside the "confident" band, so every logged set is a confident hit, the consensus window saturates, and the progress dots read 2 of 2 forever. Deload (`SI-17`) and rep-retry (`SI-19`) are unreachable in production. The observable behaviour is "add the increment every other session, indefinitely", which is what prompted this work.

The forged effort value is the real offence. Assuming you hit the target when you tap a "done" control is a claim you made. Assuming you had three reps in reserve is a claim nobody made. Section 6 keeps the first and removes the second.

One qualifier, so the claim is exact: the *Mark failed* path in `SetEditView.tsx:268` does record real reps and `rir: 0`. The engine can therefore see a miss the lifter went out of their way to declare. It has never seen one it was not told about, which is the point.

**The seven modes conflate two different questions.** `progressionMode` mixes *which dimension moves* (weight, reps, seconds, metres) with *what scheme is running*. Both of the schemes below are "weight" mode, and the app cannot tell them apart:

- Fixed 12 reps, add load when you clear it, expect to fail sometimes.
- Range 6 to 8, climb the reps, then add load and drop back to 6.

**The gate is per set, not per session (`A8`).** History is keyed on `exerciseId + setNumber`, so on 4x12 each set banks its own count and the plan can ratchet to 62.5 / 60 / 60 / 60. Straight sets are the common case and the model does not represent them.

**There is no rep range (`A4`).** `program_sets` holds `target_reps` and nothing else, so double progression, the most widely run hypertrophy scheme there is, cannot be expressed at all.

---

## 2. The model

One machine. Eight axes. Everything else in this document is either a value for one of these axes or a consequence of them.

| # | Axis | Values | What it answers |
|---|---|---|---|
| 1 | **Measure** | `reps` / `duration` / `distance` | What the set is prescribed in. Derived from the exercise, never chosen directly. |
| 2 | **Target** | fixed value, or range `min`-`max` | What you are trying to clear today. |
| 3 | **Effort floor** | none, or RIR 0-5, **per set** | Whether clearing also requires reps left in reserve. Lives on `program_sets.target_rir`. Named "cap" in the UI and the schema, but it tests `logged RIR >= target_rir`, so it is a **minimum reserve**, not a ceiling. A set prescribed RIR 2 that came in at RIR 5 clears and gets one increment, when it should get a much larger jump; the engine cannot see "far too light" except through the manual `was_easy` tap. Do not implement it as a ceiling. |
| 4 | **Scope** | `all` / `first` / `last` / `set` | Which sets must clear for the *session* to count. |
| 5 | **Gate** | 1-5 sessions | How many qualifying sessions inside the 5-session window before anything moves. |
| 6 | **Advance** | `load` / `reps` / `double` / `duration` / `distance` / `none` | What moves when the gate is met. |
| 7 | **Regress** | `hold`, or back off *p*% after *n* failed sessions | What happens when you keep missing. |
| 8 | **Readiness** | `ignore` / `hold` / `reduce` | What a low pre-workout readiness score does to all of the above. |

The through-line: **a session either clears or it does not (axes 1-4), you need N clears to move (axis 5), and then a defined thing moves (axis 6).** Regress and readiness are the two ways that pipeline gets interrupted. Every named scheme in section 3 is a row of values across these eight columns, and the configuration UI in section 8 is a preset picker over those rows.

### Why these axes and not others

Axis 4 exists because "did the workout clear?" and "did this set clear?" are different questions and the app currently only asks the second. Axis 3 exists because `target_rir` is already in the schema and already shown to the lifter (`format.ts:56` renders `@2 RIR`; `SetEditView` sets it), but **no progression code reads it** (`A2`) — and `getProgressiveSuggestions` does not even select it, so wiring it up is a query change, not just an engine change (`B-22`). Axis 7 exists because deload is currently hardcoded at 3 consecutive misses and 10%, with no way to say "never back off, I will handle it".

Axis 1 is derived rather than chosen because letting someone select "duration" on a barbell row produces a set that cannot be logged. It follows the exercise's own type, as it does today.

---

## 3. Coverage: the schemes people actually run

The test of the model is whether it expresses what lifters do without a special case per scheme. Each row below is a preset: a named set of axis values, offered in the picker.

| Preset | Target | Effort cap | Scope | Gate | Advance | Regress | Who runs this |
|---|---|---|---|---|---|---|---|
| **Linear load** | fixed | none | all | 1 | load | -10% after 3 | StrongLifts 5x5, whose reset rule this matches exactly. Calling it Starting Strength is a stretch: SS has no automatic reset, and both use per-lift increments (5 kg lower, 2.5 kg upper) that the adaptive ladder only approximates through the compound flag (`A3`). |
| **Load, confirmed** | fixed | none | all | 2 | load | -10% after 3 | Fixed rep count, prove it twice before moving. Slower and steadier than linear. |
| **Double progression** | range | none | all | 1 | double | -10% after 3 | The standard hypertrophy scheme. 3x8-12: add reps to the top of the range, then add load and reset to the bottom. |
| **Double progression, top set** | range | none | first | 1 | double | -10% after 3 | Top set drives progression, back-offs follow. |
| **Autoregulated** | fixed or range | RIR 1-3 | all | 2 | load or double | -10% after 3 | RPE/RIR-based training. Load only moves when the prescribed reps came with the prescribed reserve. **Regress is not `hold`:** auto-deloading when effort runs hot is the main reason to train this way, and this is the only preset that can detect a grind. Giving it `hold` would be the one scheme able to see the problem and forbidden from acting. |
| **Rep ladder** | fixed | none | all | 1 | reps | hold | Bodyweight work with no load to add. Chin-ups, push-ups. Needs `E-17`'s ceiling and zero-increment fix, or it climbs to 40 reps and, out of the box, never moves at all. |
| **Duration** | fixed or range | none | all | 2 | duration | hold | Planks, holds, carries, steady cardio. |
| **Distance** | fixed or range | none | all | 2 | distance | hold | Running, rowing, endurance. |
| **Manual** | any | any | n/a | n/a | none | n/a | Shows what you did last time, proposes nothing. |
| **Off** | n/a | n/a | n/a | n/a | none | n/a | No suggestions, no chips, no dots. |

Any axis can be edited after picking a preset, at which point the exercise is labelled **Custom** and the plain-English sentence (section 8) still describes it exactly.

### Explicitly out of scope, and why

Stating this matters as much as the table above. These are real schemes that this engine will *not* express, so nobody has to guess whether they are missing or unbuilt.

| Scheme | Why not |
|---|---|
| **Percentage of training max** (5/3/1, Texas Method) | Load comes from a training max that updates per block, not from the last session. Needs a `training_max` per exercise and a block-level update rule, which belongs in the cycle engine ([`specs/cycle-periodization.md`](specs/cycle-periodization.md)), not here. Candidate for a later plan. |
| **Volume progression** (add a set) | This engine writes values onto existing sets. Adding or removing sets changes the plan's shape, which is a different mutation with its own UI. |
| **Density progression** (same work, less rest) | `rest_time_seconds` is on the set and could be progressed, but nothing currently reads rest as a performance measure, so there is no signal to gate on. |
| **Velocity-based** | No bar-speed input exists and none is planned. |
| **Wave / block loading** | Already owned by the cycle engine (`PZ` rules). Section 9 covers the boundary. |
| **AMRAP-driven progression** | An open-ended final set whose rep count sizes the next jump (5/3/1 PR sets, GZCL). Clearance here is binary against a target, so "how far past" cannot drive anything. Open-ended sets still *clear* (section 7 step 4) — they just cannot steer. |
| **Back-offs as a percentage of the top set** | `E-3` applies one absolute increment to every working set, so a 100 kg top set and its 80 kg back-off drift apart by design. This is the natural partner to scope `first` and is the most likely first extension. |
| **Beat-last-week schemes** | Same root as AMRAP: clearance is measured against a prescription, not against the previous session's performance. |

---

## 4. Worked examples

The two schemes that prompted this, traced end to end.

### 4a. Fixed 12 reps, four sets, bump when two full workouts clear

Configuration: preset **Load, confirmed**. Target fixed 12, no effort floor, scope `all`, gate 2 **consecutive** (`D-11`), advance `load` (+2.5 kg), regress -10% after 3.

| Session | Set 1 | Set 2 | Set 3 | Set 4 | Session clears? | Dots | Suggestion |
|---|---|---|---|---|---|---|---|
| 1 | 12 | 12 | 12 | 12 | yes | 1 of 2 | held at 60 |
| 2 | 12 | 12 | 12 | **10** | **no** | **0 of 2** | held at 60 |
| 3 | 12 | 12 | 12 | 12 | yes | 1 of 2 | held at 60 |
| 4 | 12 | 12 | 12 | 12 | yes | 2 of 2 | **+2.5 kg on all four sets** |
| 5 | 12 | 12 | 12 | 12 | yes (at 62.5) | 1 of 2 | held at 62.5 |

Session 2 is the case the current engine cannot see at all: set 4 fell short, and today that is recorded as 12 and counted as a confident hit. Under this plan the dots **empty**, and you can watch it happen.

Two rules are doing the work here, and both are easy to lose in implementation:

- **`D-11`, consecutive clears.** Session 2's miss resets the count to zero, so the bump lands at session 4 rather than session 3. An earlier draft of this table had the miss merely *not add* to the count and bumped at session 3; that is not "two full workouts" and it is not what was asked for.
- **`SI-11`, clears count only at the current load or heavier.** Session 5 reads 1 of 2, not 3 of 2, because the clears at 60 do not count once the load is 62.5. Without this the exercise would bump every session forever, which is the bug the whole plan exists to fix.

Also settled here: `SI-11` means the window is effectively bounded by the last load change, and `D-11` means it is bounded by the last miss. Neither ever needs to look further back than that.

### 4b. Range 6 to 8, climb then reset

Configuration: preset **Double progression**. Target range 6-8, scope `all`, gate 1, advance `double` (+2.5 kg), regress -10% after 3.

The prescription reads **8** throughout the climb. You are not told to do 6, then 7, then 8; you are told to do 8 and you get there when you get there.

| Session | Prescription | Result | Session clears? | Advance |
|---|---|---|---|---|
| 1 | 3x8 @ 80 | 8, 7, 6 | no | none |
| 2 | 3x8 @ 80 | 8, 8, 7 | no | none |
| 3 | 3x8 @ 80 | 8, 8, 8 | yes | **+2.5 kg, prescription resets to 3x6 @ 82.5** |
| 4 | 3x6 @ 82.5 | 6, 6, 6 | yes (target is 6) | prescription climbs toward 8 at the new load |

Row 4 is the subtlety: after a reset the target is `rep_range_min`, so the first session at the new load clears immediately. That is correct — the point of the reset is that the new load is workable — and it is why `double` pairs naturally with gate 1. With a higher gate the reset session would bank a clear it does not deserve, so **`advance: double` should use gate 1** unless the lifter deliberately wants two sessions at the bottom of each range.

An earlier draft of this table showed the prescription itself walking 6, 7, 8. That is a rep ladder bounded by a range, not double progression, and it has a concrete failure: `metTargetReps` is `actualReps >= target`, so a lifter doing 12/10/9 against a target of 8 clears and the target advances by exactly one, permanently lagging what they can actually do.

---

## 5. Data model

### `program_sets`

| Column | Change | Notes |
|---|---|---|
| `target_reps` | unchanged | Stays "what you are trying to hit today". When a range is set the scheme moves this value between the bounds. Everything that reads it (display, logging, PR comparison, cycle sync) keeps working untouched. |
| `rep_range_min` | **new**, nullable int | Bottom of the range. Null means fixed target. |
| `rep_range_max` | **new**, nullable int | Top of the range. Null means fixed target. |
| `target_rir` | unchanged, newly **read** | Becomes axis 3. Already exists and is rendered in set summaries; no *progression* code reads it and `getProgressiveSuggestions` does not select it (`A2`, `B-22`). |

Constraint: `rep_range_min` and `rep_range_max` are both null or both set; when set, `min <= target_reps <= max`. Enforced in the Zod validator and asserted in the engine.

### `program_exercises`

| Column | Change | Notes |
|---|---|---|
| `progression_mode` | **retired** after migration | Replaced by `progression_preset` plus the axis columns. See section 10. |
| ~~`progression_preset`~~ | **not added** | Cut on review. It would be display-only by this table's own admission, fully derivable from the axis values, and a second copy of state the engine does not read — which is precisely the failure that left `target_rir` dead for a year (`A2`). Derive the label at render time: match the axis values against the preset table in section 3, and show **Custom** when nothing matches. |
| `progression_scope` | **new**, text, default `all` | **Done, phase 3** (migration `0049`), `not null`. `all` / `first` / `last` / `set`. |
| `progression_advance` | **new**, text | `load` / `reps` / `double` / `duration` / `distance` / `none`. |
| `progression_regress` | **new**, text, default `backoff` | `hold` / `backoff`. |
| `progression_backoff_pct` | **new**, int, default 10 | Only read when regress is `backoff`. |
| `progression_backoff_after` | **new**, int, default 3 | Consecutive non-clearing sessions before backing off. |
| `progression_readiness` | **new**, text, default `hold` | `ignore` / `hold` / `reduce`. |
| `progression_required_hits` | unchanged | Axis 5. Null still means the shared default. |
| `overload_increment_kg` | unchanged | Null still means "unset, use the adaptive ladder". Do not give it a default (`SI-1`). |
| `overload_increment_reps` | unchanged | Still triple-duty (reps / seconds / metres) by measure. Documented as a trap in `SI-32`; splitting it is a separate migration and not required here. |
| `progression_apply_to_plan` | unchanged | The ratchet opt-in. |

Six new columns is a lot, and the alternative is a single `progression_config` JSON blob. Columns win: they are validated by the database, queryable, and cannot drift into holding keys nothing reads, which is exactly how `target_rir` became dead weight. The count is a symptom of the feature genuinely having eight axes, and presets mean almost nobody sets them individually.

### `workout_sets`

| Column | Change | Notes |
|---|---|---|
| `actual_reps` | unchanged | Must start carrying real values. See section 6. |
| `rir` | unchanged | Already nullable. |
| `rpe` | **made nullable** | **Done, phase 1** (migration `0048`). Null means "not logged", distinct from any effort value. |
| `is_failed` | unchanged | Stays as the explicit "attempted and missed" marker. |
| `was_easy` | unchanged | Keeps working as the gate bypass (`SI-13`). |

**Five migrations total**, not three (`0046`, `0047` and `0048` shipped, and `0049` carries the first of the axis columns): rep range columns, progression axis columns, `rpe` nullable, plus the two in section 14 — `set_type` and the prescribed-set-count snapshot on `workout_sets` (`P-1`), and `program_exercise_id` with a **unique index replacement** on `workout_sets` (`P-2`). Two of the five land on the busiest write path in the app, which is why they get their own phase. Each generated with `pnpm db:generate` and committed with its schema change, per `CLAUDE.md`.

---

## 6. Capture: making the data honest without slowing the workout

This is the foundation. It is also where a wrong move ruins the everyday flow, so the principle is explicit:

> **A tap records a claim the lifter made. Silence records nothing.**

Tapping the set toggle is an affirmative "I did the prescription", and continuing to write `actualReps = targetReps` from it is honest. Writing `rpe: 7` from the same tap is not: it invents an effort report nobody gave. So:

**Change 1: stop forging effort. Built in phase 1.** All five call sites listed in section 1 stop sending `rpe: 7` — including the exercise-level checkmark, which is the easiest one to miss and the one that fabricates the most data per tap. `rir` and `rpe` go in null. The engine treats null effort as *unknown*, which is neutral: it neither satisfies an effort cap nor blocks a target-only gate. Exercises with no effort cap are unaffected. Exercises with a cap do not progress until effort is actually logged, which is correct: you asked for a condition and did not supply it.

**Change 2: a fast way to say "I missed it". Built in phase 2.** Long-press the set toggle to open a compact sheet with two controls, reps achieved (stepper, pre-filled with target) and RIR (six buttons, pre-selected to nothing). Short tap is unchanged, so the common case costs nothing. This replaces "open the set editor, find Mark failed" as the only miss path.

**Change 3: one effort prompt per exercise, not per set. Not built — it waits for phase 5's cap.** When an effort cap is prescribed and the last working set of an exercise is logged, an inline row appears under the exercise: *"Last set, how much was left?"* with 0 / 1 / 2 / 3 / 4+ and a skip. One tap per exercise, roughly five per workout. Only shown when the exercise actually has a cap, so the setting you chose is the thing that adds the tap.

**Change 4: fix the reps-correction trap. Built in phase 2.** Editing the reps field in `SetEditView` during a workout currently writes `targetReps`, so correcting "I got 6, not 8" silently lowers the prescription and then logs a perfect hit against it (`SetEditView.tsx:270`). In a live session that field must write `actualReps` and leave the target alone. In program-edit mode it keeps writing the target.

Net cost to a normal set where everything went to plan: zero extra taps. Net cost to a set that fell short: one long-press instead of a trip through the editor.

---

## 7. The engine

`buildSuggestion` is rewritten around the axes. Evaluation is a pipeline, and unlike today the order is stated rather than discoverable only by reading top to bottom.

1. **Guard.** Non-working set, or advance `none`: return nothing.
2. **Assemble the window.** The last 5 *completed* sessions for this exercise, each carrying every working set logged in it and the count of working sets prescribed at the time (`P-1`). Not the last 5 rows for one `setNumber`. This is the change that makes axis 4 possible and closes `SI-D6` (the global `LIMIT` starvation) by querying per exercise with a window function.

    Two filters from `SI-8` must survive the rewrite, and are stated here because a new query is exactly where they get dropped. **In-progress sessions are excluded**, which is what makes an "easy" verdict affect the next workout rather than the current one. **Tired sessions** are no longer excluded outright: per `A6`, a Tired session's *misses* are ignored (it cannot count toward the back-off streak) but its clears still count and it still supplies `latest` for the base value and the "Last:" line. The old blanket exclusion (`workout-sets.ts:1229`) meant honest self-reporting froze progression and showed stale numbers; that is what `A6` asks to fix, and phase 3 is where the query changes anyway.
3. **Staleness.** If the most recent session is older than the staleness threshold, return a re-approach suggestion. Closes `A10`, where a three-month layoff currently still offers a bump.
4. **Clearance per session.** For each session in the window, decide clear / not clear / unknown:
   - Each working set clears when it met its target for the measure, and, when an effort cap is prescribed, logged RIR is at least the cap (`D-1`, operative rule in `D-8`).
   - **A set with no target at all clears on any completed rep.** This is `SI-9`'s open-ended-set rule and it is easy to lose in a rewrite that defines clearing as "met its target". Open-ended sets must not become permanently ineligible. Note this only preserves today's behaviour: a true AMRAP *scheme*, where the rep count drives the size of the next jump, is not expressible and is listed in section 3's exclusions.
   - Effort unknown with a cap prescribed makes the *session* unknown, not failed. Unknown sessions neither count toward the gate nor toward regression.
   - The session clears when the sets required by axis 4 all cleared.
5. **Regress.** If axis 7 is `backoff`, the last *n* sessions all failed to clear, **and the window holds zero clearing sessions**, suggest `-p%` from the current load and stop. Unknown sessions (`D-2`, `D-9`) count as neither.

    The second clause is `isStuck`'s existing `hitsWithConfidence.length === 0` guard (`progression.ts:536`) and must not be dropped. Without it, `D-7`'s strictness turns one rep short on set 4 into a failed session, and three of those in a row would deload all four sets by 10% — which is the normal state of a 4x12 block, not a stall. It would also make **skipping** set 4 strictly better than grinding it: a skip is `unknown` and inert, a grind is a failure that compounds. That inverts section 6's founding principle, so the guard is not optional.
6. **Recover.** If the last session's load was below the one before it and that drop was not a back-off, offer the earlier load back and stop. This is today's `SI-18`, kept.
7. **Gate.** Count cleared sessions in the window, **counting only sessions logged at the current load or heavier**. This is `SI-11` (`progression.ts:506`) and it is load-bearing: without it, the two clears at 60 that earned a bump to 62.5 stay in the window and immediately earn another. Table 4a session 4 shows 1 of 2 precisely because of this rule, so an implementation that drops it fails its own fixture (`E-11`). Under a gate of 1 it is worse still: clear-at-60, fail, fail would propose a bump after two consecutive failures.

    Below the gate, hold. `was_easy` still satisfies the gate on its own (`SI-13`, kept), scoped per `E-6`.
8. **Advance.** Apply axis 6:
   - `load`: current load + increment, snapped to the increment grid. **"Current load" under scope `all` is the maximum across the exercise's working sets**, not the minimum and not per set. `D-3` declines to re-level plans that have already drifted (62.5 / 62.5 / 60 / 60), so the four sets can legitimately disagree; taking the max levels them up on the first advance, which is the outcome a lifter wants and the only one `SI-37`'s floor will accept. Taking the min would propose a downgrade for set 1, which the floor rejects, leaving the exercise permanently pending. The same rule fixes the load comparison in step 7's `SI-11` clause.
   - `reps`: target + rep increment.
   - `double`: **the prescription is the top of the range for the whole climb.** `target_reps` stays at `rep_range_max` and the load moves only when every scope-determining set reaches it; the advance is then load + increment with `target_reps` reset to `rep_range_min` and climbing back by performance, not by prescription.

     This is the correction of an earlier draft that moved `target_reps` up one rep per session (6, then 7, then 8). That is a rep ladder bounded by a range, not double progression, and it has a specific failure: `metTargetReps` is `actualReps >= target`, so a lifter who does 12/10/9 against a target of 8 "clears" and the target advances by exactly one regardless of how far they exceeded it. The prescription then permanently lags actual performance. Standard 3x8-12 prescribes 12 throughout; you log 12/10/9 and the load moves when all three reach 12.
   - `duration` / `distance`: **target** + increment, not *actual* + increment. Closes `A5`, where beating a 5 km target by 200 m permanently ratcheted the plan.
9. **Readiness.** Apply axis 8: `ignore` passes through, `hold` downgrades to held, `reduce` proposes a back-off. Clears every suggested value, including `adjustedRepsForWeight`, which closes `SI-D2`. (Under `D-4` that field is deleted outright, so this becomes moot once phase 5 lands; state it anyway, because phases 1 to 4 still carry it.)

### Reason codes

The `reason` code stays the contract between engine and both consumers (`SI-33`). The set becomes:

`advanced-load`, `advanced-reps`, `advanced-duration`, `advanced-distance`, `reset` (double progression's load-up-reps-down step), `backoff`, `retry`, `re-approach` (staleness), `held`, `held-readiness`, `held-unknown` (effort cap prescribed, effort not logged), `manual`.

Three are new: `reset`, `re-approach`, `held-unknown`. `held-unknown` matters because "you have not told me how hard that was" is a different message from "you have not cleared it enough times", and rendering both as `held` is how the current UI leaves people guessing.

Every reason must be handled everywhere it is branched on, in the same change that adds it. `SI-33` says "both consumers" and is wrong: there are **seven sites across four files** (see `B-2`), and the rule should be read as that number.

**The rename is more dangerous than the additions.** Two of those sites match on the string prefix rather than the full value: `progression.ts:766` is `reason.startsWith("progressed")`, and `:746-750` lists the four `progressed*` literals. Renaming the family to `advanced-*` makes both match nothing, so `easyOverride` (which this section says is kept) and readiness modulation (axis 8) **silently stop firing**. `reason` stays a string union so `.startsWith` remains valid and `tsc` reports nothing.

If the rename is not worth that risk, keep the `progressed*` names and add only the genuinely new codes. The names are internal; the safety is not.

### What stays exactly as it is

Worth stating so the rewrite does not quietly drop things that are correct today: the adaptive increment ladder (`SI-1` to `SI-6`, with the ordering fix from `A3`), the increment grid snapping, warm-up exclusion, the "easy" gate bypass, and the plan ratchet's floor (`SI-37`, only a back-off lowers the plan).

---

## 8. Configuration UI

The requirement is that the options are clear about what they do without adding weight to the everyday flow. Those are separate surfaces and should stay separate.

**During a workout, nothing changes** except the two capture affordances in section 6, and the dots becoming honest. No new controls on the set list.

**The progression sheet** (already exists, opened from the badge on the exercise header) becomes three layers:

*Layer 1, the preset.* A list of the named schemes from section 3, each with a one-line description. Most people stop here.

*Layer 2, the sentence.* Under the choice, one plain-English sentence generated from the actual axis values, always visible. `describeProgressionRule` already does this and is extended to cover every axis:

> "Add 2.5 kg once all 4 sets reach 12 reps in 2 of the last 5 workouts. Back off 10% after 3 workouts short of target."

> "Work 6 to 8 reps. Add a rep when all sets reach the top of the range, then add 2.5 kg and drop back to 6."

> "Add 2.5 kg once the top set reaches 8 reps with at least 2 reps in reserve, in 2 of the last 5 workouts."

This sentence is the contract with the lifter. If it cannot be written, the configuration is incoherent and the UI should not allow it.

*Layer 3, Advanced.* A collapsed disclosure exposing all eight axes. Opening it and changing anything relabels the exercise **Custom** and the sentence updates. Nothing is hidden, nothing is mandatory.

**The dots** stay where they are and finally mean something: filled dots are *sessions cleared at the configured scope*, out of the gate. Tapping them shows the last five sessions with clear / missed / not logged per session, so "why is it not progressing" has an answer on screen rather than requiring a mental model of the engine.

---

## 9. Interactions to get right

The places where this engine touches something else. Each of these is a known collision, not a discovered one.

**Cycle periodization owns anchored endurance sets.** `syncPeriodizedTargets` rewrites `duration_seconds` and `distance_meters` weekly from a peak anchor (`PZ` rules). Progression must never write those columns for a set carrying `peak_distance_meters` or `peak_duration_seconds`. Rule: an anchored set is never an advance target. This closes the `A5` half of that conflict.

**Cycle periodization may also want `target_reps`.** The `strength` branch of the sync writes `target_reps`, though nothing produces the tag that reaches it. Double progression also owns `target_reps`. Resolved by decision **D-6**: the branch is deleted and progression owns the column outright, so no arbitration rule is needed. Independent of the phases and can be done first.

**The plan ratchet.** Unchanged in structure. With scope `all`, one advance now writes every working set of the exercise in a single call rather than per set, which is what makes 4a work. The floor holds: only a back-off lowers the plan.

**PR detection.** Reads `actual_reps` for both `estimated_1rm` and `reps_at_weight` (`A11`). It becomes honest for free once section 6 lands. Separately, an estimated-1RM PR should require logged effort at RIR 2 or below, since Epley on a sub-maximal set is not a 1RM estimate (`D1`).

**Generated programs.** The LLM plan prompt describes only the old modes (`D8`). It must describe presets instead, and the import validator must accept and default the new columns.

**Offline replay.** Set logging goes through the offline queue. The long-press sheet writes through the same action, so no new path. The effort prompt in change 3 writes an update to an already-logged set, which must be queued the same way, not fired and forgotten.

---

## 10. Migration

Existing exercises must keep working with no silent behaviour change that a lifter would notice mid-programme.

| Current `progression_mode` | Becomes | Notes |
|---|---|---|
| `none` | preset **Off** | No change. |
| `manual` | preset **Manual** | No change. |
| `weight` | preset **Load, confirmed** | Gate carries over from `progression_required_hits`. Scope becomes `all` per **D-3**, which visibly changes behaviour on first load. |
| `smart` | preset **Load, confirmed** | Per **D-4**: the Epley rep-cut is retired and `adjustedRepsForWeight` deleted. `estimated_1rm` remains as a display value, gated per `SI-D1`. No exercise silently becomes double progression. |
| `reps` | preset **Rep ladder** | No change. |
| `time` | preset **Duration** | Advance changes from *actual* to *target* based (section 7, step 8). Slightly slower progression, deliberately. |
| `distance` | preset **Distance** | Same change. |

No existing exercise gets a rep range, so no exercise silently becomes double progression. Ranges are opt-in per exercise.

Historical `workout_sets` rows keep `rpe = 7` from before the change. The engine cannot distinguish those from a real logged 7. Since effort caps are opt-in and no existing exercise has one, no historical row is newly load-bearing. New rows carry null where nothing was logged.

---

## 11. Build order

Each phase ships on its own, is verifiable on its own, and leaves the app working. `pnpm verify` after every phase; the smoke pass in `CLAUDE.md` after any phase touching the set list.

This section is the per-phase brief: **read your phase's paragraph and every section it names.** A heading marked **Built** is finished and its detail is history — §0 "What is already true in the code" carries what survives from it. An unmarked heading is work still to do. When you finish a phase, mark its heading and append what shipped, the way phase 0 does below.

**Phase 0: prerequisites. Built.** `P-2` (the duplicate-slot data loss) and `P-1` (`set_type` on `workout_sets`) from section 14, plus `D-6`'s cycle-branch deletion. All three are independent of the engine and of each other, and `P-2` was losing data. Doing them first means phase 3 is not blocked behind a schema change to the busiest write path in the app.

Shipped on branch `phase-0/progression-prerequisites`: migrations `0046` (`program_exercise_id`, `program_set_id`, the unique-index move) and `0047` (`set_type`, `prescribed_working_sets`), both backfilled. `workout_sets` rows now carry the plan slot they were logged against and the prescription that was in force, so phase 3 can ask its questions of the log rather than of today's plan. Two migrations of the five in section 5 are done; three remain (`rpe` nullable, rep-range columns, progression axis columns).

**Phase 1: honest effort. Built.** Made `rpe` nullable, stopped forging 7 at all five call sites, and retired the absolute RPE ladder per `D-1`, which was the live behaviour change this phase carried: it applied to every exercise, and no exercise can carry a cap until phase 5, so a lifter logging RIR 0-1 at the target gets a bump where they used to get `held`. That is the intended end state arriving early, and it belongs in the release note alongside `D-3`'s. Added `held-unknown` and handled it at every site that branches on `reason`, so the path exists before the engine can emit it.

Shipped on branch `phase-1/honest-effort`, migration `0048` (`rpe` nullable). Three of the five migrations in section 5 are done; two remain (rep-range columns, progression axis columns). Also closed `B-1`, `B-3`, `B-11`, `B-15`, `B-16`, `B-17` and `B-18`, and discharged `P-3` for the effort payload.

**Phase 3 runs before phase 2.** Phase 2 makes reps honest while the engine is still per-set (`SI-7`) and still backs off after three missed sessions *for that set number*. Set 4 of a 4x12 is the set that misses, so honest reps first would deload set 4 of every straight-set exercise and manufacture exactly the drift `D-3` exists to remove. Phase 3 depends only on phase 0. Build in the order **0, 1, 3, 2, 4, 5, 6**; the numbering is kept for stable references.

**Phase 2: capture. Built.** The long-press miss sheet, the reps-correction fix, and the exercise-level checkmark moved onto the queue-backed writer with the session's overrides. No engine change. `e2e/miss-sheet.spec.ts` logs a short set and asserts the achieved count is what was entered and the target did not move.

Shipped on branch `phase-2/capture`, no migration — the logging payload did not change shape, so `P-3` needed no work this phase. Closes `A1` outright and the standalone checkmark entry in `BACKLOG.md`. `B-4`'s release note is now due: volume has always been planned volume relabelled as achieved, and it starts falling the day this ships. Do not backfill history to smooth the charts.

Section 6's **Change 3** (one effort prompt per exercise) is **not** built and could not be: it only appears when an exercise carries an effort cap, and no exercise can carry one until phase 5. It belongs with `D-1`'s cap, not here.

**Phase 3: session windows and scope. Built.** The history query is session-grouped with a per-slot `DENSE_RANK` window (closes `SI-D6`), the `Tired` exclusion is gone and its rule from section 7 step 2 is in the engine (closes `A6`), `progression_scope` exists and clearance is judged per session (closes `A8`), and the dot detail view is built (`E-8`). Delivers 4a as a literal fixture (`E-11`).

Shipped on branch `phase-3/session-windows-and-scope`, migration `0049` (`progression_scope`). Section 5's axis-columns migration is now *started* rather than done: `0049` carries only `progression_scope`, and the other five axis columns are phase 5's. Rep-range columns are phase 4's. Also closed `E-3`, `E-6`, `E-9` and `E-16`, and half of `E-11` — 4b lands with phase 4.

`D-8`'s effort half is **not** built and could not be: no exercise can carry a cap until phase 5. What phase 3 built is the half `D-8` shares with `D-7` — the scope names one set of deciding sets, and `decidingSets` is the single place that answers it, so the cap has one obvious place to hook into. `E-13` is unbuilt and unassigned; see §0's carry-forward.

**Phase 4: rep ranges and double progression.** Range columns, validator, `advance: double` with the reset step, and the `E-1` floor exemption that lets the reset actually write. Delivers 4b, tested against that table (`E-11`). `E-1` is the most likely regression in the plan: test it before writing the feature.

**Phase 5: axes, presets, and the sheet.** Remaining axis columns, preset mapping, the extended sentence, the three-layer sheet, and `B-22`'s query change so the engine can finally read `target_rir`. Retire `progression_mode` reads and, per `D-4`, `adjustedRepsForWeight` — but keep the column itself for one release (`E-12`). Rewrite the `SI` spec against the new engine, including the corrected consumer count in `SI-33`.

`A9` needs three named artefacts here, not just "rewrite the spec": an **Inputs — provenance** section, a **rate rule** capping increments per session, and carrying the provenance question into `.claude/skills/feature-spec/SKILL.md`. A rewrite without them reproduces the blind spot `A9` exists to name.

**Phase 6: the rest.** Increment ladder ordering **and equipment-loadable granularity** (`A3` has both halves), staleness (`A10`, with `E-19`'s frequency guard), readiness `reduce` (`A7`), PR effort gate and the `D-10` unverified flag (`A11`), generated-plan prompt (`SI-D8`), `B-23`.

`A6` (Tired) is **not** here: its rule is section 7 step 2 and landed in phase 3 with the query rewrite. `A5` lands in **phase 5** with axis 6, not phase 3; its anchored-set exclusion (section 9) lands with it.

---

## 12. Decisions

These are open. Each has a recommendation and a reason, and none is assumed anywhere above.

**D-1. Does clearing require the prescribed RIR, or is effort recorded alongside?**
**Decided (2026-08-29): prescribed RIR gates clearing, but only when a cap is set on the exercise.** Opt-in means nobody is blocked by a setting they did not choose, and the people who want autoregulation get it exactly.

Binding consequences for the build:
- An exercise with `target_rir = NULL` clears on target alone. Effort is still recorded when supplied, and still shown, but never blocks.
- An exercise with a cap clears only when the set met its target **and** logged RIR is greater than or equal to the cap. RIR 2 against a cap of 2 clears; RIR 1 does not.
- The cap is per set (`program_sets.target_rir`), so a top set and its back-offs can carry different caps. Under scope `all` the aspiration is that every working set is judged against its own cap; **`D-8` states the operative rule** for the normal case where effort is only partially logged. Read them together.
- This replaces the current absolute ladder (`SI-10`: RPE 8 counts only with an extra rep) for capped exercises. Uncapped exercises keep target-only clearing; the old ladder is retired rather than kept as a third path.

**D-2. What does an unlogged effort mean when a cap is prescribed?**
**Decided (2026-08-29): unknown. Not a clear, not a failure.** The alternative, treating silence as a clear, is what the current RPE 7 default does and is the whole problem.

Binding consequences for the build:
- An unknown session does not increment the gate count and does not count toward the back-off streak (section 7, steps 4 and 5). It is inert in both directions.
- It still occupies a slot in the 5-session window, so a run of unlogged sessions ages real ones out rather than preserving them.
- The suggestion is `held-unknown`, which the chip must render distinctly from `held`. "You have not told me how hard that was" and "you have not cleared it enough times" are different messages and were the same one before.
- Because skipping the prompt stalls progression, the prompt in section 6 change 3 only ever appears on exercises that carry a cap. Nobody is nagged for effort they did not ask to be measured on.

**D-3. Do existing `weight` exercises migrate to scope `all` or scope `set`?**
**Decided (2026-08-29): `all`.** Per-set drift produces plans nobody would write, so it is a bug rather than a behaviour to preserve.

Binding consequences for the build:
- The phase 3 migration sets `progression_scope = 'all'` on every existing `weight`, `smart` and `reps` exercise. `set` stays available for exercises whose sets genuinely differ, but nothing lands on it by default.
- **This visibly changes progression for every exercise the owner already has, on the first load after deploy.** Some exercises that were about to bump will hold instead, because a set that was quietly banking its own count no longer can. That is the fix working, but it needs saying in the release note rather than being discovered.
- Existing plans that have already drifted (62.5 / 62.5 / 60 / 60) are **not** rewritten. Migration changes the rule going forward; it does not touch logged history or re-level past plans. Levelling them is a separate, explicit action the owner can take by editing the sets.

**D-4. Retire `smart` mode?**
**Decided (2026-08-29): yes.** Its Epley rep-cut only ever lowers, only fires on a near-max set in the 2 to 12 range, and is a rough approximation of the rep-drop that double progression does properly.

Binding consequences for the build:
- `smart` exercises migrate to preset **Load, confirmed** (fixed target, advance `load`), per section 10. They do not silently become double progression: no existing set has a rep range, and inventing one would change the prescription.
- `adjustedRepsForWeight` is deleted from `SetSuggestion` and from both consumers. This also closes divergence `D2` (the rep cut surviving a readiness downgrade) by removing the field it was leaking through.
- `estimated1RM` survives as a **display** value only, and gains the RPE gate it should always have had, which closes `SI-D1`. With `D-2` decided, "no effort logged" now means no 1RM estimate rather than an estimate built on an assumed 7.
- Independent support for this decision, found in the triathlon generator: it already declines to use `smart`, on the grounds that it "nudges reps via a 1RM estimate, which would break the strictly-static rep scheme" (`triathlon-plan.ts:158-165`).

**D-5. Staleness threshold, and what a re-approach proposes.**
**Decided (2026-08-29): 21 days, and the last logged load minus 10%.**

Binding consequences for the build:
- Measured from the most recent logged session for that exercise to today, not from the window's span.
- 10% matches `DELOAD_FACTOR`, deliberately: one back-off size in the engine rather than two. If one changes later, both should be reconsidered together.
- The suggestion is `re-approach`, a distinct reason code, so the chip can say "back after a break" rather than showing an unexplained drop. It is a suggestion like any other, so declining it and logging your old weight is allowed and simply feeds back into the window.
- 21 days is a convention, not a derived number. It is written here so it is one constant in one place, not a literal scattered through the engine.

**D-6. When double progression and the cycle's strength phase both want `target_reps`, who wins?**
**Decided (2026-08-29): delete the cycle branch. Progression owns `target_reps` outright.**

Evidence behind the decision: `git log -S '"strength"'` returns a single commit, the initial migration, so no producer for the `sessionRole = "strength"` tag was ever written. The triathlon generator explicitly names and rejects the mechanism ("no phase re-prescription (no sessionRole \"strength\")... to spare the CNS so the endurance quality sessions aren't compromised", `triathlon-plan.ts:158-165`). Flat strength is the later, deliberate choice; *strengthPhaseRecipe* is the superseded design it replaced.

Binding consequences for the build:
- **Built (phase 0).** Deleted the `"strength"` branch in `syncPeriodizedTargets`, the *strengthPhaseRecipe* helper and its tests, and corrected both stale docblocks.
- **Preserve the reasoning, not the code.** Move the rep scheme (base 12 @ 90s anatomical adaptation, build 5 @ 180s max strength, peak 4 @ 180s strength-power, taper 3 @ 180s sharpen, maintain 6 @ 150s), its citations (Rønnestad & Mujika 2014; Beattie 2017) and the CNS rationale for *not* using it into [`specs/cycle-periodization.md`](specs/cycle-periodization.md) as a "considered, not implemented" note. The research is the valuable part and it must not be lost with the function.
- No arbitration rule is needed in the progression engine. The anchored-endurance exclusion (section 9) still applies and is unaffected.
- This closes cycle spec divergence `D3`, which was open pending exactly this decision.

**D-7. Should `all` scope require literally every working set, or N of M?**
**Decided (2026-08-29): literally every working set.**

Binding consequences for the build:
- No `n_of_m` configuration is built. Scope stays the four values in axis 4.
- On 4x12 this is strict, and the last set is the one that tends to fall short, so it may stall more than expected. That is accepted deliberately: starting strict and loosening on evidence is recoverable, the reverse is not, because loosening never surprises anyone and tightening changes progression under people mid-programme.
- The dot detail view (section 8) carries the weight here. When an exercise is not progressing, "set 4 was short in 3 of the last 5" has to be visible on screen, or strictness reads as the app being broken. Treat that view as part of this decision rather than a nice-to-have.
- Revisit only with logged evidence, once real rep data exists (phase 2 onward). If exercises are demonstrably stalling on a single trailing set, `n_of_m` is an additive change to axis 4.
- **One argument used to justify this decision does not hold.** "Loosening never surprises anyone" is wrong: shipping `n_of_m` later would fire simultaneous advances across every exercise that had been silently banking near-clears, which is a larger surprise than the original tightening. The decision still stands on its other grounds, but do not lean on that one.
- **The mitigation is diagnostic, not corrective.** The dot detail view explains why an exercise is not progressing; it does not make it progress. If 4x12 stalls on set 4, a tolerance is the cheaper fix than `n_of_m`: either total reps across working sets (48 for 4x12) or a one-rep allowance on a single set. Both are one number and neither needs a new axis.


**D-8. Which set's effort decides whether the session cleared?**
**Decided (2026-08-29), reopened on review, re-decided: the floor is judged on the set the scope already names.**

| Scope | Clearing decided by | Effort judged on | Prompt fires |
|---|---|---|---|
| `all` | every working set | the **last** working set | after the exercise (unchanged) |
| `first` | the first working set | the **first** working set | after set 1 |
| `last` | the last working set | the **last** working set | after the exercise |
| `set` | that set | that set | after that set |

One rule: **the set that decides clearing also decides effort.** This replaces the earlier "last set carrying logged effort speaks for the session", which contradicted scope `first` (two different sets adjudicating one session), cancelled the reason per-set floors exist (on a top-set prescription the last set is the back-off, carrying the loosest floor), and inverted the convention that a prescribed RIR applies to the top set.

Binding consequences for the build:
- Per-set floors stay real. `program_sets.target_rir` is read from the scope-determining set, so a top set and its back-offs can carry different values and the strict one is the one evaluated.
- Only top-set schemes pay a mid-exercise prompt. Straight sets keep the single end-of-exercise prompt, which is the common case.
- If the scope-determining set has no logged effort, the session is `unknown` per `D-2`. Effort logged on *other* sets is stored and displayed but does not substitute — that substitution was the previous rule and is what broke.
- For scope `all` the last set is the strictest reading (reserve is lowest there by design). If capped straight-set exercises stall on this, the fix is to lower the floor, not to change which set is read.


**D-9. What does a partially logged session mean?**
**Decided (2026-08-29): unknown. Neither a clear nor a failure.**

Binding consequences for the build:
- A session with fewer logged working sets than the plan prescribes is `unknown`: it does not increment the gate and does not increment the back-off streak, but it does consume a slot in the 5-session window (identical treatment to `D-2`).
- "Fewer than prescribed" is measured against the working sets that existed **in that session** (`E-9`), not against today's plan. Editing 4x12 down to 3x12 does not retroactively complete past sessions.
- The dot detail view (`E-8`) shows "3 of 4 sets logged" for these, so a stalled exercise explains itself. Add `logged`/`prescribed` counts to the `sessions` array in `E-8`.
- Deliberately forgiving: cutting a session short usually has nothing to do with whether the load is right, and punishing it with a back-off would make the engine wrong in exactly the situation a lifter is least able to argue with it.
- The interaction to watch: a lifter who habitually drops the last set will now sit permanently at `unknown` and never progress. That is visible in the dot detail view rather than silent, which is the point, but it is the most likely source of "why is nothing happening" reports. If it shows up, the answer is to edit the prescription to 3 sets, not to loosen this rule.
**D-10. What happens to PRs set before honest rep logging?**
**Decided (2026-08-29): keep them, flagged as unverified.**

Binding consequences for the build:
- Add a nullable `verified_at` or equivalent marker to `exercise_prs`, or simply compare the record's date against the phase 2 cutover date recorded as a constant. The constant is cheaper and needs no migration; prefer it unless PRs are already being written for other reasons.
- Applies to **derived** records only: `estimated_1rm` and `reps_at_weight`, both computed from `actual_reps`. Heaviest-weight records were never assumption-based and carry no flag.
- The flag is display-only. It does not exclude the record from being the current PR, and beating it still counts normally. The point is that an unbeatable record has a visible reason instead of reading as a plateau.
- Nothing is deleted or recomputed. Rewriting a user's record history to make the new engine look better would be the same dishonesty this plan exists to remove (see `B-4`, which makes the same call about volume).
- Lands in phase 6 with the PR effort gate (`A11`), not earlier: the flag is meaningless until honest reps exist to contrast it with.

**D-11. Should the gate require *consecutive* clearing sessions?**
**Decided (2026-08-29): yes. A non-clearing session resets the count to zero.**

Binding consequences for the build:
- `clear, clear` bumps. `clear, fail, clear` does not. The gate means "N in a row", which is what "two full workouts" was asking for and what every preset in section 3 implies.
- **Unknown sessions (`D-2`, `D-9`) do not reset the count.** They are inert in both directions, as they are for the back-off streak. A session you did not log effort for must not undo banked progress, or `D-2` becomes a punishment for the honest gap it was designed to represent.
- This removes the ambiguity where the same history could satisfy both the gate and the back-off streak, with only the pipeline's ordering deciding which fired. With a consecutive gate the two are mutually exclusive by construction.
- The window still bounds the lookback at 5 sessions, but with a consecutive rule the window only matters for the back-off guard and the `SI-11` load comparison; the gate itself never needs to look past the first miss.
- Update section 4a: its table already shows a miss at session 2 and a bump at session 3, which under this rule is **wrong** — session 2 resets, so session 3 is 1 of 2 and the bump lands at session 4. Fix the table; it is a test fixture (`E-11`).


---

## 13. What this closes

**A warning about `D` numbers.** Three separate things in this repo are numbered `D`. Keep them apart:

- **`D-1` to `D-7`** (hyphenated) are the *decisions* in section 12 of this file.
- **`SI-D1` to `SI-D8`** are the divergences table in [`specs/smart-incrementation.md`](specs/smart-incrementation.md).
- **`PZ-D1` to `PZ-D8`** are the divergences in [`specs/cycle-periodization.md`](specs/cycle-periodization.md).

The specs themselves label their tables plain `D1`-`D8`. Prefix them when writing about them from outside, as below.

**Audit findings** (`BACKLOG.md`, "Progression engine audit"), all resolved on completion and to be deleted from the backlog as each phase lands:

`A1` (**closed**, phases 1 and 2), `A2` (phase 5, needs `B-22`), `A3` (**both** halves, phase 6), `A4` (phase 4), `A5` (**phase 5**, not 3 — the fix is axis 6), `A6` (**closed**, phase 3 — the rule is section 7 step 2, not a phase-6 bullet), `A7` (phase 6), `A8` (**closed**, phase 3), `A9` (phase 5, **only if its three artefacts are built**), `A10` (phase 6), `A11` (phases 1 and 6).

The phase numbers above predate phase 0 and refer to the engine phases; phase 0 is prerequisites only and closes no audit finding on its own, though `P-2` closes the standalone duplicate-slot bug recorded beside `A1`.

**Smart-incrementation spec divergences:** `SI-D1` (ungated 1RM, closed by `D-4`), `SI-D2` (rep cut survives readiness, closed by `D-4` deleting the field it leaked through), `SI-D3` and `SI-D4` (timed/distance asymmetries, resolved by the axes making them explicit settings), `SI-D5` (bodyweight never progresses — resolved by `advance: reps` **only together with `E-17`**, since the root cause is `overload_increment_reps` defaulting to 0), `SI-D6` (window starvation, **closed**, phase 3), `SI-D8` (generated plans, phase 6).

**Cycle-periodization spec divergence:** `PZ-D3` (strength phase has no producer), closed by decision `D-6`.

**Stays open:** `SI-D7`, the inert global increment controls in Settings. It is a Settings question, not a progression-engine one, and this plan does not touch it.

---

## 14. Pitfalls, prerequisites and edge cases

A hardening pass over the plan above, done before any code was written. Everything here is either a **prerequisite** that must land before the phase that depends on it, or an **edge case** whose behaviour is specified now so it is not invented under pressure later. Two genuinely open judgement calls became decisions `D-8` and `D-9`.

### Prerequisites

**P-1. A logged set does not record whether it was a warm-up. Blocks phase 3. Built in phase 0 (migration `0047`).**

`workout_sets` has no `set_type` column. `set_number` is the positional index across *all* sets including warm-ups (`WorkoutSetsList.tsx:341`), and warm-ups are logged like any other set. Today this is survivable because progression keys on `exercise_id + set_number` and simply skips non-working *program* sets.

Session-scoped clearance (`D-7`, every working set must clear) cannot work this way. To ask "did every working set clear in the session three weeks ago" you would have to join back to `program_sets` by `set_number` and read today's `set_type`, which is wrong the moment the plan changed. Sets can be added, deleted and drag-reordered (`set-mapping.ts`), so the historical join is not reliable.

*Required:* add `set_type` to `workout_sets`, written at log time from the program set. **And a second field the first draft missed:** a skipped set has *no row*, so `set_type` alone cannot distinguish "logged 3 of a prescribed 4" from "the prescription was 3". That distinction is the whole of `D-9` and half of `D-7`, and neither is implementable without it. Snapshot the prescribed working-set count per session and exercise slot at log time, or write skipped sets as rows with `is_completed = false`. The first is cheaper; the second also fixes `E-9` for free. Logs must be self-describing; a historical session's meaning cannot depend on the current blueprint. Backfill existing rows by joining to `program_sets` on `set_number` as a best effort, accepting that pre-migration rows may be slightly wrong, since they are only read for five sessions of history.

*While you are there:* `set_number` should keep counting warm-ups (do not renumber), because renumbering would break the `(session, exercise, set_number)` identity of every existing row.

**P-2. The same exercise twice in one program silently destroys logged data. Blocks phase 3, and was a live bug. Built in phase 0 (migration `0046`).**

Nothing stops a program holding two `program_exercises` slots for the same exercise, which is a normal thing to want (heavy bench, then a back-off bench). But `workout_sets` is uniquely indexed on `(session_id, exercise_id, set_number)` and `logWorkoutSet` uses `onConflictDoUpdate` (`workout-sets.ts:222-247`). So logging set 1 of the second slot **overwrites set 1 of the first slot**. The heavy set's weight, reps and effort are gone, replaced by the back-off's.

The `onConflictDoUpdate` is correct for its intended purpose (re-logging a set must overwrite, and offline replays must be idempotent). The identity is what is wrong: a logged set is identified by exercise and position, when it should be identified by the plan slot it came from.

*Required:* add `program_exercise_id` (and ideally `program_set_id`) to `workout_sets`, and move the unique index to `(session_id, program_exercise_id, set_number)`, keeping `exercise_id` for cross-program queries like PRs. This also makes session-scoped clearance exact instead of inferred, and it is the same change `P-1` wants.

**The new foreign key must be `onDelete: set null`, not `cascade`.** Both existing FKs on `workout_sets` cascade (`schema/workout-sets.ts:51`, `:54`), so following the house convention here would mean **removing an exercise from a program deletes its entire logged history** — strictly worse than the bug being fixed. The history query must tolerate a null.

**Second-order:** `program_exercises.exercise_id` is mutable. Swap the exercise in a slot (bench to incline bench) and a slot-keyed history window inherits the previous exercise's sets, which the current `exercise_id` key makes impossible. Key the window on the slot *and* verify the exercise still matches, or re-key the slot on swap.

*Was recorded separately in `BACKLOG.md` as a standalone bug*, because it was losing data regardless of whether this plan proceeded. Fixed and the entry removed.

**P-3. The logging payload changes shape while old clients are still installed. Standing rule; discharged for `programSetId` in phase 0 and for `rpe` in phase 1. Phase 2 needed nothing: `actualReps` was already required and already accepted any count, so the shape did not change.**

This is a PWA; cached bundles keep calling the old Server Action for a while, and the offline queue can hold payloads written by a previous version. Phase 1 made `rpe` nullable and stopped sending 7; phase 2 sends real `actual_reps` in a field that was always there. A payload queued by a pre-phase-2 client replays as a set that hit its target, which is exactly what that client claimed.

*Required:* the validator accepts both shapes for at least one release. `rpe` becomes optional rather than removed, and a payload that still carries `rpe: 7` with no `rir` is stored as-is. Do **not** treat a legacy `rpe: 7` as "unknown" retroactively: it is indistinguishable from a real logged 7, and rewriting history to make the new engine look better is worse than the imprecision. See section 10.

### Specified edge cases

These have a defensible answer, so the plan states it rather than raising a decision.

**E-1. `reset` must be exempt from the rep floor.** Double progression's reset step raises load and *lowers* `target_reps` back to `rep_range_min`. The plan ratchet's rule (`SI-37`) is that only a back-off lowers the plan. `reset` must be added to that exemption for the rep dimension while still raising load, or phase 4's headline behaviour is blocked by phase 0's bug fix. Test this explicitly; it is the single most likely regression in the whole plan.

**E-2. `re-approach` may lower the plan.** It is a back-off by another name (`D-5`), so it is exempt from the floor exactly as `backoff` is.

**E-3. Built in phase 3. Under scope `all`, an advance applies uniformly to every working set.** Not per set. On 4x12 the whole exercise moves to 62.5 together, which is the entire point of `D-3`. Under scope `set` the current per-set behaviour is retained. Under `first` and `last`, the scope decides *whether* the session cleared; the advance still applies to all working sets, because a top set moving while its back-offs stay is a plan nobody wrote.

**E-4. `advance: double` requires a positive load increment.** At `rep_range_max` with no load to add, the reset cannot happen and the exercise would sit at the top of its range forever. The sheet must not offer `double` without an increment, and the engine holds with `held-unknown`'s sibling message ("no load increment set") rather than silently climbing past the range the user configured. Bodyweight work uses `advance: reps` and no range, which is what `SI-D5` was really asking for.

**E-5. Ranges apply to reps only.** `duration` and `distance` take a fixed target. A range plus `advance: double` has no meaning for a plank or a run, and section 3's table should be read as fixed-target for those two presets. This narrows what phase 4 has to build.

**E-6. Built in phase 3. `was_easy` bypasses the gate at session level.** Under scope `all`, an easy verdict on one set does not carry the session. The rule becomes: the session cleared, and at least one of the scope-determining sets was marked easy. This preserves `SI-13`'s intent without letting one easy set speak for four.

**E-7. Readiness `reduce` reuses the `backoff` reason code** with `readinessModulated: true`, rather than adding a tenth code. Both consumers already branch on `backoff`, and the distinction is a display concern (the chip says why), not a different write.

**E-8. Built in phase 3. The dot detail view needs data the suggestion does not carry today.** `SetSuggestion` has `hitsAchieved` and `hitsRequired` but no per-session breakdown. Add `sessions: { date, status, shortfall? }[]` covering the window, where status is `cleared` / `missed` / `unknown`. Without it, `D-7`'s strictness has no explanation on screen, and `D-7` explicitly depends on that view existing.

**E-9. Built in phase 3. A session's clearance is judged against what was logged in it, never against the current plan.** If a 4x12 exercise is later edited to 3x12, the four-set sessions in the window are still four-set sessions. This follows from `P-1` and is why the log must be self-describing.

**E-10. Cross-programme history stays separate.** The history query filters by `program_id`. Bench in "Push 1" and bench in "Push 2" progress independently, and that stays true. It is defensible (different slots, different prescriptions) but it has never been written down, so it is written down here.

**E-11. 4a built in phase 3; 4b is phase 4's. Test fixtures come from sections 4a and 4b.** Both worked examples are session-by-session tables and should be encoded literally as unit-test fixtures, asserting the suggestion and the dot count at every step. If the code disagrees with those tables, the code is wrong.

**E-13. Still open and unassigned; §0's carry-forward names it. Changing an exercise's configuration re-judges history retroactively.** Switch preset, gate, scope, or fixed-to-range, and the existing 5-session window is re-evaluated under the new rule: sessions that cleared yesterday can un-clear today. `E-9` protects against plan *shape* changes but nothing protects against *rule* changes. Stamp a config version on the exercise and count only sessions logged since the last change. Anything else means the dot count moves when the lifter touches a setting, which reads as a bug.

**E-14. A copied, shared or imported program starts with no history.** `E-10` keys history to `program_id`, so a new program has zero sessions and returns no suggestion until five accumulate. `B-7` and `B-13` cover the *settings* travelling; nothing covered the progression restart, which is the part the lifter sees.

**E-15. Editing history after the ratchet has written does not unwind the plan.** Suggestions recompute on read and self-heal, but `applyProgressionToPlan` writes are permanent. Correcting a past session downward leaves the bump it caused in place, and `SI-37`'s floor then prevents anything from lowering it back. Either recompute the plan on history edits or accept and document it; do not leave it undecided.

**E-16. Built in phase 3. Two sessions of the same program on one day consume two window slots.** The window counts sessions, not days. Deliberate, but state it.

**E-17. `advance: reps` has no ceiling.** `E-4` guards `double` against a missing load increment; the mirror case is a rep ladder with nowhere to stop, which climbs 8, 9, 10 … 40 forever. This is also the real content of `SI-D5`: the rep fallback needs `overload_increment_reps > 0` and that column **defaults to 0** (`schema/programs.ts:61`), so bodyweight exercises hold forever out of the box. Section 13 claimed `advance: reps` closes `SI-D5`; it does not unless the zero-increment default is fixed too. Treat a missing rep increment as 1 in the engine (no migration) and give `advance: reps` an optional `rep_range_max` stop.

**E-18. A back-off has no floor.** Repeated 10% cuts walk a lift below an empty bar, and at `baseWeight = 0` (bodyweight) both the back-off and the `re-approach` compute to 0. Floor the result at one increment, and make back-off a no-op at zero load.

**E-19. Staleness is absolute and will misfire on low-frequency work.** `D-5`'s 21 days is measured from the last session, so an exercise deliberately trained on a three-week rotation sits permanently at `re-approach` and is offered -10% every session. Consider `max(21 days, 2.5x the median inter-session interval for that exercise)`.

**E-12. Rollback.** Every migration is additive (new nullable columns, one column made nullable) except `P-2`'s unique index replacement, which needs a tested down-path. `D-3`'s scope migration changes behaviour rather than shape, so the previous `progression_mode` values must survive it. **That contradicts section 5's "retired after migration".** Resolve it by keeping the column, stopping all reads of it in phase 5, and dropping it a release later. The same staged retirement applies to the wire formats in `B-7`, `B-13` and `B-15`.

---

## 15. Blast radius

Every place outside the progression engine that this plan changes the behaviour of, traced by reading the code rather than assumed. Each row names the phase that breaks it and what has to happen in that same change. **Nothing in this section is optional work; it is the cost of the phases above.**

### Things that break outright

**B-1. The cycle adaptation silently *boosts* volume when effort stops being logged. Fixed in phase 1.**

`computeCycleAdaptation` (`training-cycles.ts:479`, the averaging at `:522`) computes `rpeRows.reduce((a, r) => a + r.rpe, 0) / rpeRows.length` on the column phase 1 makes nullable.

An earlier draft of this section called the result `NaN`, named the function `getAdaptationSignals`, and called it silent. All three were wrong, and the correction matters because the real behaviour is worse:

- **It is not `NaN`.** JavaScript coerces `null` to `0` in `+`, so `[8, null, 6]` averages to `4.67`. The average is diluted downward, not poisoned.
- **The harm runs the opposite way.** `computeAdaptationFactor` (`periodization.ts:283-288`) boosts weekly volume by 5% when `avgRpe == null || avgRpe <= 6`. Nulls dragging the average under 6 therefore **increase training volume for someone who simply stopped logging effort**. Had it been `NaN`, `NaN <= 6` is `false` and the branch would have been inert. The wrong diagnosis was the reassuring one.
- **It is not silent.** `tsconfig.json` sets `"strict": true`, so `a + r.rpe` where `r.rpe: number | null` is a compile error. `pnpm verify` refuses to build it. This is the one item in this section that cannot ship unnoticed.

*Done in phase 1:* `meanLoggedRpe` drops the nulls and returns null when nothing remains, which is the existing no-data path. `periodization.test.ts` asserts the average, the resulting percentage, and the percentage the coercing version would have produced.

**B-2. `reason` is branched on at seven sites across four files, not two. Breaks in phases 1, 4 and 6.**

`SI-33` claims two consumers branch exhaustively. The real inventory:

| Site | What it does |
|---|---|
| `progression.ts:1049-1056` | readiness downgrade, matches four `progressed*` literals |
| `progression.ts:1071` | `reason.startsWith("progressed")` for the `easyOverride` flag |
| `WorkoutSetsList.tsx:675` | sibling-apply dedup (`s.reason === target.reason`) |
| `WorkoutSetsList.tsx:1419-1445` | the `*Pending` computations |
| `WorkoutSetsList.tsx:1493-1635` | the render switch |
| `workout-sets.ts:1712-1724` | `getWorkoutInsight` exercise status, ends in a catch-all `else status = "held"` |
| `workout-sets.ts:1814-1820` | `getWorkoutInsight` `progressedCount` filter |

Two consequences. **New codes** (`held-unknown`, `reset`, `re-approach`) fall into the insight's catch-all and report as *stalled* on the dashboard — `re-approach` means the opposite. **The rename** breaks the first two sites silently, with no type error; see the note under section 7's reason-code list, which is the authoritative statement of that hazard.

**Done for `held-unknown` (phase 1).** All seven were walked. Four needed no change (the two `progressed*` matches, the dedup, the `*Pending` computations), three did: the render switch labels it, the insight's catch-all keeps reporting it as held deliberately, and an eighth site the table missed — the *stagnating* headline's `heldCount` filter — excludes it, because that headline prescribes a plateau remedy. `reset` and `re-approach` still owe the same walk.

**B-3. Aggregate RPE reads change meaning. Handled in phase 1.**

- `metrics.ts:588` — `AVG(CAST(rpe AS numeric))`. SQL `AVG` skips nulls, so this silently becomes "average of sets where effort was logged" rather than "average effort". Defensible, but the RPE-trend chart's meaning changes and the label should say so.
- `workout-sets.ts:1407` — `rpe >= 9` for the cooked-exercise count. Three-valued logic excludes nulls, so the count drops. Also defensible, also a changed meaning.

*Done in phase 1:* both exclude, both say so. The trend chart's caption and empty state name the exclusion, and `RpeTrendPoint` documents what `sessionCount` counts; the cooked-exercise count carries the reasoning in a comment, since silence is not evidence of a hard session. Note the trend's exclusion is the `rpe > 0` predicate, not `AVG` skipping nulls as this entry originally said — `B-18` has it right.

### Things that change visibly for the user

**B-4. Every volume number falls. Landed in phase 2; the release note is owed.**

Volume is `weight_kg * actual_reps` in **twelve** places: `metrics.ts:298`, `:416`, `:453`, `:999`, `:1051`, `:1245`, `:1299`; `workout-sets.ts:922`; `friends.ts:378`, `:620`, `:636`, `:753`; and a client-side `reduce` in `SessionDetailClient.tsx:48`. (An earlier draft said six and named `workout-sessions.ts`, which computes no volume at all.) The per-session figure on the session detail screen and the friend-leaderboard totals are the ones people screenshot, and both were outside the files this section originally pointed at. Today `actual_reps` is always the target, so today's volume is the *planned* volume relabelled as achieved. Once real reps are logged, volume drops for anyone who ever misses a rep, and the drop appears as a decline in the charts on the day the feature ships.

The numbers become correct, but "my volume fell off a cliff" is the reaction, and it is a reasonable one. *Required in phase 2:* a note in the release/changelog, and consider annotating the metrics charts at the cutover date. Do not backfill or adjust historical volume: it is what was recorded, and rewriting it to smooth the chart would be the same dishonesty this plan exists to remove.

**B-5. The estimated-1RM trend changes, and existing PRs may become unbeatable.**

`metrics.ts:549` computes `session1RM` as `MAX(weight * (1 + actual_reps / 30))` over sets with `actual_reps BETWEEN 1 AND 12`, and PR detection stores `estimated_1rm` and `reps_at_weight` records from the same assumed reps (`A11`). Records set under the old behaviour were computed from reps the lifter may not have hit. After phase 2 they stand as a bar that honest logging might never clear.

*Required in phase 6, when the PR effort gate lands:* decide whether pre-cutover `estimated_1rm` records are kept, flagged as unverified, or reset. This is a user-data decision and is raised as **D-10** below rather than assumed here.

**B-6. Friend comparisons mix old and new logging during rollout.** `friends.ts` reads `actual_reps` for shared stats. Two users on different app versions, or one who has not reloaded their PWA, are compared on different definitions of the same number. Self-resolving once everyone updates; worth knowing before someone reports it as a bug.

### Things that must be updated in step

**B-7. Program sharing carries progression settings between users.** `program-shares.ts:205-209` copies `progressionMode`, `progressionRequiredHits`, `progressionApplyToPlan` and both increments into the shared payload. Phase 5 retires `progression_mode`, so the share format changes. *Required:* accept both shapes on import for at least one release, and map a legacy `progressionMode` through the same table as section 10's migration. A share created by an old client must still import.

**B-8. The MCP tool exposes the mode as an enum.** `mcp/tools/programs.ts:204` validates `progressionMode: z.enum(PROGRESSION_MODES)` and defaults it at `:275`. Phase 5 must update the enum, the tool description at `:192`, and keep accepting the old values so an agent mid-conversation does not start failing.

**B-9. The triathlon generator sets modes and RIR caps directly.** `triathlon-plan.ts` writes `progressionMode` per exercise and `targetRir` per set, and its comment explains it deliberately avoids `smart`. Phase 5 must move it to presets. With `D-1` and `D-8` live, its existing `targetRir` caps **become load-bearing for the first time**: plans it generates will start gating progression on effort. That is the intended behaviour, but it is a behaviour change to generated plans that nobody asked for at generation time.

**B-10. The e2e progression spec asserts the current sheet.** `e2e/progression-settings.spec.ts` drives the "Sessions at target" gate group and asserts the rule sentence quotes the live gate. Phase 5's three-layer sheet rewrites both. *Required:* update it in the same change, and extend it to cover the preset picker, since it is the only end-to-end coverage progression has and it doubles as the missing-migration canary.

**B-11. The seeders that matter are Server Actions, not scripts. Done in phase 1** — all three now log effort about two-thirds of the time and look up the plan slot at insert time. `scripts/seed.ts` inserts only exercises and model configs; it writes no sets and no `rpe`. The real producers are `scripts/seed-fake.ts:338`/`:358` and, more importantly, two in-app admin actions: `admin.ts:420`/`:429` (`seedDemoDataForUser`) and `admin.ts:605`/`:614` (`seedDataForUser`). All write `actualReps = targetReps + bonusRep` and a synthetic `rpe`. Phase 1 should have them emit a realistic mix of logged and unlogged effort, or every development and demo account will look like the pre-fix world and the new code paths will never be exercised locally.

**They also insert `workout_sets` rows directly, so phase 0's columns land null on them.** Seeded history carries no `program_exercise_id`, `program_set_id` or `prescribed_working_sets`, and takes the `set_type` default. Nothing reads those columns yet, so nothing is broken today — but phase 3 reads all four, and seeded data is the only data a development account has. Resolve it in the same change: build one map from `(programId, exerciseId, setNumber)` to the slot after the programs are created, and look it up at insert time.

**B-12. The demo user shares tables with real users.** Anything seeded is visible in the demo account, and the demo seeder is `admin.ts:420` (`seedDemoDataForUser`), not anything under `scripts/`. Seed data should exercise the new schemes (a fixed-target exercise, a rep-range exercise, one capped, one not) so the presets are demonstrable, not just implemented.

**B-15. `ExportedWorkoutHistory` is a third wire format with non-nullable `rpe`. Done in phase 1** — the type and the producer both take null. `types/workout.ts:392` types it `rpe: number`, fed by `workout-sessions.ts:305`/`:327`. Phase 1 makes the column nullable; the type and both producers need it. `B-13` warns that export and sharing are separate paths and then misses this one.

**B-16. Session detail renders "RPE null". Done in phase 1** — three cases: RIR, a bare RPE, or nothing. `SessionDetailClient.tsx:168` is `set.rir != null ? \`RIR ${set.rir}\` : \`RPE ${set.rpe}\``. Every set logged after phase 1 hits the else branch with a null. Needs a third case for "not logged".

**B-17. The RPE trend chart plots 0.0 for weeks with no data. Guarded in phase 1** — and the guard is belt-and-braces: the `WHERE rpe > 0` predicate in `B-18` already excludes every null row, so no group can average to SQL NULL unless that predicate is relaxed. The null check costs a line and survives the relaxation. `metrics.ts:615` is `row ? Math.round(Number(row.avgRpe) * 10) / 10 : null`; when the week's `AVG` returns SQL NULL, `Number(null)` is `0`. Not the same problem as `B-3` and not fixed by it.

**B-18. The same query's session count changes meaning. Done in phase 1** — the type says it counts sessions that contributed effort, and nothing renders it. `metrics.ts:590`'s `COUNT(DISTINCT session)` sits behind the `rpe > 0` predicate at `:599`, so weeks with no logged effort drop out of the chart entirely. Also note the exclusion is that `WHERE` clause, not `AVG` skipping nulls as `B-3` states.

**B-19. Two more places gate the mode enum.** `validators/workout.ts:340` (`importProgramSchema`'s `.enum([...])`, which gates the import `B-13` describes) and `programs.ts:579` (`VALID_PROGRESSION_MODES`, backing the `updateProgramExerciseProgressionMode` Server Action). Neither is covered by `B-7`, `B-8` or `B-13`.

**B-20. The mode union lives in the component.** `WorkoutSetsClient.tsx:39`, `:53`, `:357`, `:585` hold the type, the picker list, the badge label and a layout conditional. Phase 5 rewrites this file anyway, but section 8 never says the type is defined here rather than in `types/`.

**B-21. The offline queue's payload type is derived from the action.** `contexts/pending-queue-context.tsx:36` is `Parameters<typeof logWorkoutSet>[0]`. `P-3` requires the validator to accept both shapes for a release without naming the queue that persists the old one.

**B-22. `getProgressiveSuggestions` does not select `target_rir`.** `workout-sets.ts:1349-1369` selects `setType`, `progressionMode`, `progressionRequiredHits` and the rest, but not `targetRir`. `D-1` and section 5 both assume the engine can see it. **The query change is a phase 5 prerequisite and was missing from the plan entirely.**

**B-23. The AI plan prompt.** `ai-prompt.ts:167` describes the old modes. Section 9 and phase 6 mention it; this section claimed to trace everything outside the engine and did not list it.

**B-13. The export format uses its own compact keys for progression settings.** `ExportedProgram` (`types/workout.ts:399-423`) carries the per-exercise settings, and the export/import code shortens the column names: `progressionMode` is emitted as `mode` and `overloadIncrementKg` as `incKg`, with defaults applied on the way out (`programs.ts:856-858`, `:917-919`) and expanded back on the way in (`:1070-1072`). So phase 5 changes a **wire format**, not just a column.

*Required:* map the legacy `mode` value through the same table as section 10's migration on import, keep emitting something an old client can read for at least one release, and never reject an export a user made last month. Same requirement as `B-7`, and note the two formats are separate code paths that must both be updated.

**B-14. Onboarding does *not* mention progression.** Checked and clear: `OnboardingTutorial.tsx` matches a search for "smart" only through the `Smartphone` icon import. No copy to update. Recorded because it is the obvious next place to look and the answer is no.
