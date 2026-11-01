# Smart incrementation

> **Status:** implemented
> **Last verified:** 2026-10-22 against `b265f78`, plus the review pass that follows it
> **Source of truth:** `src/lib/utils/progression.ts`, `src/lib/utils/progression-presets.ts`, `src/lib/actions/workout-sets.ts` (`getProgressiveSuggestions`), `src/lib/actions/programs.ts` (`applyProgressionToPlan` + the settings actions), `src/lib/validators/workout.ts`, `src/components/features/{WorkoutSetsClient,WorkoutSetsList,SetEditView}.tsx`
>
> Stale check: `git log b265f78..HEAD -- src/lib/utils/progression.ts src/lib/actions/workout-sets.ts src/lib/actions/programs.ts` (the first commit listed is the review pass itself)
>
> **Rewritten 2026-08-29 by phases 5 and 6 of [`../progression-revamp-plan.md`](../progression-revamp-plan.md)**, which completed the rebuild. The engine is now one machine reading eight configurable axes; `progressionMode` is retired and unread. What changed here: the seven modes became the advance axis (SI-22 to SI-31), the effort cap became real (SI-10), the back-off and readiness rules became settings rather than constants (SI-17, SI-21), duration and distance advance from the target rather than from what was achieved (SI-29, SI-30), an anchored set is never an advance target (SI-30a), and the rate rule (SI-41) and the provenance section below are stated for the first time. Phase 6 then rewrote the increment ladder's order and added its granularity rule (SI-3, SI-4a), added staleness (SI-14a), gated the 1RM record (SI-42), and made a missing rep increment mean one rep rather than none (SI-28).
>
> **2026-09-07:** added SI-43 and SI-43a — the effort prompt can now be hidden per-exercise (explicit opt-out, or automatically when the advance axis is `none`), independent of the `targetRir` cap.
>
> **2026-10-22, live miss:** SI-9a now judges every logged set against its *own* set's current target, not the target of the set being suggested for; under scope `all` a plan of 8/8/7 gave one session two verdicts. Added SI-46 (a set logged short empties the dots mid-workout and says so) and SI-47 (taking an advance empties them too). SI-12's control moved out of Advanced.
>
> **2026-10-22, review pass:** the engine (`progression.ts`, `progression-presets.ts`) had not changed since the last stamp; the code around it had, and four rules here had drifted from it. Brought back in line: SI-9a (a mid-workout reps edit had started re-prescribing the set again, #57; it now records, with an explicit opt-in to change the target), SI-10b (the effort prompt asked about the last working set whatever the scope), SI-37 (a low-readiness back-off could lower the plan) and SI-40a (every axis write stamped the clock, and an MCP write never did). Added SI-44 (the sheet and the engine run the same advance) and SI-45 (a new working set joins the slot's cap and range). Coverage below gained integration, component and e2e tests.

Smart incrementation decides, for one planned set, whether the lifter should be offered more weight (or reps, seconds, metres) next time — and how much more.

The one idea to hold: **a suggestion is a proposal, never a write.** `buildSuggestion` is a pure function over the last few logged sessions. It returns a `reason` code; the UI renders that as a chip; tapping the chip writes a *session override*. The lifter's plan only moves if the exercise has explicitly opted in to the ratchet.

Rule prefix: **`SI`**.

## Vocabulary

- **Suggestion** — the `SetSuggestion` returned by `buildSuggestion`. Advisory. Recomputed from logged history every time the page loads, so a lost one costs nothing.
- **Session override** — the accepted value, held client-side in `WorkoutSessionContext` and flushed into `workout_sets` on log. Affects today only.
- **Plan** — `program_sets`, the blueprint. Only `applyProgressionToPlan` writes here, and only for opted-in exercises. See [`../workout-and-sets.md`](../workout-and-sets.md) for blueprint-vs-log.
- **Hit** — a logged set that reached its target. That is the whole test; effort does not qualify it (SI-10).
- **Clear** — a *session* verdict, not a set one: every set the exercise's scope names was a hit (SI-7a). A session that did not answer the question is **unknown**, which is neither a clear nor a miss (SI-7b).
- **Scope** — which sets decide that verdict: `all`, `first`, `last` or `set`, on `program_exercises.progression_scope`, defaulting to `all`. Axis 4.
- **Advance** — what moves when the gate is met: `load`, `reps`, `double`, `duration`, `distance`, or `manual`/`none` for the two that move nothing. On `program_exercises.progression_advance`. Axis 6, and the replacement for `progressionMode`, which mixed this question with "what scheme is running" and so could not tell a fixed 12 reps apart from a 6-8 range.
- **Effort cap** — a prescribed reps-in-reserve floor on `program_sets.target_rir`. Axis 3. Named a cap in the UI and the column but tested as `logged RIR >= target_rir`, so it is a **minimum reserve**. Null on almost everything, and null means the exercise clears on the target alone.
- **Preset** — a named set of axis values (`progression-presets.ts`). Derived at render time by matching the live axes, never stored: a stored preset would be display-only state the engine does not read, free to drift from the axes it duplicates. Anything matching no preset is **Custom**.
- **Window** — how many past sessions are looked at (`CONSENSUS_WINDOW`, 5), per exercise slot. **Gate** — how many clears *in a row* inside that window are needed (`requiredHits`, default 2). The window is fixed; the gate is per-exercise.
- **Base weight** — the weight on this set's *most recent logged row*, not the planned weight. Distinct from the **current load**, which under scope `all` is the heaviest working set of the last session and is what an advance is computed from (SI-11a).

## Scope boundary

This spec covers **per-set load progression**. It does not cover **cycle-level volume periodization** — the ramp/deload/taper that scales a training block week by week. That is specified in [`cycle-periodization.md`](cycle-periodization.md) (`PZ`), and mapped in [`../cycles-and-plans.md`](../cycles-and-plans.md).

The two are independent and easy to confuse, because they share words and even a constant name: **`DELOAD_FACTOR` is `0.9` here and `0.75` in `periodization.ts`**. Check which module you are in before quoting a number.

## Inputs

Per-exercise settings on `program_exercises`: the six axis columns (`progressionAdvance`, `progressionScope`, `progressionRequiredHits`, `progressionRegress`, `progressionBackoffPct`, `progressionBackoffAfter`, `progressionReadiness`), plus `overloadIncrementKg`, `overloadIncrementReps`, `progressionApplyToPlan`, `progressionSuppressEffortPrompt`, `exerciseType` and `progressionConfigAt`. Per-set on `program_sets`: `setType`, `targetReps`, `repRangeMin`, `repRangeMax`, `targetRir`, `durationSeconds`, `distanceMeters`, and the cycle anchors `peakDurationSeconds` and `peakDistanceMeters`. Effort from `workout_sets`: `rir` (with `rpe` derived from it, and both null when the lifter reported nothing), `wasEasy`, `isFailed`. Also from `workout_sets`, and load-bearing for SI-7a to SI-7c: `programExerciseId` (which plan slot the row belongs to), `setType` and `prescribedWorkingSets`, all snapshotted at log time so a session describes itself rather than being re-read against today's plan. Schema detail is in [`../data-model.md`](../data-model.md).

`progressionMode` is **not** an input. The column still exists and is still written, so a share, an export or a cached client that predates the axes has something to read, but no progression code reads it. It goes a release after this one.

Two non-obvious ones:

- **`overloadIncrementKg IS NULL` means "the user has never chosen an increment"**, which is what switches on the adaptive ladder (SI-1). The column deliberately has no default; migration `0017` dropped it and nulled out every stored `2.50` precisely so that "2.5" could mean an explicit choice. Do not give this column a default.
- **`overloadIncrementReps` does double duty**: reps in rep-based advances, **seconds** under `duration`, **metres** under `distance` (SI-32).

Readiness (1–5) comes from the active, uncompleted session. User `goals` and `experienceLevel` come from the profile.

## Inputs — provenance

Every rule below is stated over a value, and until this section none of them said where the value came from. That gap is what `A9` names: an engine judged against numbers nobody traced is an engine that can be confidently wrong. **Each row is what actually writes the column, not what ought to.**

| Input | Written by | Provenance |
|---|---|---|
| `workout_sets.actual_reps` | a short tap on the set toggle; the miss sheet (long press); the set editor's reps field during a workout; *Mark set as failed*; the exercise-level checkmark | **Claimed, then measured.** A short tap writes the target — an affirmative claim the lifter made by tapping a "done" control. Every other path writes a count the lifter typed. Nothing infers it. |
| `workout_sets.rir` | the miss sheet; the effort prompt under a capped exercise; *Mark set as failed* (0) | **Reported only.** Silence is stored as null and never filled in. A `?? 7` anywhere in a read is the bug phase 1 removed. |
| `workout_sets.rpe` | derived from `rir` at log time (`rpeFromRir`) | **Derived, or legacy.** Rows predating RIR carry a directly-logged RPE, and rows written by the old forging path carry a real 7 that is indistinguishable from a reported one. Not rewritten — see SI-10. |
| `workout_sets.was_easy` | the set editor's "felt easy" control | **Reported.** Mutually exclusive with `is_failed`; the editor clears one when the other is set. |
| `workout_sets.set_type`, `prescribed_working_sets` | snapshotted from the plan slot at log time | **Measured at the time.** Deliberately not re-derived from today's plan: a session three weeks old is not described by a blueprint edited since (SI-7b, `E-9`). |
| `workout_sets.weight_kg` | the plan, or a session override the lifter accepted or typed | **Claimed.** The engine reads it as what was lifted; nothing verifies it. |
| `program_sets.target_reps` | the plan; the set editor outside a workout, or during one only through its explicit "Also change the program target" toggle; the progression sheet; the ratchet, when the exercise opted in | **Prescribed.** Under `double` it is also *moved by the engine* between the range bounds, which is the one place a suggestion changes what a later session is judged against. |
| `program_sets.target_rir` | the set editor; the progression sheet, across every working set; copied onto a new working set from the slot's last one (SI-45) | **Prescribed.** Opt-in, and null on everything that predates the sheet. |
| `program_exercises.progression_*` | the progression sheet; a preset; sharing, import and MCP | **Configured.** Migration `0051` backfilled the axes from the retired mode; nothing was inferred from history. |
| `workout_sessions.readiness` | the pre-workout check-in | **Reported**, and only from the *active* session (SI-8). |
| `workout_sessions.feeling` | the post-workout check-in | **Reported.** Only `Tired` is load-bearing (SI-7c). |
| `users.goals`, `users.experience_level` | the profile | **Configured**, and only ever used to size an increment (SI-2, SI-3). |
| `exercises.movement_pattern`, `exercise_type` | the exercise library, with a per-program override | **Configured**, and the override wins (SI-5). |

Three things follow, and each of them was a live bug at some point in this engine's history:

- **A claim and a measurement are different, and the engine may not promote one to the other.** Tapping "done" claims the prescription. It does not report an effort, a fatigue level, or a rep count anyone counted.
- **Silence is not a value.** Every nullable input above means "not reported" when null, and no read may substitute a default for it. The one place silence *does* change a verdict is an effort cap, where it makes the session unknown rather than cleared (SI-10a) — inert, not assumed.
- **The engine reads history, and under `double` it also writes what history will be judged against.** That loop is deliberate and bounded by the configured range (SI-28a, SI-41), but it is the only one, and anything new that closes another needs the same argument.

## Increment sizing — SI-1…6

How big a jump is, decided by `adaptiveIncrementKg` (`progression.ts:139`). The first matching rule wins; evaluation stops there.

### SI-1 — An explicit increment always wins
When `overloadIncrementKg` is non-null, that value is the increment. No other rule in this section applies.

Null is reachable from the sheet: its **Auto** chip clears the column (`updateProgramExerciseIncrement` with `null`), handing the step back to the rules below.

*Why:* a stored value means the lifter chose it. Nothing should second-guess a deliberate setting — which is also why null has to mean "unset" rather than "2.5". Without a way back to null, trying one fixed value opted the exercise out of the automatic ladder for good.
*Covered by:* `progressive-suggestions.test.ts` — "ignores profile when user has a custom increment set", "respects explicit 2.5 override even for beginner profile"; `integration/progression.test.ts` — "hands the step back to the automatic ladder with null".

### SI-2 — An endurance goal uses 1 kg regardless of load
When the user's goals include `endurance` and no explicit increment is set, the increment is 1 kg at any weight.

*Why:* endurance work wants small, frequent steps; load-zone scaling would hand a 100 kg squat a 5 kg jump that the training intent doesn't want.
*Covered by:* none.

### SI-3 — Experience level modifies the load zone; it does not replace it
Applied **after** SI-4, to the number SI-4 produced. `beginner` doubles it, `advanced` halves it, `intermediate` leaves it alone.

*Why:* this rule used to return before SI-4 was ever reached, so anyone with a filled-in profile never got load-zone scaling at all — a beginner was handed 5 kg on lateral raises and an advanced lifter 1.25 kg on a 200 kg deadlift. The zone is the part that knows a 20 kg lift and a 200 kg lift are different; the profile only knows how fast this person adapts, which is a multiplier. Intermediate stays unmodified because it has no single right answer and the zone is a better guess than a flat adjustment. Closes `A3`'s first half.
*Covered by:* `progressive-suggestions.test.ts` — the "experience modifies the zone" block.

### SI-4 — Otherwise the increment scales with current load and movement size

| Base weight | Compound | Non-compound |
|---|---|---|
| < 30 kg | 2.5 kg | 1 kg |
| 30–60 kg | 2.5 kg | 1.25 kg |
| 60–100 kg | 2.5 kg | 2.5 kg |
| > 100 kg | 5 kg | 2.5 kg |

*Why:* a fixed increment is either unliftable at the bottom or trivial at the top. Percentage-of-load is the real intent; these bands approximate it in numbers that match actual plates.
*Covered by:* none directly — exercised indirectly throughout the suite.

### SI-4a — The result snaps to a step the equipment can load
`barbell` 2.5 kg, `dumbbell` 2 kg, `machine` and `cable` 1.25 kg, `kettlebell` 4 kg. The increment is rounded to a multiple of that step and floored at one of them. An exercise whose equipment is `bodyweight`, `bands`, unrecognised, or **not recorded at all** is not snapped.

*Why:* 1.25 kg on a barbell is 0.625 kg a side, which almost nobody owns. The number reads precise, cannot be loaded, and the lifter rounds it themselves until the plan and the bar disagree about what the session was. The unclassified exemption matters as much as the rule: most of the library carries no equipment, and defaulting them to a step would coarsen every one of them on no evidence — the opposite of the problem this solves. Closes `A3`'s second half.
*Covered by:* `progressive-suggestions.test.ts` — the "loadable granularity" block.

### SI-5 — "Compound" is resolved from exercise type, with a movement-pattern fallback
When a resolved `exerciseType` exists, compound means exactly `exerciseType === "compound"`. When it is null, fall back to the movement pattern being one of `squat`, `hinge`, `push`, `pull`.

*Why:* the type is a deliberate classification and the pattern is a guess. Prefer the deliberate one; keep the guess so unclassified library rows still size sensibly. See [`../workout-and-sets.md`](../workout-and-sets.md#exercise-type--srclibutilsexercise-typets).
*Covered by:* `exercise-type.test.ts`.

### SI-6 — Suggested weights snap to a multiple of the increment
The new weight is `roundToNearest(base + increment, increment)`, so it lands on the increment's own grid. A zero or negative increment leaves the value untouched.

*Why:* keeps suggestions on loadable numbers instead of accumulating drift from a base weight that was itself off-grid.
*Covered by:* `progressive-suggestions.test.ts` — "rounds to nearest multiple", "returns value unchanged when increment is 0" / "…is negative".

## Confidence and consensus — SI-7…14

Whether a bump is earned at all.

### SI-7 — The window is the 5 most recent sessions for that exercise slot
History is keyed on `program_exercise_id` — the plan slot — and grouped into sessions, each carrying every working set logged against that slot. All the slot's working sets are judged against the same window.

The rank is computed per slot in SQL, so a programme with many exercises cannot starve the later ones; the previous query took a single global row limit and bucketed client-side, which gave uneven set counts uneven windows.

*Why:* "did the workout clear?" is a question about a session. Keying on `exerciseId + setNumber` asked it of one set at a time, so on a 4x12 each set banked its own count and the plan could ratchet to 62.5 / 60 / 60 / 60 with no session having ever cleared. Scope `set` (SI-7a) is where that independence still lives, for exercises whose sets genuinely differ.
*Covered by:* `progressive-suggestions.test.ts` — the "worked example 4a" and "scope decides which sets have to clear" blocks.

### SI-7a — Scope names the sets that decide whether a session cleared
`all` (the default) reads every working set the plan prescribed; `first` reads the first; `last` reads the last; `set` reads that set alone, which is the pre-session behaviour retained per exercise.

A session **cleared** when every set the scope names was a hit (SI-9). `all` is literal: no "N of M" tolerance.

*Why:* a top-set prescription and a straight-set prescription are different questions, and one setting is enough to tell them apart. Strict `all` is deliberate — loosening later is recoverable, tightening changes progression under people mid-programme.
*Covered by:* `progressive-suggestions.test.ts` — the "scope decides which sets have to clear" block.

### SI-7b — A session that cannot answer the question is unknown, not missed
When a set the scope names has no logged row, the session is **unknown**. Under scope `all` that is exactly "fewer working sets logged than the plan prescribed at the time", measured against `workout_sets.prescribed_working_sets` and never against today's plan. When the snapshot is null (pre-migration rows) the count is not checked.

An unknown session is inert in both directions: it does not bank a clear, it does not reset the run of clears, and it does not count toward a back-off. It still consumes a slot in the window.

*Why:* cutting a session short usually says nothing about whether the load is right, and a back-off would be the engine at its most wrong in the situation a lifter is least able to argue with. Treating it as inert rather than forgiving matters too — if it reset the gate, an honest gap would erase banked progress; if it counted, skipping the hard last set would be strictly better than grinding it.
*Covered by:* `progressive-suggestions.test.ts` — the "a partly logged session is unknown" block.

### SI-7c — A Tired session's misses are held harmless, its clears are not
A session marked `feeling = 'Tired'` that did not clear is recorded as unknown (SI-7b). One that cleared counts normally, and either way it supplies the base weight and the "Last: …" line.

*Why:* the previous rule dropped Tired sessions from the window outright, which removed their *successful* sets from the count too and left the lifter reading numbers from weeks ago. Honest self-reporting froze progression, which is the opposite of what the exclusion was for.
*Covered by:* `progressive-suggestions.test.ts` — the "a Tired session's misses are held harmless" block.

### SI-8 — Only completed sessions enter the window
Sessions still in progress are excluded. Tired sessions are no longer filtered out here; SI-7c handles them.

*Why:* excluding the live session means **marking a set easy never affects today — only the next session**.
*Covered by:* none — this filter lives in the SQL of `getProgressiveSuggestions`, which the unit suite doesn't reach.

### SI-9 — A set met its target when it reached the target reps
The target is the row's own `targetReps`, falling back to the program's. With no target at all, any set with more than zero reps counts.

*Why:* open-ended sets ("AMRAP") shouldn't be permanently ineligible for progression just because nothing was prescribed.
*Covered by:* `progressive-suggestions.test.ts` — "returns true for null targets when reps > 0…", "returns false for null targets when actualReps = 0…".

### SI-9a — The rep target is per set, written per exercise, and re-judged when it moves
The prescription lives on each `program_sets` row, so a top set and its back-offs may legitimately ask for different numbers. Three rules follow from that:

**The progression sheet writes one target across every working set of the slot.** `setProgramExerciseSetDefaults` does it, beside the rep range and the effort cap, and warm-ups are untouched (SI-14). During a workout this is the surface that levels a prescription: `SetEditView`'s reps field records what was achieved there, against the target that stands, so a short set reaches the engine as a miss. When the typed number differs from the target, the editor offers one explicit opt-in, "Also change the program target to N", for the other case — the programme itself is wrong. Only with it on does the editor write `program_sets.target_reps` and log the set against the new number.

**The rule sentence quotes a number only when every working set agrees.** `uniformTargetReps` returns null for a spread, and `describeProgressionRule` then says "the target reps".

**A target that moves re-judges the window instead of invalidating it.** A logged set is measured against the harder of the target it was logged under and the target the plan asks now — the plan target of *that set*, read from `ProgramSetData.slotTargets`, not of the set the suggestion is for. Otherwise a plan of 8/8/7 judged set 3's 7 against 8 for sets 1 and 2 (stale, so unknown) and against 7 for set 3 (cleared), and one exercise under scope `all` showed a bump on two rows and a retry on the third. A set that cleared its own target but falls short of a raised one is `stale`, and a session whose only shortfalls are stale is **unknown** with reason `reconfigured` — inert, not a miss. Writing a target therefore does not stamp `progression_config_at`; the rep range and the effort cap still do (SI-40a).

*Why:* a Pull-up prescribed 8/6/6 was read off the first working set, so the sheet promised "+2.5kg once every set hits 8 reps" while two of the three sets asked for 6 — the engine cleared the exercise on evidence the sentence never described, and there was no way to correct it without leaving the workout. Re-judging rather than discarding is what makes the correction affordable: `workout_sets.actual_reps` already records what was done, so a lifter who was doing 8s against a target of 6 keeps the clears they earned. Taking the *harder* of the two numbers is what stops the reverse — cutting a target cannot hand back clears for sessions that missed the number in force at the time.
The opt-in is per edit and off by default. #57 had made every differing number re-prescribe the set, which relabelled "I got 6, not 8" as a clean hit against a target of 6 and moved the plan down without asking.

*Covered by:* `progressive-suggestions.test.ts` — the `uniformTargetReps` block and "buildSuggestion — a changed rep target re-judges past sessions", including "judges each set against its own target, so every set reads a session the same way"; `validators.test.ts` — the `setProgramExerciseSetDefaultsSchema` block; `e2e/progression-settings.spec.ts` — the rep-target section; `components/set-edit-reps.test.tsx` — "records a short set against the target that stands, and leaves the plan alone", "changes the program target too when asked to"; `e2e/progression-suggestion.spec.ts` — "correcting reps mid-workout keeps the plan's target unless asked to change it".

### SI-10 — Effort decides clearing only where a cap is prescribed
An exercise with no effort cap clears on the target alone, whatever the lifter reported about how hard it was — including nothing.

Where a cap **is** prescribed, a session clears only when the deciding set met its target *and* its logged RIR is greater than or equal to the cap. RIR 2 against a cap of 2 clears; RIR 1 does not, and that is a **miss**, not a hold: the reps were there and the reserve was not.

There used to be an absolute ladder on top of SI-9 instead: RPE ≤ 7 counted, RPE 8 counted only with an extra rep, RPE 9–10 never counted, and a missing value was read as 7. It is retired.

*Why:* the ladder had two faults, and the second is the serious one. It judged every exercise against a threshold nobody had chosen, and reading a missing value as 7 turned silence into evidence — with the old logging path writing 7 on every tap, every logged set was a confident hit. The cap is the same idea with both faults removed: opt-in, so nobody is blocked by a setting they did not choose, and compared against what was actually logged.
*Covered by:* `progressive-suggestions.test.ts` — the `metTargetReps` block and the "effort cap" block.

### SI-10a — A cap with no effort logged makes the session unknown
When a cap is prescribed and the deciding set carries no effort at all, the session is **unknown** (SI-7b): it banks nothing, resets nothing, and still consumes a window slot. The suggestion is `held-unknown`, which the UI renders distinctly from `held`.

The order matters: the target question is asked first, so a session that missed its reps is a plain miss whatever its effort says. A cap makes clearing stricter and can never rescue a miss.

*Why:* treating silence as a clear is the RPE-7 default in a new costume. Treating it as a failure would deload someone for not answering a prompt. "You have not told me how hard that was" and "you have not cleared it enough times" are different messages, and rendering both as `held` is how the old UI left people guessing.
*Covered by:* `progressive-suggestions.test.ts` — "holds as unknown, not as a miss, when no effort was logged".

### SI-10b — The set that decides clearing also decides effort
Under scope `all` the effort cap is read from the **last** working set, where reserve is lowest by design. Under `first`, `last` or `set` it is the one set the scope names. Effort logged on other sets is stored and shown but never substitutes.

*Why:* the earlier rule — "the last set carrying logged effort speaks for the session" — contradicted scope `first` by letting two different sets adjudicate one session, and on a top-set prescription it read the back-off's looser floor instead of the top set's. One set decides both questions, and it is the set the scope already named.
The in-workout effort prompt follows the same rule (`effortPromptSet`): it asks about set 1 under `first`, the last working set under `last` and `all`, and under `set` each capped set in turn, once logged and still without an answer. It used to ask about the last working set whatever the scope, so under `first` the deciding set was never asked and every session stayed unknown.

*Covered by:* `progressive-suggestions.test.ts` — "reads the cap off the set the scope names — last, under scope all", "reads the first set's effort under scope first", the `effortPromptSet` block; `integration/progression.test.ts` — "reads the effort cap from the set the scope names (D-8)"; `components/suggestion-chips.test.tsx` — "asks about set 1 under scope first, as soon as it is logged".

### SI-43 — The effort prompt can be hidden per-exercise, independent of the cap
`WorkoutSetsList` renders the effort prompt only when `hideEffortPrompt` is false (`WorkoutSetsList.tsx:324`), on top of the existing per-set gate (the deciding set per SI-10b has a `targetRir`, is logged, and has no effort logged yet). `WorkoutSetsClient` computes that flag as `suppressEffortPrompt || axes.advance === "none"` (`WorkoutSetsClient.tsx:820`): either the lifter explicitly opted out via the "Skip the effort prompt" toggle (`progressionApplyToPlan`'s sibling column, `progressionSuppressEffortPrompt`), or the exercise isn't using the advance axis at all (SI-16), in which case nothing was ever going to read the answer.

This only silences the UI nudge. It does not change SI-10/SI-10a: a cap still decides clearing exactly as before, for any effort that does get logged some other way (the miss sheet's RIR chips).

The flag travels with the program: `exportProgram` and `exportAllPrograms` write it as `suppressEffortPrompt` next to `applyToPlan`, and `importProgram` restores it. An export written before the field existed imports with the prompt shown.

*Why:* SI-10's opt-in principle — "nobody is blocked by a setting they did not choose" — was previously expressed only through the cap itself. An exercise with no progression engagement could still carry a stale cap and get nagged anyway; an exercise with active progression could have a lifter who simply doesn't want to answer. Both are opt-outs the cap alone couldn't express.
*Covered by:* the export round-trip in `integration/progression.test.ts` ("export and import keep the effort-prompt suppression") and `validators.test.ts` ("round-trips the gate and the opt-in").

### SI-43a — Suppressing the prompt while a cap and an active advance both stand leaves the exercise permanently unknown
Turning the toggle on for an exercise that still has `progressionAdvance` other than `none` and a `targetRir` cap prescribed does not touch the cap or the advance — it only stops anything from ever supplying the RIR that SI-10 reads. Per SI-10a, every session on that exercise's deciding set then resolves to `unknown`, indefinitely: never a clear, never a miss.

*Why:* this is a real, and easy to miss, interaction rather than a bug — the toggle is explicitly an opt-out of being asked, and SI-10a already treats unanswered effort as inert rather than assumed. Stated here so the two rules aren't read as contradicting each other.
*Covered by:* none.

### SI-11 — In weight-bearing modes, a hit only counts at the current load or heavier
Hits logged below the base weight are excluded from the count.

*Why:* without this, hits from *before* the last bump keep counting after it, so `80 hit → 80 hit → 82.5 missed` suggests 85 and the load runs away from the lifter. Double progression means "hit the target twice at **this** weight, then move". Harmless while a suggestion was only a chip; not harmless once it can write to the plan.
*Covered by:* `progressive-suggestions.test.ts` — the "hits must be at the current weight" block.

### SI-12 — The gate is 2 hits, overridable per exercise between 1 and 5
`progressionRequiredHits` overrides the default; null restores it. The validator clamps to 1…`CONSENSUS_WINDOW`. The control ("Sessions at target") sits in the progression sheet directly, not under Advanced, and is hidden for `manual` and `none`.

*Why:* one good session can be luck. The ceiling is the window itself — asking for more hits than the window can hold would be unsatisfiable, so it is rejected at the edge rather than silently freezing the exercise.
*Covered by:* `progressive-suggestions.test.ts` — the "requiredHits override" block; `e2e/progression-settings.spec.ts`.

### SI-46 — A set logged short empties the dots during the workout
The dots count completed sessions, so the session in progress is not in them. `liveSessionMiss` reads today's logged sets the way `evaluateSession` will: the scope names the deciding sets, only a logged set can miss (D-9), short is `actualReps < targetReps` (an open-ended set clears on any rep), and a logged RIR below the cap on the set that decides effort is a miss (SI-10b); unlogged effort is not (SI-10a). When it finds one, every row it applies to shows its dots empty with the first ringed amber, the progress sheet leads with what missed, and a toast built by `describeLiveMiss` says the count starts over and what it takes to move. Under scope `set` only the set that missed resets. Un-logging the set takes it back. The toast fires only when a log creates the miss, not when the list mounts on one.

It is display only and writes nothing. The server decides when the session finishes, so a session finished as Tired is still held harmless (SI-7c) even though the dots showed it as a miss.

*Why:* a miss used to leave the dots full until the next workout, which read as "this still counts" at the moment the lifter most needed to hear it did not.
*Covered by:* `live-miss.test.ts`; `components/live-miss-dots.test.tsx`; `e2e/progression-suggestion.spec.ts` — "a set logged short empties the dots on the spot and says the count starts over".

### SI-47 — Taking an advance empties the dots
While an advance is on offer the dots show the run that earned it. Once the set holds the suggested value (the chip has turned to a tick) they show 0, labelled "since the increase", and the progress sheet says the run earned the increase and the count starts again from it. That is what the engine will report after the next session: clears at the old load do not count at the new one (SI-11), and clears of the old rep, time or distance target are stale at the new one (SI-9a). A live miss (SI-46) takes precedence. Display only.

*Why:* "2 of 2" next to a bump already taken read as progress still banked toward another one.
*Covered by:* `components/suggestion-chips.test.tsx` — "progress dots once the advance is taken"; `e2e/progression-suggestion.spec.ts` — "two clean sessions offer a bump, and taking it writes the plan".

### SI-48 — One chip speaks for every set that shares the suggestion
When two or more sets of an exercise carry a suggestion and all of them propose the same move (same reason and same suggested weight, reps, time and distance), and that move is one a chip applies, the chip is shown once, on the first of those sets, labelled `· all N sets` (`sharedSuggestionSets` in `src/lib/utils/suggestion-chip.ts`). The other sets keep their "Last:" line and their dots and show no chip. The shared chip stays live while any set it covers that is not yet logged still lacks the suggested value, including after its own set is logged, and tapping it applies to exactly the sets the sibling propagation already wrote to. A set the lifter edited away from the suggestion in the set editor (it has an override and still lacks the value) is one the propagation skips, so the shared chip does not cover it: that set gets its own chip back, and the shared chip's count and tick leave it out. With fewer than two sets left to cover, every set shows its own chip. When the sets disagree, each keeps its own chip, and the header's apply-all button (`Apply N sets`, or `↑ 82.5kg · N sets` when they agree on a weight) is the one-tap path. The header button is not shown while the shared chip is, since both would apply the same thing.

Which sets are grouped is decided from the suggestions alone, never from what has been logged or applied, so the chip cannot jump between rows during a workout.

The suggestion is still computed for a set that is already logged in the active session. A logged row keeps its "Last:" line, its dots and its settled chip (SI-47), all of which read the suggestion, and the engine call per set is a pure function over a window that is fetched once per slot.

*Why:* under scope `all` every working set showed the same `↑ 82.5 kg`, and one tap already applied it to all of them.
*Covered by:* `components/suggestion-chips.test.tsx` — "one chip per exercise"; `suggestion-chip.test.ts`.

### SI-13 — A set marked "felt easy" satisfies the gate on its own
When the gate is *not* already met, the most recent logged set is `wasEasy`, and that set met its target (SI-9), progression is offered as if consensus existed. The resulting suggestion is flagged `easyOverride` so the UI can say why.

Three guards are part of the rule: only the most recent session is read; the set must have met its target; and it bypasses the per-exercise gate at whatever value that gate is set to.

*Why:* someone who sets the gate to three sessions and then says "that was easy" has answered the question the gate exists to ask. The met-target guard exists so an easy verdict on a *missed* set can never push load up. A failed set cannot also be easy — the editor clears one when the other is set.
*Covered by:* `progressive-suggestions.test.ts` — the "felt-easy override" block (7 cases).

### SI-14 — Only working sets progress
Any set whose `setType` is not `working` is skipped entirely — no suggestion, and never a ratchet target.

*Why:* warm-ups are a ramp to the working weight, not a prescription to beat.
*Covered by:* `progressive-suggestions.test.ts` — "skips warm-up sets".

### SI-45 — A new working set joins the slot's scheme
A working set added to a slot takes the effort cap and the rep range of the slot's last working set, unless the request supplies its own. The range is copied only when the new set's target sits inside it. Warm-ups take neither.

*Why:* under scope `all` the cap is read from the last working set (SI-10b), so a set added without one switched the cap off for the whole exercise and the preset turned into Custom, from an action that looked like "one more set".
*Covered by:* `integration/progression.test.ts` — "carries the slot's effort cap and rep range onto a new working set", "leaves a new warm-up set uncapped".

## Precedence — SI-15…21

The order below **is** the behaviour. Each step wins outright over everything under it; today this is only discoverable by reading `buildSuggestion` top to bottom.

| # | Step | Wins over | Result |
|---|---|---|---|
| SI-15 | No history | everything | `null` — no chip |
| SI-16 | Advance `none` | everything below | `null` — no chip |
| SI-14a | Staleness | back-off, retry, advance, easy | `re-approach` |
| SI-17 | Back-off | retry, advance, easy | `deload` |
| SI-18 | Retry (weight) | advance, easy | `retry` |
| SI-19 | Retry (reps) | advance, easy | `retry` |
| SI-20 | Advance branch | — | `progressed*` / `reset` / `held*` / `manual` |
| SI-21 | Low readiness | any advance | `held-readiness` or `deload` |

### SI-15 — No history means no suggestion
With nothing logged for this exercise and set number, return nothing at all.

*Why:* every number in a suggestion is derived from the last logged set. There is no honest guess to make from zero rows.
*Covered by:* `progressive-suggestions.test.ts` — "returns null with empty rows".

### SI-16 — Advance `none` produces no suggestion object
Distinct from `manual`, which produces a suggestion carrying the current weight and a `manual` reason.

*Why:* `none` means "don't show me anything here"; `manual` means "show me where I am, but don't propose changes". The UI renders a badge for the second and nothing for the first. `manual` is on the advance axis for exactly this reason and is not in the plan's section 5 list: no other column carries the difference between the two.
*Covered by:* `progressive-suggestions.test.ts` — "advance none suggests nothing, even after enough misses to back off (SI-16)".

### SI-14a — An exercise not logged for long enough offers a re-approach
When the most recent session for a slot is older than the exercise's staleness threshold and the base weight is above zero, suggest the last logged load less one back-off (`progressionBackoffPct`, floored at one increment) and stop. The reason is `re-approach`.

The threshold is **21 days, or 2.5x the exercise's own median gap between sessions, whichever is longer**. The median needs at least two sessions; with fewer, the flat 21 days is all there is.

Advances only. `manual` still reports what was done last time — exactly what someone coming back wants to see — and `none` shows nothing either way.

*Why:* the window is the last five sessions whenever they happened, so after three months away the gate was still satisfied by sessions from before the break and the first session back opened with "+2.5 kg" on a weight the lifter had not touched since spring. Detraining was invisible; the date the engine carried was used only to print "Last: …" (`A10`).

It is asked **before** the back-off deliberately. A layoff and a stall want opposite responses — one says the load is too heavy for you, the other says nothing about the load at all — and three missed sessions followed by a three-month break is not a plateau.

The median clause is `E-19`, and it is not a refinement: measured absolutely, an exercise deliberately trained on a three-week rotation sits permanently stale and is offered -10% every single session, which is the engine punishing someone for following their own programme.
*Covered by:* `progressive-suggestions.test.ts` — the "staleness" and `staleThresholdDays` blocks.

### SI-17 — A run of misses with no clear anywhere in the window backs off
Axis 7 decides whether this fires. With `progressionRegress = 'backoff'` (the default for load schemes), when the last `progressionBackoffAfter` sessions all missed *and* the window holds zero qualifying clears, suggest `progressionBackoffPct` off the base weight, snapped to the increment grid and floored at one increment. With `'hold'`, nothing fires.

Two structural limits, both deliberate: only the load-bearing advances (`load`, `double`, `reps`) can back off at all, because a back-off cuts a weight and a plank has none; and at zero load it is a no-op rather than a suggestion to lift 0 kg.

*Why:* repeated failure at a load is a signal to back off and re-approach, not to keep grinding. The "no clears anywhere in the window" clause stops a single bad patch from overriding evidence the weight is manageable — without it, one rep short on set 4 three sessions running deloads all four sets by 10%, which is the normal state of a 4x12 block and not a stall. It would also make *skipping* set 4 strictly better than grinding it. The floor exists because percentage cuts compound: a lift that keeps missing would otherwise be walked below an empty bar one 10% step at a time.
*Covered by:* `progressive-suggestions.test.ts` — the "deload detection" and "regress axis" blocks; "yields to a deload — three misses outrank an easy verdict".

### SI-18 — A one-off drop in weight is offered back, an intentional deload is not
When the previous session was heavier than the most recent one, suggest returning to the previous weight — **unless** that drop followed 2 or more consecutive misses, which marks it as a deliberate deload.

*Why:* the common case is a bad day or a loading mistake, and the lifter wants their weight back. The guard exists because immediately proposing the weight someone just deloaded away from would undo the deload.
*Covered by:* `progressive-suggestions.test.ts` — the "recovery (retry)" and "deload→retry guard" blocks.

### SI-18a — A missed heavy single is not offered back
A previous session that **missed** at a load the plan and the engine never led to is a one-off attempt, not ground to reclaim, and SI-18 does not offer it back. "Led to" means at or below the larger of the plan (the heaviest planned working set under scope `all`, this set's otherwise; `plannedWeights` on `ProgramSetData`) and the heaviest load cleared in the window plus one increment. The plan alone is not enough: taking a chip moves only the session unless the slot opted in to writing the plan (SI-40), so the planned weight routinely sits below what the lifter works at, and a miss one step past their cleared load is an ordinary attempt to take back. A heavier session that **cleared** is always offered back. With no planned weight known, SI-18 applies unchanged.

*Why:* one heavy single could resurface as a "retry 100 kg" chip the next session, built from a set that never met its target.
*Covered by:* `progressive-suggestions.test.ts` — "a missed heavy session above the plan"; `integration/progression.test.ts` — "does not offer a missed heavy single back as a retry".

### SI-19 — Same weight with fewer reps is offered back
When the previous session used the same weight but more reps, suggest matching that rep count.

*Why:* the same reason as SI-18 in the rep dimension — reclaim the ground already held before adding more.
*Covered by:* `progressive-suggestions.test.ts` — "suggests previous reps when same weight but fewer reps last session".

### SI-20 — Otherwise the advance decides
See SI-22…33 below.

### SI-21 — Readiness of 1 or 2 does what axis 8 says
`hold` (the default) downgrades any advance to `held-readiness` at the base weight. `ignore` passes it through untouched. `reduce` proposes a back-off instead, reusing the `deload` reason with `readinessModulated` set rather than adding a tenth code for what is a display distinction. All three clear every suggested value and run *after* the advance branch and *before* the easy flag, so **a low-readiness day holds the load whether or not the last set felt easy**.

*Why:* the lifter has said they are under-recovered before touching a bar, and that outranks historical evidence including their own easy verdict. It is an axis rather than a constant because the right answer differs by exercise: an accessory can afford to ignore it, and a heavy compound is where `reduce` earns its place.
Either way the change is **for today only**: a readiness-modulated suggestion never reaches the plan (SI-37), and the screen says so. A `reduce` back-off reads "lighter today", not "back off"; a `hold` reads "Holding today for low readiness"; the workout banner says only what the exercises' rules actually did, and nothing at all when every exercise ignores readiness.

*Covered by:* `progressive-suggestions.test.ts` — the "readiness modulation" and "readiness axis" blocks; "yields to low readiness — an easy verdict does not force a bump today", "readiness hold, set explicitly, holds the load on a low day"; `components/suggestion-chips.test.tsx` — "names a low-readiness cut as today only, not as a back-off", "says a low-readiness hold is a hold, not a reduction"; `integration/progression.test.ts` — the "getWorkoutInsight on a low-readiness day" block; `e2e/progression-suggestion.spec.ts` — "a low-readiness day under reduce is lighter today and leaves the plan alone".

## The advance axis — SI-22…33

Six values, and a seventh (`manual`) that moves nothing. Two rules that used to live here are gone: SI-26 and SI-27 described `smart`, which is retired outright (`D-4`).

### SI-22 — `none`
No suggestion (SI-16).

### SI-23 — `manual`
Always a `manual` suggestion at the current weight. Never proposes a change.

*Why:* keeps "last time you did X" visible without any autoregulation.
*Covered by:* `progressive-suggestions.test.ts` — "does not deload in manual mode".

### SI-24 — `load`
When progression is earned and the increment is positive, suggest `currentLoad + increment` snapped to the grid; otherwise `held` at base. `currentLoad` under scope `all` is the heaviest working set of the last session, not the lightest and not this set's (SI-11a).

*Covered by:* `progressive-suggestions.test.ts` — the consensus-gate block; "progresses by weight as normal when baseWeight > 0".

### SI-25 — `load` falls back to reps at zero weight
When base weight is 0 (bodyweight), suggest `target + repIncrement` instead, capped by `repRangeMax` when the set carries one. With no rep target at all, or already at the ceiling, the outcome is `held`. As in SI-28, a missing rep increment means one rep.

*Why:* there is no kg to add to a chin-up. The `held` fallback is honest about having nothing to propose rather than inventing a number, and it now only fires where there is genuinely nothing to say.
*Covered by:* `progressive-suggestions.test.ts` — the "bodyweight fallback" block.

### SI-26 — Retired: `smart` and its rep re-estimate
`smart` mode added weight and attached an Epley-derived rep cut for the heavier load, on a suggestion field of its own. Both are deleted (`D-4`): the cut only ever lowered, only fired on a near-max set in the 2–12 range, and was a rough approximation of the rep drop `double` does properly. `smart` exercises were migrated to plain `load`; none silently became double progression, because no set they left behind carries a rep range.

The number is kept as a rule number rather than reused, so references to SI-26 elsewhere do not silently point at something else.

### SI-27 — The 1RM estimate is display-only, and needs logged effort
`estimated1RM` is attached to a suggestion when the base weight is above zero, the reference set was 2–12 reps, and its logged RIR is 3 or better. Nothing reads it but the badge.

*Why:* Epley is unreliable outside 2–12 reps and meaningless on a set the lifter stopped four reps short of failure. It carried no effort gate at all until this phase, so a displayed 1RM could come from a set the code itself treated as off-curve — and with effort no longer forged, "nothing logged" now means no estimate rather than an estimate built on an assumed 7. Closes divergence `D1`.
*Covered by:* `progressive-suggestions.test.ts` — the "estimated 1RM" block.

### SI-28 — `reps`
Suggest `target + repIncrement` at the same weight, clamped to `repRangeMax` when the set carries one, and holding once the target is already there. Holds when there is no rep target to add to. **A missing rep increment means one rep, not none.**

*Why:* with no target, there is no safe number to increment — guessing from the last performance would ratchet on a single good day. The ceiling is what stops a rep ladder climbing 8, 9, 10 … 40 with nothing to convert the reps into.

The one-rep default closes `SI-D5`. `overloadIncrementReps` defaults to `0` and nothing in the app ever set it, so every rep advance was gated behind a value nobody had chosen and a bodyweight exercise could not progress out of the box — the **Rep ladder** preset made the setting reachable, which is not the same as fixing the default. One rep is the smallest move the dimension has, so it is the only honest fallback.
*Covered by:* `progressive-suggestions.test.ts` — the "reps mode" block; "a rep ladder stops at the top of its range".

### SI-28a — `double` climbs the reps, then buys the next range with load
The prescription is `targetReps` as the plan holds it today, and it moves inside `[repRangeMin, repRangeMax]`.

- Below `repRangeMax`: suggest `targetReps` = the reps the **binding set** of the last cleared session actually did, capped at `repRangeMax`, with a floor of one rep increment. Same weight, reason `progressed-reps`.
- At `repRangeMax`: suggest `currentLoad + increment` snapped to the grid, with `targetReps` back to `repRangeMin`. Reason `reset`.

Clearing, the window and the gate are exactly as they are for every other mode: the session clears when every set the scope names met the target in force that day.

*Why:* climbing to what was achieved rather than one rep per session keeps the prescription from lagging a lifter who can already do the top of the range — 12/10/9 against a target of 8 takes the target to 9, and 12/12/12 takes it to the top in one step.
*Covered by:* `progressive-suggestions.test.ts` — "worked example 4b", "double progression, the rest of the range".

### SI-28b — `double` holds rather than climbing past its own range
At `repRangeMax` with no load to add — a zero increment, or a bodyweight exercise — the suggestion is `held`. With no range configured at all, `double` behaves as `weight`.

*Why:* the reset is the only way out of the top of the range, so without an increment there is nothing to buy it with; climbing past a range the lifter configured would be answering a question they did not ask. Nothing can currently configure `double` without a range — the preset picker writes both — so the fallback is a safety net, not a supported shape.
*Covered by:* `progressive-suggestions.test.ts` — "holds at the top of the range when there is no load to add", "holds at the top of the range for a bodyweight exercise", "falls back to load progression when no range is configured".

### SI-29 — `duration`
Suggest **`targetDuration` + secondsIncrement**, defaulting to 10s when unconfigured.

*Why:* the increment is added to the target, not to what was held. Beating a 60s target by 30s used to make 90s the new prescription, so one good session permanently reset what counted as clearing and the plan ratcheted away from the lifter on their best day. Half of `A5`.
*Covered by:* `progressive-suggestions.test.ts` — the "time mode" block; "adds the increment to the target, not to what was held".

### SI-29a — A weighted hold adds weight at a fixed time
A timed set that carries a load (a Pallof Hold on a cable, a loaded carry) progresses the load and keeps the time: once the gate clears, suggest the current load plus the weight increment, with reason `progressed`, and leave the duration alone. Clearing is still holding the target time, but like SI-11 a hold only counts at the current load or heavier. Whether the set is weighted is read from the plan when the slot's planned weights are known, the same data the progression sheet reads, so its sentence and the engine agree; from the logged load otherwise. A plan with a load that has never been logged with one starts from the plan. With no load the set is a plain hold and SI-29 applies. An anchored set still holds (SI-30a). There is no back-off (SI-44). The program editor plans the weight on a timed set, the set row and the summary show it beside the time (`00:30 · 20kg`), and the progression sheet offers the weight step instead of the time step when the exercise's working sets carry a load.

*Why:* a weighted hold could only grow its time, and saving the set from the program editor dropped the weight entirely.
*Covered by:* `progressive-suggestions.test.ts` — "a weighted hold"; `components/set-edit-timed-weight.test.tsx`; `format.test.ts` — "setToken — a weighted hold".

### SI-30 — `distance`
Suggest **`targetDistance` + metresIncrement**, defaulting to 500 m. Weight is always reported as 0.

*Why:* the same as SI-29 — beating a 5 km target by 200 m used to make 5.2 km the prescription.
*Covered by:* `progressive-suggestions.test.ts` — the "distance mode" blocks; "adds the increment to the target".

### SI-30a — An anchored set is never an advance target
A set carrying `peakDurationSeconds` or `peakDistanceMeters` gets `held-anchored` and no suggested value, whatever the window says.

The rule sentence says so too, ahead of every other clause: an anchored exercise reads "your training cycle sets these targets week by week, so progression leaves them alone" rather than quoting an increment it will never apply.

*Why:* the training cycle rewrites those columns weekly from the peak anchor (`PZ` rules in [`cycle-periodization.md`](cycle-periodization.md)). A progression write there is overwritten at best and fights the periodization at worst, and the lifter would watch a number they did not set move twice. The other half of `A5`, and the boundary the two engines were always supposed to keep.
*Covered by:* `progressive-suggestions.test.ts` — "never writes an anchored duration — the cycle owns it", "never writes an anchored distance either".

### SI-31 — Timed and distance work counts any target-meeting session
These advances count any session that met the target as a clear — they do not apply the at-current-load clause (SI-11). They carried their own RPE ≤ 8 filter until SI-10's ladder was retired; it went with it.

*Why:* there is no load to compare a hold or a run against.
*Covered by:* `progressive-suggestions.test.ts` — "time mode effort", "distance mode effort".

### SI-32 — `overloadIncrementReps` carries three different units
Reps in rep-based advances, seconds under `duration`, metres under `distance`. One column, three meanings, disambiguated only by the advance axis.

The sheet shows the rep step wherever the engine reads it: under `reps`, under `double` (beside the weight step), and under `load` on a bodyweight exercise, which climbs reps (SI-25). It used to be shown only under `reps`.

*Why:* recorded because it is a trap, not because it is good. Anything reading this column must know the advance first. Splitting it is a separate migration and was deliberately out of scope for the rebuild.
*Covered by:* the advance blocks above.

### SI-44 — The sheet and the engine run the same advance
An advance the exercise cannot move is snapped before anything reads it, by one function (`effectiveAdvance`): a timed exercise runs on `duration`, a run on anything but `distance` is `manual`, and `manual` and `none` are left alone. The progression sheet displays the snapped value and `getProgressiveSuggestions` passes the same value to the engine.

*Why:* the sheet used to snap and the engine did not, so a timed exercise left on `load` by migration `0051` was described as "Duration" while the engine judged it by reps a timed set never logs, and it held forever. The stored column is not rewritten.

The regress is snapped the same way, by `effectiveRegress`: a back-off cuts the load, so only `load`, `double` and `reps` can run one, and any other advance runs `hold`. The engine's back-off check, the rule sentence and the sheet all read through it, and the sheet does not offer the back-off controls on a timed or distance exercise. Migration `0051` left timed exercises on `load` with `backoff`; they read as the Duration preset, and their sentence no longer promises a back-off the engine never made.
*Covered by:* `progressive-suggestions.test.ts` — the `effectiveAdvance` block; `integration/progression.test.ts` — "runs the scheme the sheet shows: a load advance on a timed exercise runs on duration"; `progression-presets.test.ts` — "the two shapes migration 0051 left behind".

### SI-33 — The `reason` code is the contract
Fourteen values. "Both consumers" is wrong and has been since it was written: **eight sites across four files** branch on a reason, and a new code has to be walked through all of them in the change that adds it — the render switch, the sibling-apply dedup and the pending check (`sameSuggestion`, `suggestionPending` and `CHIP_REASONS` in `suggestion-chip.ts`), the readiness downgrade, the `easyOverride` prefix match, the insight's exercise status, its `progressedCount` filter, and the stagnating headline's `heldCount` filter.

| Reason | Meaning | Ratchet writes? |
|---|---|---|
| `progressed` | More weight | ✓ weight |
| `progressed-reps` | More reps | ✓ reps, only upward |
| `reset` | Double progression: more load, reps back to the bottom of the range | ✓ weight **and** reps, the reps unfloored |
| `progressed-time` | Longer hold | ✓ duration |
| `progressed-distance` | Further | ✓ distance |
| `deload` | Back off, or a low-readiness reduction (`E-7`) | ✓ weight |
| `re-approach` | Not logged in long enough that the window describes someone else (SI-14a) | ✓ weight, unfloored |
| `retry` | Reclaim a previous value | ✓ weight or reps |
| `held` | Gate not met | — |
| `held-readiness` | Earned, suppressed by readiness | — |
| `held-unknown` | An effort cap is prescribed and no effort was logged | — |
| `held-no-increment` | `double` at the top of its range with no load to add (`E-4`) | — |
| `held-anchored` | The training cycle owns this set's target (SI-30a) | — |
| `manual` | Advance is manual | — |

**The family is still named `progressed*`, not `advanced*`, and that is deliberate.** Two of the eight sites match on the string prefix rather than the full value, so a rename would make them match nothing — the `easyOverride` flag and the readiness modulation would silently stop firing, with no type error. The names are internal; the safety is not.

*Why:* a new reason code a consumer doesn't handle silently becomes a no-op, or worse — the two insight sites end in catch-alls, so an unhandled code reports as *stalled* on the dashboard.
*Covered by:* `progressive-suggestions.test.ts` — the `pendingProgressions` block.

## The plan ratchet — SI-34…40

Accepting a suggestion always writes a session override. Whether it also moves the *plan* is opt-in per exercise.

### SI-34 — The ratchet is off by default
`progressionApplyToPlan` defaults to false, which is the historical behaviour: suggestions override the live session and the plan never moves.

*Why:* silently rewriting someone's programme is not a default anyone opted into.
*Covered by:* `e2e/progression-settings.spec.ts`.

### SI-35 — A set is pending only while applying would actually change it
Pending sets are matched against their *current* values with any live session override folded in, so a set drops out the moment it already sits at the suggested numbers.

*Why:* makes the "apply all" affordance honest about how many sets it will move, and keeps a re-tap idempotent.
*Covered by:* `progressive-suggestions.test.ts` — "drops a set that already sits at the suggested weight".

### SI-36 — Completed and non-working sets are never ratchet targets
*Why:* the number a set was logged at is history, not a plan. Warm-ups are excluded per SI-14.
*Covered by:* `progressive-suggestions.test.ts` — "skips completed sets…", "skips warm-up sets".

### SI-37 — Only actionable reasons write, and only a deload lowers the plan
Every `held*` reason and `manual` produce nothing, and neither does any suggestion with `readinessModulated` set — including a `reduce` back-off that carries the `deload` reason (SI-21). Every other reason writes only when its value lands **strictly above** what the plan already holds, in whichever dimension it moves. Three exceptions: `deload`, because backing off is the whole point of it; `re-approach`, which is a back-off by another name (`E-2`); and `reset`'s **rep** write, because dropping the target to the bottom of the range is the other half of raising the load and a floor there blocks double progression outright (`E-1`). `reset`'s load write keeps the floor — a reset that would land below the planned weight is a downgrade with the reps thrown in, so it writes nothing at all.

*Why:* base values come from the most recent *logged* set, not the planned one (see **Base weight**), so after one lighter session a `progressed` suggestion can land **below** the planned number. Unfloored, the ratchet writes it and the "↑" chip silently downgrades the programme: plan 80 kg, two hit sessions at 75, plan rewritten to 77.5. `retry` needs the same floor for a different reason — it reclaims a weight held in a recent session, which says nothing about the plan, so when the plan is already higher there is nothing to reclaim there.

Two things make this easy to get wrong, both of which it was:

- **The floor is measured against the plan, not against today's values.** `pendingProgressions` receives override-folded sets, because "has the lifter already taken this?" is a question about today. "Would this lower the plan?" is a question about the blueprint, and answering it against the override-folded value re-opens the hole whenever the lifter has hand-edited today's set — plan 80, dropped to 70, a 75 suggestion reads as an increase. Hence the separate `planned` field. Both conditions apply: the first keeps the chip settling to a tick once tapped, the second is the floor.
- **There are two consumers and they must not each implement it.** `pendingProgressions` backs the exercise-level apply-all chip; the per-set chip goes through `applySuggestion` in `WorkoutSetsClient`. That function used to build its own payload, and had drifted — no floor, and it wrote the carried-along weight for a rep retry, which the engine does not. It now derives its write from `pendingProgressions` for the single set, so the rule has one implementation.

Display follows the same rule: the chip's arrow is derived from the comparison rather than the reason, so a below-plan `progressed` value renders `↓`, not `↑`. It is still offered for the live session — a session override reflects what was actually lifted and is legitimately allowed to go down.

*Covered by:* `progressive-suggestions.test.ts` — "ignores held, held-readiness and manual suggestions", "writes the reset's lower rep target, which the floor would otherwise block", "refuses a reset whose load sits below the plan", "does not lower a rep target that is already higher", "does not lower a planned weight that is already higher", "does not lower a planned duration…", "does not lower a planned distance…", "does not let a retry lower the plan either", "floors against the plan, not today's override", "still progresses above the plan when today's set was dropped", "still deloads below a planned weight — the floor is progressions only", "never writes a low-readiness back-off to the plan — it is for today only".

### SI-38 — The server re-reads the opt-in flag, and opting out is a success
`applyProgressionToPlan` re-checks `progressionApplyToPlan` and returns success without writing when it is off.

*Why:* a stale tab must not move a plan after the switch was turned off. Leaving the plan alone *is* the requested state, so it is not an error the lifter should be asked to act on.
*Covered by:* `integration/progression.test.ts` — "writes nothing while the slot has not opted in", "writes the accepted weight once opted in".

### SI-39 — The server re-checks that every set belongs to this slot and is a working set
Ids that don't match are dropped rather than trusted.

*Why:* the payload is client-supplied. Without the re-check, a tampered request could reach another programme's sets.
*Covered by:* `integration/progression.test.ts` — "refuses another user's slot", "drops a set that belongs to another slot or is a warm-up".

### SI-40 — The plan write is best-effort and deliberately doesn't revalidate the live route
Failures are swallowed; the live workout route is not revalidated after a successful write. The call goes through `callAction`, so a stale bundle after a deploy still reloads rather than losing the write silently.

*Why:* the session override has already landed, so the lifter's current set is unaffected either way, and a lost write self-heals — the next suggestion is recomputed from logged history and comes back on its own. Refreshing the list mid-set would move the UI under the lifter's finger for no visible change. Surfacing an error mid-lift over a plan edit that self-heals would be worse than the failure.
*Covered by:* none.

## Personal records — SI-42

### SI-42 — An estimated-1RM record needs a near-max set, and older ones are flagged
A new `estimated_1rm` record is written only when the set was 2–12 reps **and** its logged RIR is 3 or better. A set with no effort logged sets no record.

Records of the two **derived** types — `estimated_1rm` and `reps_at_weight`, both computed from `actual_reps` — that were achieved before `HONEST_REPS_FROM` are marked `unverified` and rendered as "set before reps were logged individually". They are not deleted, not recomputed, and still count: beating one is a real PR. Heaviest-weight records carry no flag, having never been assumption-based.

*Why:* Epley over a set the lifter stopped four reps short of failure is arithmetic on a submaximal number, not a 1RM estimate, and this is the figure people screenshot — the worst place for the app to be confidently wrong. The displayed estimate gained this guard with `SI-D1`; the stored record was the half that stayed ungated (`A11`).

The flag is `D-10`, and it is display-only by decision. Before honest logging a tap wrote `actualReps = targetReps`, so a lifter who ground out 6 of a prescribed 8 was credited with 8 and could be shown a trophy they did not earn. Those records may now be unbeatable — but rewriting a user's record history to make the new engine look better would be the same dishonesty the rebuild exists to remove, and an unbeatable record with a visible reason is better than one that reads as a plateau. The cutover is a constant rather than a column, which needs checking at deploy: late over-flags and understates the app's confidence, early presents assumed numbers as measured ones.
*Covered by:* `pr-provenance.test.ts` — the `isUnverifiedPr` block; `integration/progression.test.ts` — the "estimated 1RM records need logged effort (SI-42)" block.

## Rate — SI-41

### SI-40a — A session logged before the rules changed is inert
`program_exercises.progression_config_at` records when a judging rule last moved — the advance, the scope, the gate, the rep range, or an effort cap. A session in the window whose date precedes it is **unknown** (SI-7b) with reason `reconfigured`: it banks nothing, resets nothing, and still supplies the base weight and the "Last: …" line. The increments, the plan opt-in, and the regress, back-off and readiness axes deliberately do not stamp it; they change what an advance writes or what a verdict leads to, not what counts as a clear. One helper, `judgingRuleChanged`, decides it for both writers of the axes — the progression sheet's `setProgramExerciseProgression` and the MCP `edit_program_exercise` update — so an agent changing a rule restarts the window exactly as the sheet does.

Two writes that look like they should stamp it do not. A write that changes **nothing** — tapping the chip that is already lit — leaves the clock alone, because otherwise confirming a setting silently empties the window. And a **rep target** is re-judged from the log rather than discarded (SI-9a), so it never needs the stamp.

Comparison is by date, not timestamp, so a session logged earlier on the day of the change still counts.

*Why:* without it, switching preset or scope re-scores five sessions of history under the new rule and the dot count moves for reasons nothing on screen explains — a lifter asks a question about a setting and their progress appears to change as a result (`E-13`). **Inert rather than dropped** matters just as much: dropping them empties the window, and an empty window returns no suggestion at all, so changing a setting would delete the chip, the dots and the last-session numbers the lifter was reading.
*Covered by:* `progressive-suggestions.test.ts` — the "config stamp" and `judgingRuleChanged` blocks; `integration/progression.test.ts` — the "setProgramExerciseProgression — the config stamp" and "MCP edit_program_exercise update — the config stamp" blocks, and "holds sessions logged before a settings change inert (E-13)".

### SI-41 — One step per session, in one dimension
A suggestion is computed once per session, and it may never propose more than **one step** in the dimension it moves:

| Advance | Step | Bound |
|---|---|---|
| `load` | one increment above `currentLoad` | the increment (SI-1…6) |
| `reps` | one rep increment above the current target | `repRangeMax` when the set has one (SI-28) |
| `double`, climbing | the reps the binding set actually did | `repRangeMax` — a bound the lifter configured |
| `double`, resetting | one load increment, reps to `repRangeMin` | the increment |
| `duration` / `distance` | one increment above the **target** | the increment |
| `deload` | one `progressionBackoffPct` cut | floored at one increment (SI-17) |
| `retry` | a value from a session in the window | something the lifter already did |
| `re-approach` | one back-off below the last logged load | floored at one increment (SI-14a) |

Two rows are exceptions to "one increment", and both are bounded by something outside the engine's own output. `double`'s climb can move several reps at once, but only up to a range the lifter chose, and it exists because moving one rep per session leaves the prescription permanently lagging someone who can already do the top of the range. `retry` can move further still, but only back to a number that is already in the log.

Nothing compounds within a session, and nothing accumulates across skipped ones: five clearing sessions in a row propose the same single increment as two do, because the gate is consecutive and the window is bounded by the last load change (SI-11).

*Why:* this rule is stated because nothing stated it, and its absence is what let two separate ratchets through. Duration and distance advanced from what was *achieved* rather than the target, so beating a hold by 30 seconds moved the plan by 30 seconds (SI-29). An early draft of `double` climbed one rep per session against `actualReps >= target`, which meant a lifter doing 12/10/9 against a target of 8 cleared and advanced by exactly one however far past they went. Both are the same failure: an advance sized by performance rather than by a configured step. If a future advance cannot state its step and its bound in one row of the table above, it is not finished.
*Covered by:* `progressive-suggestions.test.ts` — the "one step per session" block.

## Divergences (intent vs code)

Verified against `progression.ts` and `workout-sets.ts` at `8c3fd1b` on 2026-08-29.

| # | Rule | Intended | Actual | Status |
|---|---|---|---|---|
| D1 | SI-27 | The Epley estimate is only trustworthy on a near-max set, so anything derived from it should share that guard | **Closed.** `estimated1RM` now requires a logged RIR of 3 or better, and the rep cut that had the guard is deleted with `smart` | closed |
| D2 | SI-21 | A held-readiness suggestion proposes no change at all | **Closed** by deleting the smart rep-cut field it leaked through | closed |
| D3 | SI-17 | Deload eligibility is a deliberate per-mode choice | **Closed.** It is axis 7 now, chosen per exercise. The structural limit that remains — only load-bearing advances can back off — is stated in SI-17 and is not an accident | closed |
| D4 | SI-29, SI-30 | The gate is the window, consistently across advances | **Closed.** The extra "most recent session must meet target" requirement is gone; `duration` and `distance` use the same gate as everything else | closed |
| D5 | SI-25, SI-28 | Bodyweight exercises progress by reps | **Closed.** A missing rep increment means one rep. The column still defaults to `0`, deliberately — that is what "unset" looks like, and the engine now reads it as such rather than as "no progression" | closed |
| D6 | SI-7 | Each exercise slot gets its own 5-session window | **Closed** in phase 3 by the per-slot `DENSE_RANK` | closed |
| D7 | SI-1 | The only increment is the per-exercise one | **Closed 2026-09-14** by removing the controls. Settings used to offer a global "Weight Increment" and "Rep Increment" that persisted only to `localStorage` and that no progression code read. The per-exercise increment, and the automatic choice when it is unset, are the whole story | closed |
| D8 | SI-12, SI-34 | Generated programmes carry the same settings as hand-built ones | **Closed.** The prompt describes the advance axis, the gate and the effort cap, and shows a worked rep-range exercise. `progressionApplyToPlan` is still not offered, and that is deliberate: the ratchet rewrites a lifter's plan, and a generator opting them into it is not a default anyone chose (SI-34) | closed |

All divergences are closed.

Already tracked in `BACKLOG.md` rather than repeated here: base weight coming from history rather than the plan (§ Smart-progression UX — "`latest.weightKg` vs program-planned weight quirk"), and `isFailed` not being treated as a hard failure (§ New features — "Surface failed sets in history & metrics").

## Coverage

Rules with no automated test:

| Rule | Why it is untested |
|---|---|
| SI-2 | Endurance-goal increment — covered indirectly by "still lets an explicit increment and an endurance goal win outright" |
| SI-8 | The window filter lives in SQL; the unit suite starts from pre-fetched rows |
| SI-40 | Best-effort by design; a lost write has no visible effect to assert |
| SI-43, SI-43a | The hide flag is computed in `WorkoutSetsClient`, which has no component test; the prompt's own gate is covered under SI-10b |

**The effort cap's resolution against the scope**, which the unit suite cannot reach because `buildSuggestion` takes `effortCap` already resolved, is now covered by `integration/progression.test.ts` against a real database.

Everything else maps to a case named in the *Covered by* line under each rule: the engine in `src/__tests__/progressive-suggestions.test.ts` and `progression-presets.test.ts`; the Server Actions and the MCP settings write in `src/__tests__/integration/progression.test.ts`; the chips and the effort prompt in `src/__tests__/components/suggestion-chips.test.tsx`; the set editor's reps field in `src/__tests__/components/set-edit-reps.test.tsx`. `e2e/progression-suggestion.spec.ts` covers a chip from seeded history to the plan write, the low-readiness day, and the reps correction, on WebKit and Chromium. `e2e/progression-settings.spec.ts` covers the preset, the gate, the scope and SI-34 end to end, and doubles as the check that migration `0051` has been applied — a unit test cannot catch a missing migration, and the production symptom is a 500 on tapping a pill.
