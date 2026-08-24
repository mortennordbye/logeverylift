# Smart incrementation

> **Status:** implemented
> **Last verified:** 2026-08-24 against `3a09857`
> **Source of truth:** `src/lib/utils/progression.ts`, `src/lib/actions/workout-sets.ts` (`getProgressiveSuggestions`), `src/lib/actions/programs.ts` (`applyProgressionToPlan` + the settings actions), `src/lib/validators/workout.ts`, `src/components/features/{WorkoutSetsClient,WorkoutSetsList,SetEditView}.tsx`
>
> Stale check: `git log 3a09857..HEAD -- src/lib/utils/progression.ts src/lib/actions/workout-sets.ts`

Smart incrementation decides, for one planned set, whether the lifter should be offered more weight (or reps, seconds, metres) next time — and how much more.

The one idea to hold: **a suggestion is a proposal, never a write.** `buildSuggestion` is a pure function over the last few logged sessions. It returns a `reason` code; the UI renders that as a chip; tapping the chip writes a *session override*. The lifter's plan only moves if the exercise has explicitly opted in to the ratchet.

Rule prefix: **`SI`**.

## Vocabulary

- **Suggestion** — the `SetSuggestion` returned by `buildSuggestion`. Advisory. Recomputed from logged history every time the page loads, so a lost one costs nothing.
- **Session override** — the accepted value, held client-side in `WorkoutSessionContext` and flushed into `workout_sets` on log. Affects today only.
- **Plan** — `program_sets`, the blueprint. Only `applyProgressionToPlan` writes here, and only for opted-in exercises. See [`../workout-and-sets.md`](../workout-and-sets.md) for blueprint-vs-log.
- **Hit** — a logged set that reached its target. **Confident hit** — a hit that also had effort in reserve (SI-10). Only confident hits count toward progression.
- **Window** — how many past sessions are looked at (`CONSENSUS_WINDOW`, 5). **Gate** — how many confident hits inside that window are needed (`requiredHits`, default 2). The window is fixed; the gate is per-exercise.
- **Base weight** — the weight on the *most recent logged set*, not the planned weight. Everything is computed relative to it.

## Scope boundary

This spec covers **per-set load progression**. It does not cover **cycle-level volume periodization** — the ramp/deload/taper that scales a training block week by week. That lives in `src/lib/utils/periodization.ts` and is documented in [`../cycles-and-plans.md`](../cycles-and-plans.md).

The two are independent and easy to confuse, because they share words and even a constant name: **`DELOAD_FACTOR` is `0.9` here and `0.75` in `periodization.ts`**. Check which module you are in before quoting a number.

## Inputs

Per-exercise settings on `program_exercises`: `progressionMode`, `overloadIncrementKg`, `overloadIncrementReps`, `progressionRequiredHits`, `progressionApplyToPlan`, `exerciseType`. Per-set on `program_sets`: `setType`, `targetReps`, `durationSeconds`, `distanceMeters`. Effort from `workout_sets`: `rir` (with `rpe` derived from it), `wasEasy`, `isFailed`. Schema detail is in [`../data-model.md`](../data-model.md).

Two non-obvious ones:

- **`overloadIncrementKg IS NULL` means "the user has never chosen an increment"**, which is what switches on the adaptive ladder (SI-1). The column deliberately has no default; migration `0017` dropped it and nulled out every stored `2.50` precisely so that "2.5" could mean an explicit choice. Do not give this column a default.
- **`overloadIncrementReps` does double duty**: reps in rep-based modes, **seconds** in `time` mode, **metres** in `distance` mode (SI-32).

Readiness (1–5) comes from the active, uncompleted session. User `goals` and `experienceLevel` come from the profile.

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

### SI-7 — The window is the 5 most recent sessions for that exercise *and set number*
History is keyed on `exerciseId + setNumber`, so set 1 progresses independently of set 3.

*Why:* the top set and a back-off set are different prescriptions and drift apart legitimately.
*Covered by:* implicitly by every `buildSuggestion` test.

### SI-8 — Only completed, non-"Tired" sessions enter the window
Sessions still in progress are excluded, and so is any session the lifter marked `feeling = 'Tired'`.

*Why:* two consequences worth stating outright. Excluding the live session means **marking a set easy never affects today — only the next session**. Excluding Tired sessions stops a bad-day miss from counting toward a deload the lifter doesn't need.
*Covered by:* none — this filter lives in the SQL of `getProgressiveSuggestions`, which the unit suite doesn't reach.

### SI-9 — A set met its target when it reached the target reps
The target is the row's own `targetReps`, falling back to the program's. With no target at all, any set with more than zero reps counts.

*Why:* open-ended sets ("AMRAP") shouldn't be permanently ineligible for progression just because nothing was prescribed.
*Covered by:* `progressive-suggestions.test.ts` — "returns true for null targets when reps > 0…", "returns false for null targets when actualReps = 0…".

### SI-10 — A confident hit is a hit with reserve left
On top of SI-9: RPE ≤ 7 counts; RPE 8 counts only if the lifter did *more* than the target; RPE 9–10 never counts. Missing RPE is treated as 7.

Because `rpe = 10 − rir`, this reads in RIR terms as: RIR ≥ 3 counts, RIR 2 counts only with an extra rep, RIR 0–1 never.

*Why:* hitting the target at a maximal grind is not evidence you can hold more weight. Treating a missing RPE as neutral keeps pre-RIR history usable instead of freezing those exercises.
*Covered by:* `progressive-suggestions.test.ts` — the `isConfidentHit` block; "holds when all sessions are RPE 9-10 hits".

### SI-11 — In weight-bearing modes, a hit only counts at the current load or heavier
Hits logged below the base weight are excluded from the count.

*Why:* without this, hits from *before* the last bump keep counting after it, so `80 hit → 80 hit → 82.5 missed` suggests 85 and the load runs away from the lifter. Double progression means "hit the target twice at **this** weight, then move". Harmless while a suggestion was only a chip; not harmless once it can write to the plan.
*Covered by:* `progressive-suggestions.test.ts` — the "hits must be at the current weight" block.

### SI-12 — The gate is 2 confident hits, overridable per exercise between 1 and 5
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
| SI-16 | Mode `none` | everything below | `null` — no chip |
| SI-17 | Deload | retry, mode, easy | `deload` |
| SI-18 | Retry (weight) | mode, easy | `retry` |
| SI-19 | Retry (reps) | mode, easy | `retry` |
| SI-20 | Mode branch | — | `progressed*` / `held` / `manual` |
| SI-21 | Low readiness | any `progressed*` | `held-readiness` |

### SI-15 — No history means no suggestion
With nothing logged for this exercise and set number, return nothing at all.

*Why:* every number in a suggestion is derived from the last logged set. There is no honest guess to make from zero rows.
*Covered by:* `progressive-suggestions.test.ts` — "returns null with empty rows".

### SI-16 — Mode `none` produces no suggestion object
Distinct from `manual`, which produces a suggestion carrying the current weight and a `manual` reason.

*Why:* `none` means "don't show me anything here"; `manual` means "show me where I am, but don't propose changes". The UI renders a badge for the second and nothing for the first.
*Covered by:* none.

### SI-17 — Three straight misses with no confident hit is a deload
In `weight`, `smart` and `reps` modes only: when the 3 most recent sessions all missed their target *and* the window holds zero confident hits, suggest 90% of base weight, snapped to the increment grid.

*Why:* repeated failure at a load is a signal to back off and re-approach, not to keep grinding. The "no confident hits anywhere in the window" clause stops a single bad patch from overriding evidence the weight is manageable.
*Covered by:* `progressive-suggestions.test.ts` — the "deload detection" block; "yields to a deload — three misses outrank an easy verdict".

### SI-18 — A one-off drop in weight is offered back, an intentional deload is not
When the previous session was heavier than the most recent one, suggest returning to the previous weight — **unless** that drop followed 2 or more consecutive misses, which marks it as a deliberate deload.

*Why:* the common case is a bad day or a loading mistake, and the lifter wants their weight back. The guard exists because immediately proposing the weight someone just deloaded away from would undo the deload.
*Covered by:* `progressive-suggestions.test.ts` — the "recovery (retry)" and "deload→retry guard" blocks.

### SI-19 — Same weight with fewer reps is offered back
When the previous session used the same weight but more reps, suggest matching that rep count.

*Why:* the same reason as SI-18 in the rep dimension — reclaim the ground already held before adding more.
*Covered by:* `progressive-suggestions.test.ts` — "suggests previous reps when same weight but fewer reps last session".

### SI-20 — Otherwise the mode decides
See SI-22…33 below.

### SI-21 — Readiness of 1 or 2 holds every progression
Any `progressed*` outcome is downgraded to `held-readiness` at the base weight, flagged `readinessModulated`. Runs *after* the mode branch and *before* the easy flag, so **a low-readiness day holds the load whether or not the last set felt easy**.

*Why:* the lifter has said they are under-recovered before touching a bar. That outranks historical evidence, including their own easy verdict from a previous session.
*Covered by:* `progressive-suggestions.test.ts` — the "readiness modulation" block; "yields to low readiness — an easy verdict does not force a bump today".

## The seven modes — SI-22…33

### SI-22 — `none`
No suggestion (SI-16).

### SI-23 — `manual`
Always a `manual` suggestion at the current weight. Never proposes a change.

*Why:* keeps "last time you did X" visible without any autoregulation.
*Covered by:* `progressive-suggestions.test.ts` — "does not deload in manual mode".

### SI-24 — `weight`
When progression is earned and the increment is positive, suggest `base + increment` snapped to the grid; otherwise `held` at base.

*Covered by:* `progressive-suggestions.test.ts` — the consensus-gate block; "progresses by weight as normal when baseWeight > 0".

### SI-25 — `weight` and `smart` fall back to reps at zero weight
When base weight is 0 (bodyweight), suggest `target + repIncrement` instead. If no rep increment is configured or there is no rep target, the outcome is `held`.

*Why:* there is no kg to add to a chin-up. The `held` fallback is honest about having nothing to propose rather than inventing a number. See divergence **D5** — the practical effect of the default is that bodyweight exercises never progress until a rep increment is set.
*Covered by:* `progressive-suggestions.test.ts` — the "bodyweight fallback" block.

### SI-26 — `smart` adds weight and re-estimates the rep target
As `weight`, plus an Epley-derived `adjustedRepsForWeight` telling the lifter how many reps the heavier load is worth.

*Covered by:* `progressive-suggestions.test.ts` — the "smart mode" block.

### SI-27 — The rep re-estimate is guarded, and only ever lowers the target
Computed only when base weight > 0, the last set was 2–12 reps, the last set was RPE ≥ 7, and the new weight is above the old. Applied only when the estimate is *below* the current target.

*Why:* Epley is unreliable outside 2–12 reps and meaningless on a sub-maximal set, which is not on the curve. Only lowering avoids the absurd result of a heavier weight being prescribed for *more* reps.
*Covered by:* `progressive-suggestions.test.ts` — "skips adjustedRepsForWeight on sub-max sets (RPE < 7)…", "…when weight is 0…", "…for actualReps > 12…".

### SI-28 — `reps`
Suggest `target + repIncrement` at the same weight. Holds when there is no rep target to add to.

*Why:* with no target, there is no safe number to increment — guessing from the last performance would ratchet on a single good day.
*Covered by:* `progressive-suggestions.test.ts` — the "reps mode" block.

### SI-29 — `time`
Suggest `lastDuration + secondsIncrement`, defaulting to 10s when unconfigured. Requires the most recent set to have met the target duration.

*Covered by:* `progressive-suggestions.test.ts` — the "time mode" block; "defaults to 10s increment when overloadIncrementReps is 0".

### SI-30 — `distance`
Suggest `lastDistance + metresIncrement`, defaulting to 500 m. Requires the most recent set to have met the target distance. Weight is always reported as 0.

*Covered by:* `progressive-suggestions.test.ts` — the "distance mode" blocks.

### SI-31 — Timed and distance work uses a plain RPE ≤ 8 gate
These modes count any target-meeting session at RPE ≤ 8 as a hit — they do not apply the extra-rep clause (SI-10) or the at-current-load clause (SI-11).

*Why:* "one more rep than target" has no meaning for a hold or a run, and there is no load to compare against.
*Covered by:* `progressive-suggestions.test.ts` — "time mode RPE confidence", "distance mode RPE confidence".

### SI-32 — `overloadIncrementReps` carries three different units
Reps in rep-based modes, seconds in `time`, metres in `distance`. One column, three meanings, disambiguated only by `progressionMode`.

*Why:* recorded because it is a trap, not because it is good. Anything reading this column must know the mode first.
*Covered by:* the mode blocks above.

### SI-33 — The `reason` code is the contract
Nine values, and both consumers (the chip UI and the ratchet) branch on them exhaustively.

| Reason | Meaning | Ratchet writes? |
|---|---|---|
| `progressed` | More weight | ✓ weight (+ rep cut if any) |
| `progressed-reps` | More reps | ✓ reps, only upward |
| `progressed-time` | Longer hold | ✓ duration |
| `progressed-distance` | Further | ✓ distance |
| `deload` | Back off 10% | ✓ weight |
| `retry` | Reclaim a previous value | ✓ weight or reps |
| `held` | Gate not met | — |
| `held-readiness` | Earned, suppressed by readiness | — |
| `manual` | Mode is manual | — |

*Why:* a new reason code that either consumer doesn't handle silently becomes a no-op. Add one only alongside both switch statements.
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

### SI-37 — Only actionable reasons write; a rep target is never lowered
`held`, `held-readiness` and `manual` produce nothing. `progressed-reps` writes only when the suggestion is above the current target. `deload` does write — a downward move is still a move.

*Why:* holding is a decision to leave the plan alone. The rep floor stops a suggestion built from a weaker session from quietly reducing the prescription.
*Covered by:* `progressive-suggestions.test.ts` — "ignores held, held-readiness and manual suggestions", "does not lower a rep target that is already higher", "includes deloads…".

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

## Divergences (intent vs code)

Verified against `progression.ts` and `workout-sets.ts` at `3a09857` on 2026-08-24.

| # | Rule | Intended | Actual | Status |
|---|---|---|---|---|
| D1 | SI-27 | The Epley estimate is only trustworthy on a near-max set, so anything derived from it should share that guard | `estimated1RM` is attached to every suggestion with **no RPE gate** (`progression.ts:419`), while `adjustedRepsForWeight` requires RPE ≥ 7 for the same formula (`:615-621`). A displayed 1RM can come from a set the code itself treats as off-curve | open |
| D2 | SI-21 | A held-readiness suggestion proposes no change at all | The downgrade clears `suggestedReps`, `suggestedDurationSeconds` and `suggestedDistanceMeters` but **not** `adjustedRepsForWeight` (`:708-717`), so a held smart suggestion can still carry a rep cut. The ratchet ignores it (SI-37), so this is display-only today | open |
| D3 | SI-17 | Deload eligibility is a deliberate per-mode choice | `canDeload` covers `weight\|smart\|reps` (`:473`); timed and distance work can never deload. The adjacent comment says "not manual, not time" and omits `distance`, so it is unclear whether the exclusion was decided or inherited | open — intent needed |
| D4 | SI-29, SI-30 | The gate is the window, consistently across modes | `time` and `distance` additionally require the **most recent** row to meet target (`:667`, `:690`) on top of consensus. Weight modes have no such requirement. Undocumented asymmetry | open — intent needed |
| D5 | SI-25 | Bodyweight exercises progress by reps | The rep fallback needs `overloadIncrementReps > 0`, and that column defaults to `0` (`schema/programs.ts:61`). Out of the box a bodyweight exercise returns `held` forever | open |
| D6 | SI-7 | Each exercise+set-number key gets its own 5-session window | The history query applies `LIMIT programData.length * CONSENSUS_WINDOW` **globally**, ordered by session (`workout-sets.ts:1236`). The budget is an average, not a per-key guarantee, so some keys can be starved on programmes with uneven set counts | open |
| D7 | SI-1 | Settings offers a global "Weight Increment" and "Rep Increment" | They persist only to `localStorage` (`defaultIncrementKg` / `defaultIncrementReps`) and **no progression code reads them** — the controls are inert. Noted in [`../gotchas.md`](../gotchas.md#settings-live-in-two-stores) | open — intent needed |
| D8 | SI-12, SI-34 | Generated programmes carry the same settings as hand-built ones | `ai-prompt.ts` never mentions `progressionRequiredHits` or `progressionApplyToPlan` (and offers only `manual`/`weight`/`smart`/`reps`), so generated plans silently take the defaults | open |

All eight are tracked in `BACKLOG.md` under **Smart-progression UX (deferred long-term)**, one entry per row (D1–D2 and D3–D4 are paired, since each pair shares a decision). D3, D4 and D7 need an intent decision before any code changes — the spec cannot state a rule for them until then.

Already tracked in `BACKLOG.md` rather than repeated here: base weight coming from history rather than the plan (§ Smart-progression UX — "`latest.weightKg` vs program-planned weight quirk"), and `isFailed` not being treated as a hard failure (§ New features — "Surface failed sets in history & metrics").

## Coverage

Rules with no automated test:

| Rule | Why it is untested |
|---|---|
| SI-2 | Endurance-goal increment — no case in the suite |
| SI-8 | The window filter lives in SQL; the unit suite starts from pre-fetched rows |
| SI-16 | Mode `none` returning null |
| SI-38, SI-39, SI-40 | Server-side ratchet guards — no action-level test exists |

Everything else maps to a case in `src/__tests__/progressive-suggestions.test.ts`, named in the *Covered by* line under each rule. `e2e/progression-settings.spec.ts` covers SI-12 and SI-34 end to end, and doubles as the check that migration `0045` has been applied — a unit test cannot catch a missing migration, and the production symptom is a 500 on tapping a gate pill.
