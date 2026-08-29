# Smart incrementation

> **Status:** implemented
> **Last verified:** 2026-08-29 against `f448693`
> **Source of truth:** `src/lib/utils/progression.ts`, `src/lib/utils/progression-presets.ts`, `src/lib/actions/workout-sets.ts` (`getProgressiveSuggestions`), `src/lib/actions/programs.ts` (`applyProgressionToPlan` + the settings actions), `src/lib/validators/workout.ts`, `src/components/features/{WorkoutSetsClient,WorkoutSetsList,SetEditView}.tsx`
>
> Stale check: `git log f448693..HEAD -- src/lib/utils/progression.ts src/lib/actions/workout-sets.ts`
>
> **Rewritten 2026-08-29 by phase 5 of [`../progression-revamp-plan.md`](../progression-revamp-plan.md)**, which completed the rebuild phases 0 to 4 began. The engine is now one machine reading eight configurable axes; `progressionMode` is retired and unread. What changed here: the seven modes became the advance axis (SI-22 to SI-31), the effort cap became real (SI-10), the back-off and readiness rules became settings rather than constants (SI-17, SI-21), duration and distance advance from the target rather than from what was achieved (SI-29, SI-30), an anchored set is never an advance target (SI-30a), and the rate rule (SI-41) and the provenance section below are stated for the first time.

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

Per-exercise settings on `program_exercises`: the six axis columns (`progressionAdvance`, `progressionScope`, `progressionRequiredHits`, `progressionRegress`, `progressionBackoffPct`, `progressionBackoffAfter`, `progressionReadiness`), plus `overloadIncrementKg`, `overloadIncrementReps`, `progressionApplyToPlan`, `exerciseType` and `progressionConfigAt`. Per-set on `program_sets`: `setType`, `targetReps`, `repRangeMin`, `repRangeMax`, `targetRir`, `durationSeconds`, `distanceMeters`, and the cycle anchors `peakDurationSeconds` and `peakDistanceMeters`. Effort from `workout_sets`: `rir` (with `rpe` derived from it, and both null when the lifter reported nothing), `wasEasy`, `isFailed`. Also from `workout_sets`, and load-bearing for SI-7a to SI-7c: `programExerciseId` (which plan slot the row belongs to), `setType` and `prescribedWorkingSets`, all snapshotted at log time so a session describes itself rather than being re-read against today's plan. Schema detail is in [`../data-model.md`](../data-model.md).

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
| `program_sets.target_reps` | the plan; the set editor outside a workout; the ratchet, when the exercise opted in | **Prescribed.** Under `double` it is also *moved by the engine* between the range bounds, which is the one place a suggestion changes what a later session is judged against. |
| `program_sets.target_rir` | the set editor; the progression sheet, across every working set | **Prescribed.** Opt-in, and null on everything that predates the sheet. |
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

*Why:* a stored value means the lifter chose it. Nothing should second-guess a deliberate setting — which is also why null has to mean "unset" rather than "2.5".
*Covered by:* `progressive-suggestions.test.ts` — "ignores profile when user has a custom increment set", "respects explicit 2.5 override even for beginner profile".

### SI-2 — An endurance goal uses 1 kg regardless of load
When the user's goals include `endurance` and no explicit increment is set, the increment is 1 kg at any weight.

*Why:* endurance work wants small, frequent steps; load-zone scaling would hand a 100 kg squat a 5 kg jump that the training intent doesn't want.
*Covered by:* none.

### SI-3 — Experience level overrides the ladder for beginners and advanced only
`beginner` → 5 kg. `advanced` → 1.25 kg. `intermediate` is deliberately **not** handled here and falls through to SI-4.

*Why:* beginners adapt fast enough that small jumps waste sessions; advanced lifters need fine steps. Intermediate has no single right answer, so load-zone scaling is a better guess than a flat number.
*Covered by:* `progressive-suggestions.test.ts` — "uses beginner default of 5kg…", "uses advanced default of 1.25kg…".

### SI-4 — Otherwise the increment scales with current load and movement size

| Base weight | Compound | Non-compound |
|---|---|---|
| < 30 kg | 2.5 kg | 1 kg |
| 30–60 kg | 2.5 kg | 1.25 kg |
| 60–100 kg | 2.5 kg | 2.5 kg |
| > 100 kg | 5 kg | 2.5 kg |

*Why:* a fixed increment is either unliftable at the bottom or trivial at the top. Percentage-of-load is the real intent; these bands approximate it in numbers that match actual plates.
*Covered by:* none directly — exercised indirectly throughout the suite.

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
*Covered by:* `progressive-suggestions.test.ts` — "reads the cap off the set the scope names — last, under scope all", "reads the first set's effort under scope first".

### SI-11 — In weight-bearing modes, a hit only counts at the current load or heavier
Hits logged below the base weight are excluded from the count.

*Why:* without this, hits from *before* the last bump keep counting after it, so `80 hit → 80 hit → 82.5 missed` suggests 85 and the load runs away from the lifter. Double progression means "hit the target twice at **this** weight, then move". Harmless while a suggestion was only a chip; not harmless once it can write to the plan.
*Covered by:* `progressive-suggestions.test.ts` — the "hits must be at the current weight" block.

### SI-12 — The gate is 2 hits, overridable per exercise between 1 and 5
`progressionRequiredHits` overrides the default; null restores it. The validator clamps to 1…`CONSENSUS_WINDOW`.

*Why:* one good session can be luck. The ceiling is the window itself — asking for more hits than the window can hold would be unsatisfiable, so it is rejected at the edge rather than silently freezing the exercise.
*Covered by:* `progressive-suggestions.test.ts` — the "requiredHits override" block; `e2e/progression-settings.spec.ts`.

### SI-13 — A set marked "felt easy" satisfies the gate on its own
When the gate is *not* already met, the most recent logged set is `wasEasy`, and that set met its target (SI-9), progression is offered as if consensus existed. The resulting suggestion is flagged `easyOverride` so the UI can say why.

Three guards are part of the rule: only the most recent session is read; the set must have met its target; and it bypasses the per-exercise gate at whatever value that gate is set to.

*Why:* someone who sets the gate to three sessions and then says "that was easy" has answered the question the gate exists to ask. The met-target guard exists so an easy verdict on a *missed* set can never push load up. A failed set cannot also be easy — the editor clears one when the other is set.
*Covered by:* `progressive-suggestions.test.ts` — the "felt-easy override" block (7 cases).

### SI-14 — Only working sets progress
Any set whose `setType` is not `working` is skipped entirely — no suggestion, and never a ratchet target.

*Why:* warm-ups are a ramp to the working weight, not a prescription to beat.
*Covered by:* `progressive-suggestions.test.ts` — "skips warm-up sets".

## Precedence — SI-15…21

The order below **is** the behaviour. Each step wins outright over everything under it; today this is only discoverable by reading `buildSuggestion` top to bottom.

| # | Step | Wins over | Result |
|---|---|---|---|
| SI-15 | No history | everything | `null` — no chip |
| SI-16 | Advance `none` | everything below | `null` — no chip |
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
*Covered by:* none.

### SI-17 — A run of misses with no clear anywhere in the window backs off
Axis 7 decides whether this fires. With `progressionRegress = 'backoff'` (the default for load schemes), when the last `progressionBackoffAfter` sessions all missed *and* the window holds zero qualifying clears, suggest `progressionBackoffPct` off the base weight, snapped to the increment grid and floored at one increment. With `'hold'`, nothing fires.

Two structural limits, both deliberate: only the load-bearing advances (`load`, `double`, `reps`) can back off at all, because a back-off cuts a weight and a plank has none; and at zero load it is a no-op rather than a suggestion to lift 0 kg.

*Why:* repeated failure at a load is a signal to back off and re-approach, not to keep grinding. The "no clears anywhere in the window" clause stops a single bad patch from overriding evidence the weight is manageable — without it, one rep short on set 4 three sessions running deloads all four sets by 10%, which is the normal state of a 4x12 block and not a stall. It would also make *skipping* set 4 strictly better than grinding it. The floor exists because percentage cuts compound: a lift that keeps missing would otherwise be walked below an empty bar one 10% step at a time.
*Covered by:* `progressive-suggestions.test.ts` — the "deload detection" and "regress axis" blocks; "yields to a deload — three misses outrank an easy verdict".

### SI-18 — A one-off drop in weight is offered back, an intentional deload is not
When the previous session was heavier than the most recent one, suggest returning to the previous weight — **unless** that drop followed 2 or more consecutive misses, which marks it as a deliberate deload.

*Why:* the common case is a bad day or a loading mistake, and the lifter wants their weight back. The guard exists because immediately proposing the weight someone just deloaded away from would undo the deload.
*Covered by:* `progressive-suggestions.test.ts` — the "recovery (retry)" and "deload→retry guard" blocks.

### SI-19 — Same weight with fewer reps is offered back
When the previous session used the same weight but more reps, suggest matching that rep count.

*Why:* the same reason as SI-18 in the rep dimension — reclaim the ground already held before adding more.
*Covered by:* `progressive-suggestions.test.ts` — "suggests previous reps when same weight but fewer reps last session".

### SI-20 — Otherwise the advance decides
See SI-22…33 below.

### SI-21 — Readiness of 1 or 2 does what axis 8 says
`hold` (the default) downgrades any advance to `held-readiness` at the base weight. `ignore` passes it through untouched. `reduce` proposes a back-off instead, reusing the `deload` reason with `readinessModulated` set rather than adding a tenth code for what is a display distinction. All three clear every suggested value and run *after* the advance branch and *before* the easy flag, so **a low-readiness day holds the load whether or not the last set felt easy**.

*Why:* the lifter has said they are under-recovered before touching a bar, and that outranks historical evidence including their own easy verdict. It is an axis rather than a constant because the right answer differs by exercise: an accessory can afford to ignore it, and a heavy compound is where `reduce` earns its place.
*Covered by:* `progressive-suggestions.test.ts` — the "readiness modulation" and "readiness axis" blocks; "yields to low readiness — an easy verdict does not force a bump today".

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
When base weight is 0 (bodyweight), suggest `target + repIncrement` instead. If no rep increment is configured or there is no rep target, the outcome is `held`.

*Why:* there is no kg to add to a chin-up. The `held` fallback is honest about having nothing to propose rather than inventing a number. See divergence **D5** — the practical effect of the default is that bodyweight exercises never progress until a rep increment is set.
*Covered by:* `progressive-suggestions.test.ts` — the "bodyweight fallback" block.

### SI-26 — Retired: `smart` and its rep re-estimate
`smart` mode added weight and attached an Epley-derived rep cut for the heavier load, on a suggestion field of its own. Both are deleted (`D-4`): the cut only ever lowered, only fired on a near-max set in the 2–12 range, and was a rough approximation of the rep drop `double` does properly. `smart` exercises were migrated to plain `load`; none silently became double progression, because no set they left behind carries a rep range.

The number is kept as a rule number rather than reused, so references to SI-26 elsewhere do not silently point at something else.

### SI-27 — The 1RM estimate is display-only, and needs logged effort
`estimated1RM` is attached to a suggestion when the base weight is above zero, the reference set was 2–12 reps, and its logged RIR is 3 or better. Nothing reads it but the badge.

*Why:* Epley is unreliable outside 2–12 reps and meaningless on a set the lifter stopped four reps short of failure. It carried no effort gate at all until this phase, so a displayed 1RM could come from a set the code itself treated as off-curve — and with effort no longer forged, "nothing logged" now means no estimate rather than an estimate built on an assumed 7. Closes divergence `D1`.
*Covered by:* `progressive-suggestions.test.ts` — the "estimated 1RM" block.

### SI-28 — `reps`
Suggest `target + repIncrement` at the same weight, clamped to `repRangeMax` when the set carries one, and holding once the target is already there. Holds when there is no rep target to add to.

*Why:* with no target, there is no safe number to increment — guessing from the last performance would ratchet on a single good day. The ceiling is what stops a rep ladder climbing 8, 9, 10 … 40 with nothing to convert the reps into. A set with no range still has no ceiling, which is the open half of `E-17`.
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

### SI-30 — `distance`
Suggest **`targetDistance` + metresIncrement**, defaulting to 500 m. Weight is always reported as 0.

*Why:* the same as SI-29 — beating a 5 km target by 200 m used to make 5.2 km the prescription.
*Covered by:* `progressive-suggestions.test.ts` — the "distance mode" blocks; "adds the increment to the target".

### SI-30a — An anchored set is never an advance target
A set carrying `peakDurationSeconds` or `peakDistanceMeters` gets `held-anchored` and no suggested value, whatever the window says.

*Why:* the training cycle rewrites those columns weekly from the peak anchor (`PZ` rules in [`cycle-periodization.md`](cycle-periodization.md)). A progression write there is overwritten at best and fights the periodization at worst, and the lifter would watch a number they did not set move twice. The other half of `A5`, and the boundary the two engines were always supposed to keep.
*Covered by:* `progressive-suggestions.test.ts` — "never writes an anchored duration — the cycle owns it", "never writes an anchored distance either".

### SI-31 — Timed and distance work counts any target-meeting session
These advances count any session that met the target as a clear — they do not apply the at-current-load clause (SI-11). They carried their own RPE ≤ 8 filter until SI-10's ladder was retired; it went with it.

*Why:* there is no load to compare a hold or a run against.
*Covered by:* `progressive-suggestions.test.ts` — "time mode effort", "distance mode effort".

### SI-32 — `overloadIncrementReps` carries three different units
Reps in rep-based advances, seconds under `duration`, metres under `distance`. One column, three meanings, disambiguated only by the advance axis.

*Why:* recorded because it is a trap, not because it is good. Anything reading this column must know the advance first. Splitting it is a separate migration and was deliberately out of scope for the rebuild.
*Covered by:* the advance blocks above.

### SI-33 — The `reason` code is the contract
Thirteen values. "Both consumers" is wrong and has been since it was written: **eight sites across four files** branch on a reason, and a new code has to be walked through all of them in the change that adds it — the render switch, the sibling-apply dedup, the `*Pending` computations, the readiness downgrade, the `easyOverride` prefix match, the insight's exercise status, its `progressedCount` filter, and the stagnating headline's `heldCount` filter.

| Reason | Meaning | Ratchet writes? |
|---|---|---|
| `progressed` | More weight | ✓ weight |
| `progressed-reps` | More reps | ✓ reps, only upward |
| `reset` | Double progression: more load, reps back to the bottom of the range | ✓ weight **and** reps, the reps unfloored |
| `progressed-time` | Longer hold | ✓ duration |
| `progressed-distance` | Further | ✓ distance |
| `deload` | Back off, or a low-readiness reduction (`E-7`) | ✓ weight |
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
`held`, `held-readiness`, `held-unknown` and `manual` produce nothing. Every other reason writes only when its value lands **strictly above** what the plan already holds, in whichever dimension it moves. Two exceptions: `deload`, because backing off is the whole point of it, and `reset`'s **rep** write, because dropping the target to the bottom of the range is the other half of raising the load and a floor there blocks double progression outright (`E-1`). `reset`'s load write keeps the floor — a reset that would land below the planned weight is a downgrade with the reps thrown in, so it writes nothing at all.

*Why:* base values come from the most recent *logged* set, not the planned one (see **Base weight**), so after one lighter session a `progressed` suggestion can land **below** the planned number. Unfloored, the ratchet writes it and the "↑" chip silently downgrades the programme: plan 80 kg, two hit sessions at 75, plan rewritten to 77.5. `retry` needs the same floor for a different reason — it reclaims a weight held in a recent session, which says nothing about the plan, so when the plan is already higher there is nothing to reclaim there.

Two things make this easy to get wrong, both of which it was:

- **The floor is measured against the plan, not against today's values.** `pendingProgressions` receives override-folded sets, because "has the lifter already taken this?" is a question about today. "Would this lower the plan?" is a question about the blueprint, and answering it against the override-folded value re-opens the hole whenever the lifter has hand-edited today's set — plan 80, dropped to 70, a 75 suggestion reads as an increase. Hence the separate `planned` field. Both conditions apply: the first keeps the chip settling to a tick once tapped, the second is the floor.
- **There are two consumers and they must not each implement it.** `pendingProgressions` backs the exercise-level apply-all chip; the per-set chip goes through `applySuggestion` in `WorkoutSetsClient`. That function used to build its own payload, and had drifted — no floor, and it wrote the carried-along weight for a rep retry, which the engine does not. It now derives its write from `pendingProgressions` for the single set, so the rule has one implementation.

Display follows the same rule: the chip's arrow is derived from the comparison rather than the reason, so a below-plan `progressed` value renders `↓`, not `↑`. It is still offered for the live session — a session override reflects what was actually lifted and is legitimately allowed to go down.

*Covered by:* `progressive-suggestions.test.ts` — "ignores held, held-readiness and manual suggestions", "writes the reset's lower rep target, which the floor would otherwise block", "refuses a reset whose load sits below the plan", "does not lower a rep target that is already higher", "does not lower a planned weight that is already higher", "does not lower a planned duration…", "does not lower a planned distance…", "does not let a retry lower the plan either", "floors against the plan, not today's override", "still progresses above the plan when today's set was dropped", "still deloads below a planned weight — the floor is progressions only".

### SI-38 — The server re-reads the opt-in flag, and opting out is a success
`applyProgressionToPlan` re-checks `progressionApplyToPlan` and returns success without writing when it is off.

*Why:* a stale tab must not move a plan after the switch was turned off. Leaving the plan alone *is* the requested state, so it is not an error the lifter should be asked to act on.
*Covered by:* none.

### SI-39 — The server re-checks that every set belongs to this slot and is a working set
Ids that don't match are dropped rather than trusted.

*Why:* the payload is client-supplied. Without the re-check, a tampered request could reach another programme's sets.
*Covered by:* none.

### SI-40 — The plan write is best-effort and deliberately doesn't revalidate the live route
Failures are swallowed; the live workout route is not revalidated after a successful write.

*Why:* the session override has already landed, so the lifter's current set is unaffected either way, and a lost write self-heals — the next suggestion is recomputed from logged history and comes back on its own. Refreshing the list mid-set would move the UI under the lifter's finger for no visible change. Surfacing an error mid-lift over a plan edit that self-heals would be worse than the failure.
*Covered by:* none.

## Rate — SI-41

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

Two rows are exceptions to "one increment", and both are bounded by something outside the engine's own output. `double`'s climb can move several reps at once, but only up to a range the lifter chose, and it exists because moving one rep per session leaves the prescription permanently lagging someone who can already do the top of the range. `retry` can move further still, but only back to a number that is already in the log.

Nothing compounds within a session, and nothing accumulates across skipped ones: five clearing sessions in a row propose the same single increment as two do, because the gate is consecutive and the window is bounded by the last load change (SI-11).

*Why:* this rule is stated because nothing stated it, and its absence is what let two separate ratchets through. Duration and distance advanced from what was *achieved* rather than the target, so beating a hold by 30 seconds moved the plan by 30 seconds (SI-29). An early draft of `double` climbed one rep per session against `actualReps >= target`, which meant a lifter doing 12/10/9 against a target of 8 cleared and advanced by exactly one however far past they went. Both are the same failure: an advance sized by performance rather than by a configured step. If a future advance cannot state its step and its bound in one row of the table above, it is not finished.
*Covered by:* `progressive-suggestions.test.ts` — the "one step per session" block.

## Divergences (intent vs code)

Verified against `progression.ts` and `workout-sets.ts` at `f448693` on 2026-08-29.

| # | Rule | Intended | Actual | Status |
|---|---|---|---|---|
| D1 | SI-27 | The Epley estimate is only trustworthy on a near-max set, so anything derived from it should share that guard | **Closed.** `estimated1RM` now requires a logged RIR of 3 or better, and the rep cut that had the guard is deleted with `smart` | closed |
| D2 | SI-21 | A held-readiness suggestion proposes no change at all | **Closed** by deleting the smart rep-cut field it leaked through | closed |
| D3 | SI-17 | Deload eligibility is a deliberate per-mode choice | **Closed.** It is axis 7 now, chosen per exercise. The structural limit that remains — only load-bearing advances can back off — is stated in SI-17 and is not an accident | closed |
| D4 | SI-29, SI-30 | The gate is the window, consistently across advances | **Closed.** The extra "most recent session must meet target" requirement is gone; `duration` and `distance` use the same gate as everything else | closed |
| D5 | SI-25 | Bodyweight exercises progress by reps | The rep fallback needs `overloadIncrementReps > 0`, and that column defaults to `0` (`schema/programs.ts:61`). Out of the box a bodyweight exercise returns `held` forever. The **Rep ladder** preset makes the setting reachable, which is not the same as fixing the default | open |
| D6 | SI-7 | Each exercise slot gets its own 5-session window | **Closed** in phase 3 by the per-slot `DENSE_RANK` | closed |
| D7 | SI-1 | Settings offers a global "Weight Increment" and "Rep Increment" | They persist only to `localStorage` (`defaultIncrementKg` / `defaultIncrementReps`) and **no progression code reads them** — the controls are inert. Noted in [`../gotchas.md`](../gotchas.md#settings-live-in-two-stores) | open — intent needed |
| D8 | SI-12, SI-34 | Generated programmes carry the same settings as hand-built ones | `ai-prompt.ts` still describes the retired modes and never mentions the axes, `progressionRequiredHits` or `progressionApplyToPlan`, so an LLM-generated plan takes the defaults. The import validator accepts the axes; the prompt does not offer them | open |

D5, D7 and D8 remain, and are tracked in `BACKLOG.md` under **Smart-progression UX (deferred long-term)**. D7 needs an intent decision before any code changes — the spec cannot state a rule for it until then.

Already tracked in `BACKLOG.md` rather than repeated here: base weight coming from history rather than the plan (§ Smart-progression UX — "`latest.weightKg` vs program-planned weight quirk"), and `isFailed` not being treated as a hard failure (§ New features — "Surface failed sets in history & metrics").

## Coverage

Rules with no automated test:

| Rule | Why it is untested |
|---|---|
| SI-2 | Endurance-goal increment — no case in the suite |
| SI-8 | The window filter lives in SQL; the unit suite starts from pre-fetched rows |
| SI-16 | Advance `none` returning null |
| SI-38, SI-39, SI-40 | Server-side ratchet guards — no action-level test exists |

Two things the unit suite structurally cannot reach, and neither has another test:

- **The effort cap's resolution against the scope.** `buildSuggestion` takes `effortCap` already resolved; the code that picks *which* set's `target_rir` that is lives in `getProgressiveSuggestions`, beside the query. SI-10b is tested through the resolved value, not through the resolution.
- **The config stamp (`E-13`).** Sessions logged before `progressionConfigAt` are filtered out in the same action, so the rule that stops a settings change re-judging history has no test at all.

Everything else maps to a case in `src/__tests__/progressive-suggestions.test.ts` or `progression-presets.test.ts`, named in the *Covered by* line under each rule. `e2e/progression-settings.spec.ts` covers the preset, the gate, the scope and SI-34 end to end, and doubles as the check that migration `0051` has been applied — a unit test cannot catch a missing migration, and the production symptom is a 500 on tapping a pill.
