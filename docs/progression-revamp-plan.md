# Progression revamp: plan

> **Status:** approved for phase 1. `D-1` and `D-2` decided 2026-08-29; `D-3` to `D-7` still open (not needed until phases 3, 5 and 6).
> **Written:** 2026-08-29 against `197dea1`
> **Supersedes on completion:** the `SI` rules in [`specs/smart-incrementation.md`](specs/smart-incrementation.md), rewritten at the end of phase 5
> **Closes:** audit findings `A1`-`A11` and spec divergences `D1`-`D8` in [`../BACKLOG.md`](../BACKLOG.md)

Progression is the reason this app exists rather than a notes file. It is also the part with the least honest data behind it. This plan rebuilds it as one machine with a small number of settings, so that every progression scheme a lifter actually runs is the same engine with different values, and the app can say in one sentence what it will do next.

Nothing here is a code change yet. Section 12 lists the decisions that need an answer before phase 1 starts; they are decisions, not guesses, and none of them are made silently anywhere else in this document.

---

## 0. Start here (picking this up in a fresh session)

This document is the complete brief. It assumes no conversation history. Read it top to bottom before touching code.

**Repo state at time of writing.** Branch `fix/progression-never-lowers-plan`, seven commits ahead of `main`, not pushed and not smoke-tested. It contains an audit of the current engine and one bug fix that predates this plan: a progression suggestion could lower the plan, because the ratchet compared against the last *logged* value rather than the planned one. That fix stands and this plan builds on top of it. The audit findings it produced are `A1`-`A11` in [`../BACKLOG.md`](../BACKLOG.md); this document is the plan to resolve them.

**Outstanding from that branch, unrelated to this plan:** the Playwright smoke pass was never run, because the webkit browser binary is not installed (`./node_modules/.bin/playwright install webkit`). Anything touching the set list needs it before pushing, per `CLAUDE.md`.

**Read in this order:**

1. This file, sections 1 to 13.
2. [`specs/smart-incrementation.md`](specs/smart-incrementation.md) for how the current engine behaves. It is accurate about the code and stays the reference until phase 5 rewrites it.
3. `src/lib/utils/progression.ts` (the engine), `src/lib/actions/workout-sets.ts` (`getProgressiveSuggestions`, the history query), `src/components/features/WorkoutSetsClient.tsx` and `WorkoutSetsList.tsx` (both consumers).
4. `BACKLOG.md`, section "Progression engine audit", for the detail behind each finding.

**Decisions.** Section 12 lists seven that this plan deliberately does not make. `D-1` (a prescribed RIR gates clearing, on capped exercises only) and `D-2` (unlogged effort is unknown, neither clear nor failure) are **decided** and written up there with their binding consequences; build to them, do not relitigate them. `D-3` to `D-7` are still open but are not needed until phases 3, 5 and 6, so phase 1 is unblocked. Get each answer from the repo owner and record it as a **Decided:** line before the phase that needs it.

**Then:** build phase by phase from section 11, one phase per branch. `pnpm verify` after each. The smoke pass from `CLAUDE.md` after phases 2, 5 and 6. Do not start a later phase before the earlier one is merged; the phases are ordered by data dependency, not preference.

**The one thing to hold onto:** a tap records a claim the lifter made, and silence records nothing. Most of what is wrong today comes from inventing an effort value nobody supplied.

---

## 1. Why this needs rebuilding, not patching

Four problems, in order of severity. Each is recorded in `BACKLOG.md` with file references.

**The engine has never seen a missed rep (`A1`).** Tapping the set toggle writes `actualReps = targetReps` and a hardcoded `rpe: 7` (`WorkoutSetsList.tsx:314`, `:320`). RPE 7 is inside the "confident" band, so every logged set is a confident hit, the consensus window saturates, and the progress dots read 2 of 2 forever. Deload (`SI-17`) and rep-retry (`SI-19`) are unreachable in production. The observable behaviour is "add the increment every other session, indefinitely", which is what prompted this work.

The forged effort value is the real offence. Assuming you hit the target when you tap a "done" control is a claim you made. Assuming you had three reps in reserve is a claim nobody made. Section 6 keeps the first and removes the second.

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
| 3 | **Effort cap** | none, or RIR 0-5 | Whether clearing also requires reps left in reserve. |
| 4 | **Scope** | `all` / `first` / `last` / `set` | Which sets must clear for the *session* to count. |
| 5 | **Gate** | 1-5 sessions | How many qualifying sessions inside the 5-session window before anything moves. |
| 6 | **Advance** | `load` / `reps` / `double` / `duration` / `distance` / `none` | What moves when the gate is met. |
| 7 | **Regress** | `hold`, or back off *p*% after *n* failed sessions | What happens when you keep missing. |
| 8 | **Readiness** | `ignore` / `hold` / `reduce` | What a low pre-workout readiness score does to all of the above. |

The through-line: **a session either clears or it does not (axes 1-4), you need N clears to move (axis 5), and then a defined thing moves (axis 6).** Regress and readiness are the two ways that pipeline gets interrupted. Every named scheme in section 3 is a row of values across these eight columns, and the configuration UI in section 8 is a preset picker over those rows.

### Why these axes and not others

Axis 4 exists because "did the workout clear?" and "did this set clear?" are different questions and the app currently only asks the second. Axis 3 exists because `target_rir` is already in the schema, already shown to the lifter, and read by nothing (`A2`). Axis 7 exists because deload is currently hardcoded at 3 consecutive misses and 10%, with no way to say "never back off, I will handle it".

Axis 1 is derived rather than chosen because letting someone select "duration" on a barbell row produces a set that cannot be logged. It follows the exercise's own type, as it does today.

---

## 3. Coverage: the schemes people actually run

The test of the model is whether it expresses what lifters do without a special case per scheme. Each row below is a preset: a named set of axis values, offered in the picker.

| Preset | Target | Effort cap | Scope | Gate | Advance | Regress | Who runs this |
|---|---|---|---|---|---|---|---|
| **Linear load** | fixed | none | all | 1 | load | -10% after 3 | Starting Strength, StrongLifts. Novice barbell work. |
| **Load, confirmed** | fixed | none | all | 2 | load | -10% after 3 | Fixed rep count, prove it twice before moving. Slower and steadier than linear. |
| **Double progression** | range | none | all | 1 | double | -10% after 3 | The standard hypertrophy scheme. 3x8-12: add reps to the top of the range, then add load and reset to the bottom. |
| **Double progression, top set** | range | none | first | 1 | double | -10% after 3 | Top set drives progression, back-offs follow. |
| **Autoregulated** | fixed or range | RIR 1-3 | all | 2 | load or double | hold | RPE/RIR-based training. Load only moves when the prescribed reps came with the prescribed reserve. |
| **Rep ladder** | fixed | none | all | 1 | reps | hold | Bodyweight work with no load to add. Chin-ups, push-ups. |
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

---

## 4. Worked examples

The two schemes that prompted this, traced end to end.

### 4a. Fixed 12 reps, four sets, bump when two full workouts clear

Configuration: preset **Load, confirmed**. Target fixed 12, no effort cap, scope `all`, gate 2, advance `load` (+2.5 kg), regress -10% after 3.

| Session | Set 1 | Set 2 | Set 3 | Set 4 | Session clears? | Dots | Suggestion |
|---|---|---|---|---|---|---|---|
| 1 | 12 | 12 | 12 | 12 | yes | 1 of 2 | held at 60 |
| 2 | 12 | 12 | 12 | **10** | **no** | 1 of 2 | held at 60 |
| 3 | 12 | 12 | 12 | 12 | yes | 2 of 2 | **+2.5 kg on all four sets** |
| 4 | 12 | 12 | 12 | 12 | yes (at 62.5) | 1 of 2 | held at 62.5 |

Session 2 is the case the current engine cannot see at all: set 4 fell short, and today that is recorded as 12 and counted as a confident hit. Under this plan the dots stay at 1 of 2 and you can watch it happen.

Note that the gate counts *sessions*, and a session that does not clear does not reset the count, it simply does not add to it. The window is still the last 5 sessions, so a session that fails drops out of the window after 5 more.

### 4b. Range 6 to 8, climb then reset

Configuration: preset **Double progression**. Target range 6-8, scope `all`, gate 1, advance `double` (+2.5 kg), regress -10% after 3.

| Session | Prescription | Result | Advance |
|---|---|---|---|
| 1 | 3x6 @ 80 | 6, 6, 6 | to 3x7 @ 80 |
| 2 | 3x7 @ 80 | 7, 7, 7 | to 3x8 @ 80 |
| 3 | 3x8 @ 80 | 8, 8, **7** | no change, still 3x8 @ 80 |
| 4 | 3x8 @ 80 | 8, 8, 8 | top of range cleared on all sets: **+2.5 kg and reset to 3x6 @ 82.5** |

The reset is what `advance: double` means, and it is the single behaviour that makes rep ranges worth adding.

---

## 5. Data model

### `program_sets`

| Column | Change | Notes |
|---|---|---|
| `target_reps` | unchanged | Stays "what you are trying to hit today". When a range is set the scheme moves this value between the bounds. Everything that reads it (display, logging, PR comparison, cycle sync) keeps working untouched. |
| `rep_range_min` | **new**, nullable int | Bottom of the range. Null means fixed target. |
| `rep_range_max` | **new**, nullable int | Top of the range. Null means fixed target. |
| `target_rir` | unchanged, newly **read** | Becomes axis 3. Already exists and is already shown; nothing currently reads it (`A2`). |

Constraint: `rep_range_min` and `rep_range_max` are both null or both set; when set, `min <= target_reps <= max`. Enforced in the Zod validator and asserted in the engine.

### `program_exercises`

| Column | Change | Notes |
|---|---|---|
| `progression_mode` | **retired** after migration | Replaced by `progression_preset` plus the axis columns. See section 10. |
| `progression_preset` | **new**, text | The preset name, or `custom`. Display and defaulting only; the engine reads the axis columns. |
| `progression_scope` | **new**, text, default `all` | `all` / `first` / `last` / `set`. |
| `progression_advance` | **new**, text | `load` / `reps` / `double` / `duration` / `distance` / `none`. |
| `progression_regress` | **new**, text, default `backoff` | `hold` / `backoff`. |
| `progression_backoff_pct` | **new**, int, default 10 | Only read when regress is `backoff`. |
| `progression_backoff_after` | **new**, int, default 3 | Consecutive non-clearing sessions before backing off. |
| `progression_readiness` | **new**, text, default `hold` | `ignore` / `hold` / `reduce`. |
| `progression_required_hits` | unchanged | Axis 5. Null still means the shared default. |
| `overload_increment_kg` | unchanged | Null still means "unset, use the adaptive ladder". Do not give it a default (`SI-1`). |
| `overload_increment_reps` | unchanged | Still triple-duty (reps / seconds / metres) by measure. Documented as a trap in `SI-32`; splitting it is a separate migration and not required here. |
| `progression_apply_to_plan` | unchanged | The ratchet opt-in. |

Seven new columns is a lot, and the alternative is a single `progression_config` JSON blob. Columns win: they are validated by the database, queryable, and cannot drift into holding keys nothing reads, which is exactly how `target_rir` became dead weight. The count is a symptom of the feature genuinely having eight axes, and presets mean almost nobody sets them individually.

### `workout_sets`

| Column | Change | Notes |
|---|---|---|
| `actual_reps` | unchanged | Must start carrying real values. See section 6. |
| `rir` | unchanged | Already nullable. |
| `rpe` | **made nullable** | Currently `notNull`, which is what forces the fabricated 7. Null must mean "not logged", distinct from any effort value. |
| `is_failed` | unchanged | Stays as the explicit "attempted and missed" marker. |
| `was_easy` | unchanged | Keeps working as the gate bypass (`SI-13`). |

Three migrations total: rep range columns, progression axis columns, `rpe` nullable. Each generated with `pnpm db:generate` and committed with its schema change, per `CLAUDE.md`.

---

## 6. Capture: making the data honest without slowing the workout

This is the foundation. It is also where a wrong move ruins the everyday flow, so the principle is explicit:

> **A tap records a claim the lifter made. Silence records nothing.**

Tapping the set toggle is an affirmative "I did the prescription", and continuing to write `actualReps = targetReps` from it is honest. Writing `rpe: 7` from the same tap is not: it invents an effort report nobody gave. So:

**Change 1: stop forging effort.** The quick-log path stops sending `rpe: 7`. `rir` and `rpe` go in null. The engine treats null effort as *unknown*, which is neutral: it neither satisfies an effort cap nor blocks a target-only gate. Exercises with no effort cap are unaffected. Exercises with a cap do not progress until effort is actually logged, which is correct: you asked for a condition and did not supply it.

**Change 2: a fast way to say "I missed it".** Long-press the set toggle to open a compact sheet with two controls, reps achieved (stepper, pre-filled with target) and RIR (six buttons, pre-selected to nothing). Short tap is unchanged, so the common case costs nothing. This replaces "open the set editor, find Mark failed" as the only miss path.

**Change 3: one effort prompt per exercise, not per set.** When an effort cap is prescribed and the last working set of an exercise is logged, an inline row appears under the exercise: *"Last set, how much was left?"* with 0 / 1 / 2 / 3 / 4+ and a skip. One tap per exercise, roughly five per workout. Only shown when the exercise actually has a cap, so the setting you chose is the thing that adds the tap.

**Change 4: fix the reps-correction trap.** Editing the reps field in `SetEditView` during a workout currently writes `targetReps`, so correcting "I got 6, not 8" silently lowers the prescription and then logs a perfect hit against it (`SetEditView.tsx:270`). In a live session that field must write `actualReps` and leave the target alone. In program-edit mode it keeps writing the target.

Net cost to a normal set where everything went to plan: zero extra taps. Net cost to a set that fell short: one long-press instead of a trip through the editor.

---

## 7. The engine

`buildSuggestion` is rewritten around the axes. Evaluation is a pipeline, and unlike today the order is stated rather than discoverable only by reading top to bottom.

1. **Guard.** Non-working set, or advance `none`: return nothing.
2. **Assemble the window.** The last 5 *sessions* for this exercise, each carrying every working set logged in it. Not the last 5 rows for one `setNumber`. This is the change that makes axis 4 possible and closes `D6` (the global `LIMIT` starvation) by querying per exercise with a window function.
3. **Staleness.** If the most recent session is older than the staleness threshold, return a re-approach suggestion. Closes `A10`, where a three-month layoff currently still offers a bump.
4. **Clearance per session.** For each session in the window, decide clear / not clear / unknown:
   - Each working set clears when it met its target for the measure, and, when an effort cap is prescribed, logged RIR is at least the cap.
   - Effort unknown with a cap prescribed makes the *session* unknown, not failed. Unknown sessions neither count toward the gate nor toward regression.
   - The session clears when the sets required by axis 4 all cleared.
5. **Regress.** If axis 7 is `backoff` and the last *n* sessions all failed to clear (unknown does not count as a failure), suggest `-p%` from the current load and stop.
6. **Recover.** If the last session's load was below the one before it and that drop was not a back-off, offer the earlier load back and stop. This is today's `SI-18`, kept.
7. **Gate.** Count cleared sessions in the window. Below the gate, hold. `was_easy` on the most recent session still satisfies the gate on its own (`SI-13`, kept).
8. **Advance.** Apply axis 6:
   - `load`: current load + increment, snapped to the increment grid.
   - `reps`: target + rep increment.
   - `double`: if `target_reps < rep_range_max`, target + rep increment (capped at max). If already at max, load + increment and target reset to `rep_range_min`.
   - `duration` / `distance`: **target** + increment, not *actual* + increment. Closes `A5`, where beating a 5 km target by 200 m permanently ratcheted the plan.
9. **Readiness.** Apply axis 8: `ignore` passes through, `hold` downgrades to held, `reduce` proposes a back-off. Clears every suggested value, including `adjustedRepsForWeight`, which closes `D2`.

### Reason codes

The `reason` code stays the contract between engine and both consumers (`SI-33`). The set becomes:

`advanced-load`, `advanced-reps`, `advanced-duration`, `advanced-distance`, `reset` (double progression's load-up-reps-down step), `backoff`, `retry`, `re-approach` (staleness), `held`, `held-readiness`, `held-unknown` (effort cap prescribed, effort not logged), `manual`.

Three are new: `reset`, `re-approach`, `held-unknown`. `held-unknown` matters because "you have not told me how hard that was" is a different message from "you have not cleared it enough times", and rendering both as `held` is how the current UI leaves people guessing.

Every reason must be handled in both switch statements (the chip and `pendingProgressions`) in the same change that adds it. That rule already exists as `SI-33` and stays.

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

**Cycle periodization may also want `target_reps`.** The `strength` branch of the sync writes `target_reps`, though nothing currently produces the tag that reaches it (cycle spec `D3`). Double progression also owns `target_reps`. Two writers, one column. This needs deciding before phase 3, and it is decision **D-6** below.

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
| `weight` | preset **Load, confirmed** | Gate carries over from `progression_required_hits`. Scope is decision **D-3**. |
| `smart` | preset **Load, confirmed** | The Epley rep-cut is retired; proper double progression replaces what it approximated. `estimated_1rm` remains as a display, gated per `D1`. This is decision **D-4**. |
| `reps` | preset **Rep ladder** | No change. |
| `time` | preset **Duration** | Advance changes from *actual* to *target* based (section 7, step 8). Slightly slower progression, deliberately. |
| `distance` | preset **Distance** | Same change. |

No existing exercise gets a rep range, so no exercise silently becomes double progression. Ranges are opt-in per exercise.

Historical `workout_sets` rows keep `rpe = 7` from before the change. The engine cannot distinguish those from a real logged 7. Since effort caps are opt-in and no existing exercise has one, no historical row is newly load-bearing. New rows carry null where nothing was logged.

---

## 11. Build order

Each phase ships on its own, is verifiable on its own, and leaves the app working. `pnpm verify` after every phase; the smoke pass in `CLAUDE.md` after any phase touching the set list (2, 5, 6).

**Phase 1: honest effort.** Make `rpe` nullable, stop forging 7, treat null as unknown in the existing engine per `D-2`. Migration plus a small engine change. Verifiable: an uncapped exercise with no effort logged behaves exactly as before (target-only clearing, `D-1`); the fabricated confidence is gone. Add the `held-unknown` reason code to the engine and both switch statements in this phase, even though no exercise can carry a cap until phase 5, so the code path exists before anything depends on it.

**Phase 2: capture.** Long-press miss sheet, the reps-correction fix, offline queue coverage. No engine change. Verifiable by e2e: log a short set, assert `actual_reps` is what you entered and `target_reps` did not move.

**Phase 3: session windows and scope.** Rewrite the history query to session-grouped with a per-exercise window function (closes `D6`), add `progression_scope`, implement clearance per session. This is the phase that delivers 4a. Verifiable by unit tests over the pipeline plus the 4a table as a fixture.

**Phase 4: rep ranges and double progression.** Range columns, validator, `advance: double` with the reset step. Delivers 4b, tested against that table.

**Phase 5: axes, presets, and the sheet.** Remaining axis columns, preset mapping, the extended sentence, the three-layer sheet, the dot detail view. Retire `progression_mode`. Rewrite the `SI` spec against the new engine.

**Phase 6: the rest.** Increment ladder ordering (`A3`), staleness (`A10`), Tired down-weighting (`A6`), readiness `reduce` (`A7`), PR effort gate (`A11`), generated-plan prompt (`D8`).

Phases 1 and 2 are worth doing even if the rest is never built: they make the existing engine tell the truth.

---

## 12. Decisions needed before phase 1

These are open. Each has a recommendation and a reason, and none is assumed anywhere above.

**D-1. Does clearing require the prescribed RIR, or is effort recorded alongside?**
**Decided (2026-08-29): prescribed RIR gates clearing, but only when a cap is set on the exercise.** Opt-in means nobody is blocked by a setting they did not choose, and the people who want autoregulation get it exactly.

Binding consequences for the build:
- An exercise with `target_rir = NULL` clears on target alone. Effort is still recorded when supplied, and still shown, but never blocks.
- An exercise with a cap clears only when the set met its target **and** logged RIR is greater than or equal to the cap. RIR 2 against a cap of 2 clears; RIR 1 does not.
- The cap is per set (`program_sets.target_rir`), so a top set and its back-offs can carry different caps. Under scope `all`, every working set is judged against its own cap.
- This replaces the current absolute ladder (`SI-10`: RPE 8 counts only with an extra rep) for capped exercises. Uncapped exercises keep target-only clearing; the old ladder is retired rather than kept as a third path.

**D-2. What does an unlogged effort mean when a cap is prescribed?**
**Decided (2026-08-29): unknown. Not a clear, not a failure.** The alternative, treating silence as a clear, is what the current RPE 7 default does and is the whole problem.

Binding consequences for the build:
- An unknown session does not increment the gate count and does not count toward the back-off streak (section 7, steps 4 and 5). It is inert in both directions.
- It still occupies a slot in the 5-session window, so a run of unlogged sessions ages real ones out rather than preserving them.
- The suggestion is `held-unknown`, which the chip must render distinctly from `held`. "You have not told me how hard that was" and "you have not cleared it enough times" are different messages and were the same one before.
- Because skipping the prompt stalls progression, the prompt in section 6 change 3 only ever appears on exercises that carry a cap. Nobody is nagged for effort they did not ask to be measured on.

**D-3. Do existing `weight` exercises migrate to scope `all` or scope `set`?**
*Recommendation: `all`.* Per-set drift produces plans nobody would write, so it is a bug rather than a behaviour to preserve. But it changes progression for every existing exercise on the first load after deploy, so it is your call. `set` remains available for exercises where sets genuinely differ.

**D-4. Retire `smart` mode?**
*Recommendation: yes.* Its Epley rep-cut only ever lowers, only fires on a near-max set in the 2 to 12 range, and is a rough approximation of the rep-drop that double progression does properly. Keeping both means two answers to one question.

**D-5. Staleness threshold, and what a re-approach proposes.**
*Recommendation: 21 days, and propose the last logged load minus 10%.* Both numbers are conventions rather than derived, which is exactly why they should be your call rather than mine.

**D-6. When double progression and the cycle's strength phase both want `target_reps`, who wins?**
*Recommendation: the cycle wins for sets it owns, and those sets are excluded from rep advancement, mirroring the anchored-endurance rule.* Note the cycle branch is currently unreachable (cycle spec `D3`), so this can also be resolved by deleting that branch instead, which is the cheaper answer if triathlon strength is meant to stay flat.

**D-7. Should `all` scope require literally every working set, or N of M?**
*Recommendation: literally all, configurable later if it proves too strict.* On 4x12 the last set is the one that falls short, so `all` may stall in practice. Starting strict and loosening on evidence beats the reverse, but you know your own sets better than the model does.

---

## 13. What this closes

On completion, these `BACKLOG.md` entries are resolved and should be deleted:

`A1` (fabricated inputs, phases 1-2), `A2` (`target_rir` unread, phase 5), `A3` (increment ladder order, phase 6), `A4` (no rep range, phase 4), `A5` (endurance ratchets from actual, phase 3), `A6` (Tired erased, phase 6), `A7` (readiness holds only, phase 6), `A8` (per-set drift, phase 3), `A9` (spec describes the function, phase 5), `A10` (no recency, phase 6), `A11` (PRs from assumed reps, phases 1 and 6).

Spec divergences `D1` (ungated 1RM), `D2` (rep cut survives readiness), `D3` and `D4` (timed/distance asymmetries, resolved by the axes), `D5` (bodyweight never progresses, resolved by `advance: reps`), `D6` (window starvation, phase 3), `D8` (generated plans, phase 6).

`D7` (inert global increment settings in Settings) is not addressed here and stays open. It is a Settings question, not a progression-engine one.
