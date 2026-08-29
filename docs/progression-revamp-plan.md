# Progression revamp: plan

> **Status:** approved. All nine decisions (`D-1` to `D-9`) decided 2026-08-29 and written up in section 12 with their binding consequences. Section 14 is a hardening pass: three prerequisites and twelve specified edge cases. Nothing blocks the build.
> **Written:** 2026-08-29 against `197dea1`
> **Supersedes on completion:** the `SI` rules in [`specs/smart-incrementation.md`](specs/smart-incrementation.md), rewritten at the end of phase 5
> **Closes:** audit findings `A1`-`A11` and spec divergences `D1`-`D8` in [`../BACKLOG.md`](../BACKLOG.md)

Progression is the reason this app exists rather than a notes file. It is also the part with the least honest data behind it. This plan rebuilds it as one machine with a small number of settings, so that every progression scheme a lifter actually runs is the same engine with different values, and the app can say in one sentence what it will do next.

Nothing here is a code change yet. Section 12 holds the nine decisions this plan refused to make on its own; all are now answered, each with the consequences the build must honour. Nothing in this document is a guess, and nothing outside section 12 assumes an answer to a question section 12 asks.

---

## 0. Start here (picking this up in a fresh session)

This document is the complete brief. It assumes no conversation history. Read it top to bottom before touching code.

**Repo state at time of writing.** Branch `fix/progression-never-lowers-plan`, seven commits ahead of `main`, not pushed and not smoke-tested. It contains an audit of the current engine and one bug fix that predates this plan: a progression suggestion could lower the plan, because the ratchet compared against the last *logged* value rather than the planned one. That fix stands and this plan builds on top of it. The audit findings it produced are `A1`-`A11` in [`../BACKLOG.md`](../BACKLOG.md); this document is the plan to resolve them.

**Outstanding from that branch, unrelated to this plan:** the Playwright smoke pass was never run, because the webkit browser binary is not installed (`./node_modules/.bin/playwright install webkit`). Anything touching the set list needs it before pushing, per `CLAUDE.md`.

**Read in this order:**

1. This file, sections 1 to 14. **Section 14 is not optional**: it holds three prerequisites (`P-1` to `P-3`) that block phases, including a live data-loss bug, plus twelve edge cases specified in advance.
2. [`specs/smart-incrementation.md`](specs/smart-incrementation.md) for how the current engine behaves. It is accurate about the code and stays the reference until phase 5 rewrites it.
3. `src/lib/utils/progression.ts` (the engine), `src/lib/actions/workout-sets.ts` (`getProgressiveSuggestions`, the history query), `src/components/features/WorkoutSetsClient.tsx` and `WorkoutSetsList.tsx` (both consumers).
4. `BACKLOG.md`, section "Progression engine audit", for the detail behind each finding.

**Decisions: all nine are made.** Read section 12 in full before phase 1, not just the phase you are on. Each carries binding consequences the build must honour, several of which are not derivable from the one-line answer. Build to them and do not relitigate them; if one turns out to be wrong, say so and get it changed there rather than working around it in code.

The short form:

| | Decision |
|---|---|
| `D-1` | A prescribed RIR gates clearing, on capped exercises only. Uncapped exercises clear on target alone. |
| `D-2` | Unlogged effort on a capped exercise is unknown: neither a clear nor a failure, but it still ages the window. |
| `D-3` | Existing exercises migrate to scope `all`. This visibly changes progression for everything already in the app. |
| `D-4` | `smart` mode is retired. `adjustedRepsForWeight` is deleted; `estimated1RM` survives as a gated display value. |
| `D-5` | Stale after 21 days, and a re-approach proposes the last logged load minus 10%. |
| `D-6` | Delete the cycle's strength-phase branch. Progression owns `target_reps`. Preserve the research in the cycle spec. |
| `D-7` | Scope `all` means literally every working set. No `n_of_m`. |
| `D-8` | With a cap, the last set carrying logged effort speaks for the session. |
| `D-9` | A partially logged session is unknown: no gate credit, no back-off credit. |

**Then:** build phase by phase from section 11, one phase per branch. `pnpm verify` after each. The smoke pass from `CLAUDE.md` after phases 2, 5 and 6. Do not start a later phase before the earlier one is merged; the phases are ordered by data dependency, not preference. `D-6` is independent of all of them and can be done at any point, including first, as a self-contained cleanup.

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
| 3 | **Effort cap** | none, or RIR 0-5, **per set** | Whether clearing also requires reps left in reserve. Lives on `program_sets.target_rir`, so a top set and its back-offs can carry different caps. |
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
2. **Assemble the window.** The last 5 *sessions* for this exercise, each carrying every working set logged in it. Not the last 5 rows for one `setNumber`. This is the change that makes axis 4 possible and closes `SI-D6` (the global `LIMIT` starvation) by querying per exercise with a window function.
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
9. **Readiness.** Apply axis 8: `ignore` passes through, `hold` downgrades to held, `reduce` proposes a back-off. Clears every suggested value, including `adjustedRepsForWeight`, which closes `SI-D2`. (Under `D-4` that field is deleted outright, so this becomes moot once phase 5 lands; state it anyway, because phases 1 to 4 still carry it.)

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

Each phase ships on its own, is verifiable on its own, and leaves the app working. `pnpm verify` after every phase; the smoke pass in `CLAUDE.md` after any phase touching the set list (2, 5, 6).

**Phase 0: prerequisites.** `P-2` (the duplicate-slot data loss) and `P-1` (`set_type` on `workout_sets`) from section 14, plus `D-6`'s cycle-branch deletion. All three are independent of the engine and of each other, and `P-2` is losing data today. Doing them first means phase 3 is not blocked behind a schema change to the busiest write path in the app.

**Phase 1: honest effort.** Make `rpe` nullable, stop forging 7, treat null as unknown in the existing engine per `D-2`. Migration plus a small engine change. Verifiable: an uncapped exercise with no effort logged behaves exactly as before (target-only clearing, `D-1`); the fabricated confidence is gone. Add the `held-unknown` reason code to the engine and both switch statements in this phase, even though no exercise can carry a cap until phase 5, so the code path exists before anything depends on it.

**Phase 2: capture.** Long-press miss sheet, the reps-correction fix, offline queue coverage. No engine change. Verifiable by e2e: log a short set, assert `actual_reps` is what you entered and `target_reps` did not move.

**Phase 3: session windows and scope.** **Blocked on `P-1` and `P-2` (section 14); do those first, in their own change.** Then rewrite the history query to session-grouped with a per-exercise window function (closes `SI-D6`), add `progression_scope`, implement clearance per session including the `D-8` and `D-9` rules. This is the phase that delivers 4a. Verifiable by unit tests over the pipeline with the 4a table as a literal fixture (`E-11`).

**Phase 4: rep ranges and double progression.** Range columns, validator, `advance: double` with the reset step, and the `E-1` floor exemption that lets the reset actually write. Delivers 4b, tested against that table (`E-11`). `E-1` is the most likely regression in the plan: test it before writing the feature.

**Phase 5: axes, presets, and the sheet.** Remaining axis columns, preset mapping, the extended sentence, the three-layer sheet, and the dot detail view with the per-session data from `E-8`. Retire `progression_mode` and, per `D-4`, `adjustedRepsForWeight`. Rewrite the `SI` spec against the new engine. The dot detail view is not optional here: `D-7` depends on it to explain a stalled exercise.

**Phase 6: the rest.** Increment ladder ordering (`A3`), staleness (`A10`), Tired down-weighting (`A6`), readiness `reduce` (`A7`), PR effort gate (`A11`), generated-plan prompt (`SI-D8`).

Phases 1 and 2 are worth doing even if the rest is never built: they make the existing engine tell the truth.

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

Evidence behind the decision: `git log -S '"strength"'` returns a single commit, the initial migration, so no producer for the `sessionRole = "strength"` tag was ever written. The triathlon generator explicitly names and rejects the mechanism ("no phase re-prescription (no sessionRole \"strength\")... to spare the CNS so the endurance quality sessions aren't compromised", `triathlon-plan.ts:158-165`). Flat strength is the later, deliberate choice; `strengthPhaseRecipe` is the superseded design it replaced.

Binding consequences for the build:
- Delete the `"strength"` branch in `syncPeriodizedTargets`, `strengthPhaseRecipe`, and its tests. Fix the two docblocks (`periodization.ts:218-230`, `triathlon-plan.ts:12-23`) that still describe the superseded three-strength-day week.
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


**D-8. A per-set effort cap, against a prompt that only asks about the last set.**
**Decided (2026-08-29): the last set with logged effort speaks for the session.**

`D-1` judges each set against its own cap; section 6 prompts once per exercise. Taken literally together, sets 1 to 3 of a capped 4x12 would always be effort-unknown, so under `D-2` the session would never clear. This resolves it.

Binding consequences for the build:
- A capped session clears when **every working set met its target** (per `D-7`) **and** the last working set carrying logged effort satisfies its own cap.
- If no working set has logged effort, the session is `unknown` per `D-2`. The prompt existing is what makes this rare rather than normal.
- Effort logged on an earlier set (via the long-press sheet, section 6 change 2) is still stored and still shown; it just does not override the last set for the clearance test. If the last set has no effort but set 2 does, set 2's effort is used, since it is the last one carrying any.
- This narrows `D-1` rather than contradicting it: per-set caps still exist and are still displayed per set, and a lifter who logs effort on every set gets exactly the per-set behaviour. The rule only decides what happens when effort is partially supplied, which is the normal case.
- **Amend `D-1`'s third bullet accordingly.** It says "under scope `all`, every working set is judged against its own cap". That is the aspiration; this is the operative rule.

**D-9. What does a partially logged session mean?**
**Decided (2026-08-29): unknown. Neither a clear nor a failure.**

Binding consequences for the build:
- A session with fewer logged working sets than the plan prescribes is `unknown`: it does not increment the gate and does not increment the back-off streak, but it does consume a slot in the 5-session window (identical treatment to `D-2`).
- "Fewer than prescribed" is measured against the working sets that existed **in that session** (`E-9`), not against today's plan. Editing 4x12 down to 3x12 does not retroactively complete past sessions.
- The dot detail view (`E-8`) shows "3 of 4 sets logged" for these, so a stalled exercise explains itself. Add `logged`/`prescribed` counts to the `sessions` array in `E-8`.
- Deliberately forgiving: cutting a session short usually has nothing to do with whether the load is right, and punishing it with a back-off would make the engine wrong in exactly the situation a lifter is least able to argue with it.
- The interaction to watch: a lifter who habitually drops the last set will now sit permanently at `unknown` and never progress. That is visible in the dot detail view rather than silent, which is the point, but it is the most likely source of "why is nothing happening" reports. If it shows up, the answer is to edit the prescription to 3 sets, not to loosen this rule.
---

## 13. What this closes

**A warning about `D` numbers.** Three separate things in this repo are numbered `D`. Keep them apart:

- **`D-1` to `D-7`** (hyphenated) are the *decisions* in section 12 of this file.
- **`SI-D1` to `SI-D8`** are the divergences table in [`specs/smart-incrementation.md`](specs/smart-incrementation.md).
- **`PZ-D1` to `PZ-D8`** are the divergences in [`specs/cycle-periodization.md`](specs/cycle-periodization.md).

The specs themselves label their tables plain `D1`-`D8`. Prefix them when writing about them from outside, as below.

**Audit findings** (`BACKLOG.md`, "Progression engine audit"), all resolved on completion and to be deleted from the backlog as each phase lands:

`A1` (fabricated inputs, phases 1-2), `A2` (`target_rir` unread, phase 5), `A3` (increment ladder order, phase 6), `A4` (no rep range, phase 4), `A5` (endurance ratchets from actual, phase 3), `A6` (Tired erased, phase 6), `A7` (readiness holds only, phase 6), `A8` (per-set drift, phase 3), `A9` (spec describes the function, phase 5), `A10` (no recency, phase 6), `A11` (PRs from assumed reps, phases 1 and 6).

The phase numbers above predate phase 0 and refer to the engine phases; phase 0 is prerequisites only and closes no audit finding on its own, though `P-2` closes the standalone duplicate-slot bug recorded beside `A1`.

**Smart-incrementation spec divergences:** `SI-D1` (ungated 1RM, closed by `D-4`), `SI-D2` (rep cut survives readiness, closed by `D-4` deleting the field it leaked through), `SI-D3` and `SI-D4` (timed/distance asymmetries, resolved by the axes making them explicit settings), `SI-D5` (bodyweight never progresses, resolved by `advance: reps`), `SI-D6` (window starvation, phase 3), `SI-D8` (generated plans, phase 6).

**Cycle-periodization spec divergence:** `PZ-D3` (strength phase has no producer), closed by decision `D-6`.

**Stays open:** `SI-D7`, the inert global increment controls in Settings. It is a Settings question, not a progression-engine one, and this plan does not touch it.

---

## 14. Pitfalls, prerequisites and edge cases

A hardening pass over the plan above, done before any code was written. Everything here is either a **prerequisite** that must land before the phase that depends on it, or an **edge case** whose behaviour is specified now so it is not invented under pressure later. Two genuinely open judgement calls became decisions `D-8` and `D-9`.

### Prerequisites

**P-1. A logged set does not record whether it was a warm-up. Blocks phase 3.**

`workout_sets` has no `set_type` column. `set_number` is the positional index across *all* sets including warm-ups (`WorkoutSetsList.tsx:341`), and warm-ups are logged like any other set. Today this is survivable because progression keys on `exercise_id + set_number` and simply skips non-working *program* sets.

Session-scoped clearance (`D-7`, every working set must clear) cannot work this way. To ask "did every working set clear in the session three weeks ago" you would have to join back to `program_sets` by `set_number` and read today's `set_type`, which is wrong the moment the plan changed. Sets can be added, deleted and drag-reordered (`set-mapping.ts`), so the historical join is not reliable.

*Required:* add `set_type` to `workout_sets`, written at log time from the program set. Logs must be self-describing; a historical session's meaning cannot depend on the current blueprint. Backfill existing rows by joining to `program_sets` on `set_number` as a best effort, accepting that pre-migration rows may be slightly wrong, since they are only read for five sessions of history.

*While you are there:* `set_number` should keep counting warm-ups (do not renumber), because renumbering would break the `(session, exercise, set_number)` identity of every existing row.

**P-2. The same exercise twice in one program silently destroys logged data. Blocks phase 3, and is a live bug today.**

Nothing stops a program holding two `program_exercises` slots for the same exercise, which is a normal thing to want (heavy bench, then a back-off bench). But `workout_sets` is uniquely indexed on `(session_id, exercise_id, set_number)` and `logSet` uses `onConflictDoUpdate` (`workout-sets.ts:222-247`). So logging set 1 of the second slot **overwrites set 1 of the first slot**. The heavy set's weight, reps and effort are gone, replaced by the back-off's.

The `onConflictDoUpdate` is correct for its intended purpose (re-logging a set must overwrite, and offline replays must be idempotent). The identity is what is wrong: a logged set is identified by exercise and position, when it should be identified by the plan slot it came from.

*Required:* add `program_exercise_id` (and ideally `program_set_id`) to `workout_sets`, and move the unique index to `(session_id, program_exercise_id, set_number)`, keeping `exercise_id` for cross-program queries like PRs. This also makes session-scoped clearance exact instead of inferred, and it is the same change `P-1` wants.

*Recorded separately in `BACKLOG.md` as a standalone bug*, because it is losing data today regardless of whether this plan proceeds.

**P-3. The logging payload changes shape while old clients are still installed.**

This is a PWA; cached bundles keep calling the old Server Action for a while, and the offline queue can hold payloads written by a previous version. Phase 1 makes `rpe` nullable and stops sending 7; phase 2 sends real `actual_reps`.

*Required:* the validator accepts both shapes for at least one release. `rpe` becomes optional rather than removed, and a payload that still carries `rpe: 7` with no `rir` is stored as-is. Do **not** treat a legacy `rpe: 7` as "unknown" retroactively: it is indistinguishable from a real logged 7, and rewriting history to make the new engine look better is worse than the imprecision. See section 10.

### Specified edge cases

These have a defensible answer, so the plan states it rather than raising a decision.

**E-1. `reset` must be exempt from the rep floor.** Double progression's reset step raises load and *lowers* `target_reps` back to `rep_range_min`. The plan ratchet's rule (`SI-37`) is that only a back-off lowers the plan. `reset` must be added to that exemption for the rep dimension while still raising load, or phase 4's headline behaviour is blocked by phase 0's bug fix. Test this explicitly; it is the single most likely regression in the whole plan.

**E-2. `re-approach` may lower the plan.** It is a back-off by another name (`D-5`), so it is exempt from the floor exactly as `backoff` is.

**E-3. Under scope `all`, an advance applies uniformly to every working set.** Not per set. On 4x12 the whole exercise moves to 62.5 together, which is the entire point of `D-3`. Under scope `set` the current per-set behaviour is retained. Under `first` and `last`, the scope decides *whether* the session cleared; the advance still applies to all working sets, because a top set moving while its back-offs stay is a plan nobody wrote.

**E-4. `advance: double` requires a positive load increment.** At `rep_range_max` with no load to add, the reset cannot happen and the exercise would sit at the top of its range forever. The sheet must not offer `double` without an increment, and the engine holds with `held-unknown`'s sibling message ("no load increment set") rather than silently climbing past the range the user configured. Bodyweight work uses `advance: reps` and no range, which is what `SI-D5` was really asking for.

**E-5. Ranges apply to reps only.** `duration` and `distance` take a fixed target. A range plus `advance: double` has no meaning for a plank or a run, and section 3's table should be read as fixed-target for those two presets. This narrows what phase 4 has to build.

**E-6. `was_easy` bypasses the gate at session level.** Under scope `all`, an easy verdict on one set does not carry the session. The rule becomes: the session cleared, and at least one of the scope-determining sets was marked easy. This preserves `SI-13`'s intent without letting one easy set speak for four.

**E-7. Readiness `reduce` reuses the `backoff` reason code** with `readinessModulated: true`, rather than adding a tenth code. Both consumers already branch on `backoff`, and the distinction is a display concern (the chip says why), not a different write.

**E-8. The dot detail view needs data the suggestion does not carry today.** `SetSuggestion` has `hitsAchieved` and `hitsRequired` but no per-session breakdown. Add `sessions: { date, status, shortfall? }[]` covering the window, where status is `cleared` / `missed` / `unknown`. Without it, `D-7`'s strictness has no explanation on screen, and `D-7` explicitly depends on that view existing.

**E-9. A session's clearance is judged against what was logged in it, never against the current plan.** If a 4x12 exercise is later edited to 3x12, the four-set sessions in the window are still four-set sessions. This follows from `P-1` and is why the log must be self-describing.

**E-10. Cross-programme history stays separate.** The history query filters by `program_id`. Bench in "Push 1" and bench in "Push 2" progress independently, and that stays true. It is defensible (different slots, different prescriptions) but it has never been written down, so it is written down here.

**E-11. Test fixtures come from sections 4a and 4b.** Both worked examples are session-by-session tables and should be encoded literally as unit-test fixtures, asserting the suggestion and the dot count at every step. If the code disagrees with those tables, the code is wrong.

**E-12. Rollback.** Every migration is additive (new nullable columns, one column made nullable), so a code rollback needs no down-migration. The exception is `D-3`'s scope migration, which changes behaviour rather than shape: record the previous `progression_mode` values before overwriting, so behaviour can be restored without guessing.
