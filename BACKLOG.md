# BACKLOG

Anything left unfinished, partially implemented, or explicitly deferred goes here. Each entry: what, why deferred, what would unblock it, where the relevant code lives.

Don't put work-in-progress here. WIP belongs on a branch. This is for *known* gaps the team has agreed to leave for later.

When you finish an item, delete it. When you add an item, write enough that someone unfamiliar with the conversation can pick it up.

---

## New features — additive

### Sport-specific endurance fields (pool length, bike power/cadence, swim stroke)
- **What:** The set editor captures distance/duration/incline/HR-zone only. Triathletes often want pool length, swim stroke, or bike power/cadence. The schema has no columns for these.
- **Why deferred:** Not needed to log and track the three disciplines; add when a concrete need appears.
- **Unblocked by:** A request for one of these specific metrics.
- **Touchpoints:** `src/db/schema/workout-sets.ts`, `src/components/features/SetEditView.tsx`, `src/components/features/LogRunModal.tsx`.

### Surface make-up attribution in the history view
- **What:** The `workout_sessions.intended_date` column now exists and is set when a session is started via a "Make up" prompt (`?makeup=YYYY-MM-DD`); the missed-workout logic consumes it to clear the original missed day. What remains is cosmetic: the history view still labels a make-up with today's date — it won't say "this was Monday's push." Render `intendedDate` on the history row when present.
- **Why deferred:** The functional half (make-up clears the missed slot, correct cycle progression) shipped; the display label is cosmetic and wasn't requested.
- **Unblocked by:** A user reporting that make-up sessions look wrong in the history view.
- **Touchpoints:** `src/lib/actions/workout-sets.ts` (history query already selects `intendedDate`), `src/components/features/` history row component.

### Two workouts in one day — rotation walker edge case
- **What:** `walkRotation` in `src/lib/utils/cycle-position.ts` consumes at most one completed session per calendar day. If a user logs two workouts on the same date, the second one doesn't advance the rotation cursor.
- **Why deferred:** Vanishingly rare in practice; the previous modulo-counter version had the inverse limitation (double-counted, arguably more wrong).
- **Unblocked by:** Concrete report of a power user hitting it.
- **Touchpoints:** `src/lib/utils/cycle-position.ts` (`walkRotation`), tests in `src/__tests__/cycle-position.test.ts`.

### Wearable-based autoregulation (Tier B) for triathlon plans
- **What:** True closed-loop autoregulation from objective recovery signals — suppressed HRV, elevated resting HR, aerobic decoupling >5% — to auto-deload without the athlete typing anything. This is the only remaining piece of the original "autoregulation + intensity" gap; the rest now ships: polarized **zone prescription** (Z2 easy / Z4 hard), **phase-varying sessions** (`intervalPhaseRecipe`: base→tempo, build→threshold, peak→VO₂), and a **no-wearable nudge** (`computeAdaptationFactor`: adherence + readiness + RPE → ±band on the curve, surfaced in the cycle summary).
- **Why deferred:** Needs a wearable-data pipeline (HRV/RHR/pace-HR) the app doesn't have. The no-wearable Tier A loop is in place but is only as strong as the readiness/RPE the user enters; HRV-grade signals require ingesting device data.
- **Unblocked by:** Ingesting wearable/HR data (Apple Health / Garmin / Strava) into a per-session store, then feeding it into `computeAdaptationFactor` as additional signals (or a stronger override) and the `uncoupledAcwr` guardrail.
- **Touchpoints:** `src/lib/utils/periodization.ts` (`computeAdaptationFactor`, `uncoupledAcwr`), `src/lib/actions/training-cycles.ts` (`computeCycleAdaptation`/`syncPeriodizedTargets` — where richer signals plug in), `src/db/schema/workout-sets.ts`.

### iOS backgrounding — residual gaps after the resume-hardening pass
- **What:** A Jun 2026 pass made the rest/exercise timers and completed-set toggles re-sync on resume (visibilitychange + pageshow + focus; rest timers rebuild from `restTimerEnds`, completed sets re-pull from the server). Two gaps remain: (1) the **exercise (timed-set) countdown** isn't persisted, so a *cold* eviction mid-timed-set loses it entirely (only warm resume recovers it); (2) **unsaved SetEditView edits** (typed but not Saved) live only in React state and are lost on eviction — only Saved overrides persist to localStorage.
- **Why deferred:** (1) timed sets are short and rarely span a long background; persisting `endsAt` to the context/localStorage is extra surface for an edge case. (2) auto-persisting drafts on each keystroke is a bigger change; the explicit Save is the documented contract.
- **Unblocked by:** A real iOS device repro showing either gap bites in practice. Then: persist the exercise timer's `endsAt` alongside `restTimerEnds` and rehydrate on mount; and/or debounce-persist SetEditView field state to a draft key cleared on Save/navigation.
- **Touchpoints:** `src/components/features/WorkoutSetsList.tsx` (exercise timer state + resync effects), `src/contexts/workout-session-context.tsx` (persistence keys), `src/components/features/SetEditView.tsx` (draft state).

### Surface failed sets in history & metrics
- **What:** `workout_sets.is_failed` is now logged (explicit failed-set flag, Jun 2026) and shown in-workout (red ✕). History rows and the metrics/PR views don't yet read it — a failed set currently just shows its low `actualReps`. A dedicated "failed" badge in `/history` and exclusion/annotation in PR/volume math would make it explicit.
- **Why deferred:** The flag is captured and progression already reacts to `actualReps < targetReps`; surfacing it in history/metrics is additive polish.
- **Unblocked by:** Wanting failed sets visually distinct in history. Add `isFailed` to the history query + `HistoryRow`, render a badge, and decide whether failed sets count toward volume.
- **Touchpoints:** `src/lib/actions/workout-sets.ts` (history query ~line 711), `src/components/features/` history/metrics components, `src/lib/utils/progression.ts` (optional: treat `isFailed` as a hard fail).

### Prescribe target RIR in programs + AI generation
- **What:** Per-set RIR is now *logged* and feeds progression/adaptation (Jun 2026), but programs can't *prescribe* a target RIR. A full version adds a `targetRir` column to `program_sets`, sets it per phase (e.g. `strengthPhaseRecipe` returns a target RIR that ramps base→peak), shows "target RIR N" on each set like the existing target-HR-zone display, and feeds RIR into the LLM program-generation prompt (`ai-prompt.ts`) so generated programs can specify intended effort.
- **Why deferred:** The user scoped this pass to "adaptation + progression" — capturing RIR and routing it into the algorithmic engine — explicitly excluding prescription and the LLM path. The logged-RIR half delivers the adaptive value on its own.
- **Unblocked by:** Wanting programs/AI to *target* an effort level, not just record it. Add `program_sets.targetRir` (+ migration), thread it through `addProgramSetSchema`/`updateProgramSetSchema` and `SetEditView` (program-edit mode), set it in `strengthPhaseRecipe`/`syncPeriodizedTargets`, render it on the set row, and add it to the AI prompt/output schema.
- **Touchpoints:** `src/db/schema/programs.ts` (`program_sets`), `src/lib/validators/workout.ts`, `src/components/features/SetEditView.tsx`, `src/lib/utils/periodization.ts` (`strengthPhaseRecipe`), `src/lib/actions/training-cycles.ts` (`syncPeriodizedTargets`), `src/lib/utils/ai-prompt.ts`, `src/lib/actions/ai-generate.ts`.

### Exercise-type: laterality dimension + backfill precision
- **What:** Exercise type shipped as a single flat enum (compound/accessory/isolation/plyometric/isometric) with a per-program override (Jun 2026). Two follow-ups: (1) the **unilateral/bilateral** laterality axis was intentionally left out — it's orthogonal (a Bulgarian split squat is compound *and* unilateral) and folding it into the one enum would be wrong; (2) the **library backfill is coarse** — `0039` derives type from `movement_pattern`, so cable/dumbbell isolation work tagged `push`/`pull` (curls, raises, flyes, pushdowns) is currently mislabeled `compound` (≈142 of ~196 rows landed on compound). The editor lets users correct individual exercises, but the bulk default is rough.
- **Why deferred:** (1) laterality is a separate feature with its own column + picker; no one asked for it yet. (2) precise per-exercise classification of the 191 seed entries is a manual judgment pass the user opted out of in favour of the heuristic.
- **Unblocked by:** (1) wanting unilateral/bilateral tracking — add a nullable `laterality` enum column to `exercises` (+ optional `program_exercises` override) mirroring the exercise-type plumbing. (2) wanting accurate types — do a one-time pass classifying the seed `EXERCISES` array explicitly (a name/equipment-aware heuristic: single-muscle + cable/machine ⇒ isolation), then a corrective migration `UPDATE` for existing rows.
- **Touchpoints:** `src/db/schema/exercises.ts`, `src/db/schema/programs.ts`, `src/lib/utils/exercise-type.ts` (`exerciseTypeFromPattern`), `scripts/seed.ts` (`EXERCISES`), `drizzle/0039_nice_supreme_intelligence.sql` (the backfill CASE), `src/components/features/ExercisesClient.tsx`.

## Smart-progression UX (deferred long-term)

### Skip suggestion compute for completed sets
- **What:** In `getProgressiveSuggestions`, skip program sets whose corresponding `workoutSet.isCompleted = true` in the active session.
- **Why deferred:** Marginal CPU win. UI already hides suggestions for completed sets via `!isCompleted` gate at `WorkoutSetsList.tsx:1042`. Adds a DB query for negligible benefit.
- **Unblocked by:** Profiling that shows suggestion compute is a real bottleneck (unlikely with current dataset sizes).
- **Touchpoints:** `src/lib/actions/workout-sets.ts:806-826`.

### Per-exercise (not per-set) progression UI
- **What:** Collapse the per-set `↑ Xkg` badges into one affordance per exercise: "↑ all working sets to 82.5 kg". Today, applying a suggestion propagates across siblings, but the badges still render per-set.
- **Why deferred:** Bigger UX redesign than the recent rounds covered. Hold until you've used the current per-set badges for a while and confirmed the clutter is real.
- **Unblocked by:** Concrete user feedback that the per-set badges are still too noisy now that warm-ups are filtered and the apply propagates.
- **Touchpoints:** `src/components/features/WorkoutSetsList.tsx:1040-1207`.

### `latest.weightKg` vs program-planned weight quirk
- **What:** `buildSuggestion` uses `latest.weightKg` from history as `baseWeight` (`src/lib/utils/progression.ts:219`), not the program's planned weight. If a user logs a one-off heavy single, the next suggestion is built off that single — which then usually shows "held" because the consensus gate kicks in. Surprising in edge cases.
- **Why deferred:** Rare in practice; the consensus gate masks most surprise. Tier 1 changes don't make it worse.
- **Unblocked by:** A user reporting concrete confusion.
- **Touchpoints:** `src/lib/utils/progression.ts:218-219`.

### Progression spec divergences D1–D2: 1RM and rep-estimate leak past their own guards
- **What:** Two display-side inconsistencies found writing [`docs/specs/smart-incrementation.md`](docs/specs/smart-incrementation.md). **D1 (rule SI-27):** `estimated1RM` is attached to every suggestion with no RPE gate (`progression.ts:419`), while `adjustedRepsForWeight` requires RPE ≥ 7 for the same Epley formula (`:615-621`) — so a shown 1RM can come from a sub-max set the code itself treats as off-curve. **D2 (rule SI-21):** the readiness downgrade clears `suggestedReps`/`suggestedDurationSeconds`/`suggestedDistanceMeters` but not `adjustedRepsForWeight` (`:708-717`), so a `held-readiness` smart suggestion can still carry a rep cut.
- **Why deferred:** Both are display-only today. D2 cannot reach the plan because `pendingProgressions` ignores `held-readiness` (rule SI-37), and D1 only affects a number shown for information. The spec pass was scoped to documenting behaviour, not changing it.
- **Unblocked by:** Deciding whether the shown 1RM should carry the same RPE ≥ 7 guard as the rep estimate — if yes, both are a few lines. Confirm no UI reads `adjustedRepsForWeight` on a held suggestion before treating D2 as cosmetic.
- **Touchpoints:** `src/lib/utils/progression.ts:419`, `:615-621`, `:708-717`; `src/components/features/WorkoutSetsList.tsx:1410-1420`.

### Progression spec divergences D3–D4: undecided asymmetries in timed/distance progression
- **What:** Two places where `docs/specs/smart-incrementation.md` could not state intent because the code does not reveal it. **D3 (rule SI-17):** `canDeload` covers `weight|smart|reps` only (`progression.ts:473`), so timed and distance work can never deload — and the adjacent comment says "not manual, not time", omitting `distance`, so it is unclear whether the exclusion was decided or inherited. **D4 (rules SI-29, SI-30):** `time` and `distance` additionally require the *most recent* row to meet target (`:667`, `:690`) on top of the consensus gate; weight modes have no such requirement.
- **Why deferred:** Needs a product decision, not a fix. Both may well be correct — a missed run is a different signal from a missed squat — but the spec should say so deliberately rather than describing an accident.
- **Unblocked by:** Deciding (a) whether a held plank or a short run should ever trigger a back-off, and (b) whether the latest session must hit target in timed/distance modes. Then either write the answer into the spec as a rule and fix the comment, or change the code to match.
- **Touchpoints:** `src/lib/utils/progression.ts:473-478`, `:657-701`; `docs/specs/smart-incrementation.md` (D3, D4).

### Progression spec divergence D5: bodyweight exercises never progress out of the box
- **What:** In `weight` and `smart` modes at zero weight, the rep fallback (rule SI-25) only fires when `overloadIncrementReps > 0` — and that column defaults to `0` (`src/db/schema/programs.ts:61`). So a bodyweight exercise returns `held` forever until someone sets a rep increment by hand, which nothing prompts them to do.
- **Why deferred:** Found during the spec pass; changing the default is a behaviour change with a migration attached, which was out of scope for a documentation task.
- **Unblocked by:** Deciding the right default — either default `overload_increment_reps` to 1 for new rows, or have the bodyweight fallback treat a missing increment as 1 in the engine (no migration). The second is smaller and reversible.
- **Touchpoints:** `src/lib/utils/progression.ts:566-582` (weight), `:593-608` (smart); `src/db/schema/programs.ts:61`; `drizzle/` (only if the column default changes).

### Progression spec divergence D6: the history window budget is an average, not a per-set guarantee
- **What:** `getProgressiveSuggestions` fetches history with `LIMIT programData.length * CONSENSUS_WINDOW` applied globally, ordered by session (`src/lib/actions/workout-sets.ts:1236`), then buckets rows per `exerciseId+setNumber` client-side. The budget is sized for the average case; on a programme with uneven set counts per exercise, later keys can receive fewer than `CONSENSUS_WINDOW` rows and progress more slowly than rule SI-7 says they should.
- **Why deferred:** No observed misbehaviour, and the limit exists to stop full scans on accounts with hundreds of sessions — removing it naively trades a correctness edge case for a performance one.
- **Unblocked by:** A reproduction on a real programme shape, or a rewrite to a per-key windowed query (`ROW_NUMBER() OVER (PARTITION BY exercise_id, set_number ORDER BY start_time DESC) <= 5`), which is exact and still indexed.
- **Touchpoints:** `src/lib/actions/workout-sets.ts:1210-1245`.

### Progression spec divergence D7: the global increment settings are inert
- **What:** Settings renders "Weight Increment" and "Rep Increment" with presets and a custom input (`src/components/features/SettingsClient.tsx:328-350`), but they persist only to `localStorage` (`defaultIncrementKg` / `defaultIncrementReps` in `theme-provider.tsx`) and no progression code reads them. `adaptiveIncrementKg` never sees them, so the controls do nothing. Already noted as a trap in `docs/gotchas.md`; recorded here because rule SI-1 makes the gap concrete — the per-exercise increment is the only one that matters.
- **Why deferred:** Needs a product decision on what the global control should mean: the seed for new program exercises, a fallback ahead of the adaptive ladder, or nothing (in which case the control should go).
- **Unblocked by:** Picking one of those three. "Seed for new exercises" is the least surprising and needs no change to the engine; "fallback in the ladder" means a server-side user column, since `localStorage` is never visible to a Server Action.
- **Touchpoints:** `src/components/features/SettingsClient.tsx:328-350`, `src/components/ui/theme-provider.tsx`, `src/lib/utils/progression.ts:139-173`, `docs/gotchas.md`.

### Progression spec divergence D8: generated programmes ignore the newer progression settings
- **What:** The LLM plan prompt (`src/lib/utils/ai-prompt.ts:167`) describes only `manual|weight|smart|reps` and never mentions `progressionRequiredHits` or `progressionApplyToPlan`, so imported plans silently take the defaults (gate 2, ratchet off) and can never request `time` or `distance` modes. Admitted in the body of `3a09857`; recorded against rules SI-12 and SI-34.
- **Why deferred:** The defaults are sane, so generated plans are correct — just less expressive than a hand-built one.
- **Unblocked by:** Extending the prompt's schema description plus the import validator's coverage. The validator already accepts both fields (`.optional().catch(...)` in `importProgramSchema`), so this is prompt work rather than plumbing.
- **Touchpoints:** `src/lib/utils/ai-prompt.ts:160-180`, `src/lib/validators/workout.ts` (`importProgramSchema`), `src/lib/actions/programs.ts` (`importProgram`).

## Cycle periodization (spec divergences)

Findings from the [`cycle-periodization`](docs/specs/cycle-periodization.md) spec pass (2026-08-25 @ `91c1646`). Rule IDs are `PZ-n`; divergence IDs `D1`-`D8` are the rows of that spec's Divergences table.

### Cycle periodization divergences D1-D2: cycle week arithmetic mixes UTC and local midnight
- **What:** `training_cycles.start_date` is a `date` column read as a `YYYY-MM-DD` string, so `new Date(startDate)` yields **UTC midnight**, while `today` is set to **local midnight**. Every week derivation subtracts one from the other. In a timezone ahead of UTC the difference is negative on the block's own start date, so `getActiveCycleForUser` (`src/lib/actions/training-cycles.ts:165-168`) computes `currentWeek = 0` and every later week boundary lands a day late; it does not clamp, so `/` renders "Week 0/24" and its progress bar computes to −4.2% (`src/app/page.tsx:105` clamps only the upper bound). At the other end, auto-completion fires only on `today > endDate` (`:157`), so under `TZ=UTC` a 24-week block admits a 169th day reporting "Week 25/24" and stamping `last_synced_week = 25`. Meanwhile `getCyclePeriodization` (`:411`) clamps and `CyclesListClient` (`src/components/features/CyclesListClient.tsx:21-28`) measures from the current instant, so three screens can show two different week numbers on the same day. Contradicts `PZ-2` and `PZ-39`. Verified by running the arithmetic under `TZ=UTC`, `TZ=Europe/Oslo` and `TZ=America/New_York`.
- **Why deferred:** Found during a spec pass, and spec passes record findings rather than fix them — the sync writes plan rows, so a date-arithmetic change wants its own reviewed diff and unit tests. The visible symptom is one wrong day per cycle at each end.
- **Unblocked by:** Deciding the canonical frame (parse `start_date` as a local date, i.e. `new Date(y, m-1, d)`, rather than shifting `today` to UTC), then applying it in one place all four call sites share, clamping `currentWeek` into `[1, durationWeeks]` at the source, and fixing the end comparison to `today >= endDate`. Add unit tests that pin the start day, the final day and the day after under at least one timezone ahead of and one behind UTC.
- **Touchpoints:** `src/lib/actions/training-cycles.ts` (`getActiveCycleForUser` 142-168, `getCyclePeriodization` 406-414), `src/app/page.tsx` (104-127), `src/components/features/NewWorkoutClient.tsx` (39), `src/components/features/CyclesListClient.tsx` (21-28), `src/lib/utils/cycle-position.ts` (`startOfDay`, `daysBetween` — the existing date helpers a fix should reuse).

### Cycle periodization divergence D3: strength phase periodization has no producer
- **What:** `syncPeriodizedTargets` rewrites `target_reps` and `rest_time_seconds` from `strengthPhaseRecipe` for sets tagged `session_role = "strength"` (`src/lib/actions/training-cycles.ts:602-606`), but nothing in the repository ever writes that tag. The triathlon generator tags only interval `"work"` sets (`src/lib/utils/triathlon-plan.ts:239`), `sessionRole` appears in no validator, and the schema comment (`src/db/schema/programs.ts:119-121`) documents only `"work"`. The branch is unreachable, so strength runs flat for the whole block — which is what the generator deliberately builds (`triathlon-plan.ts:158-165`) and what its tests assert ("runs strength flat — no phase-periodization sessionRole on strength sets"). Two docblocks (`src/lib/utils/periodization.ts:218-230` and `src/lib/utils/triathlon-plan.ts:12-23`) still describe a three-strength-day week whose compound mains carry the tag, which is the design that was replaced. Contradicts `PZ-33`.
- **Why deferred:** It is not clear which side is stale. Flat strength was a deliberate choice (spare the CNS so endurance quality sessions aren't compromised); the sync branch and `strengthPhaseRecipe` may be a planned capability rather than a bug. Deleting live code on a spec pass is out of scope either way.
- **Unblocked by:** Deciding whether triathlon strength should periodize. If yes, tag the compound mains in the generator and thread `sessionRole` through the program-set validators so hand-built programs can opt in; note it would then collide with the plan ratchet (`SI-37`), which also writes `target_reps`. If no, delete the `"strength"` branch and `strengthPhaseRecipe` with its tests, and correct both docblocks. Either way the two stale docblocks should be fixed.
- **Touchpoints:** `src/lib/actions/training-cycles.ts` (602-606), `src/lib/utils/periodization.ts` (`strengthPhaseRecipe`, 218-248), `src/lib/utils/triathlon-plan.ts` (12-23, 158-165, 239), `src/db/schema/programs.ts` (119-122), `src/lib/validators/workout.ts`, `src/__tests__/periodization.test.ts` (140-164).

### Cycle periodization divergence D4: the periodization sync races the reads that display it
- **What:** The sync runs lazily inside `getActiveCycleForUser` (`src/lib/actions/training-cycles.ts:175-177`). On the first visit of a new cycle-week the workout page starts `getProgramWithExercises` — which reads `program_sets` — in the same `Promise.all` as `getWorkoutInsight`, whose nested `getActiveCycleForUser` performs the sync (`src/app/programs/[id]/workout/page.tsx:28-33`). The set read almost always resolves first, so that render shows the previous week's targets under the new week's header. Separately, `/cycles/[id]` calls `getCyclePeriodization` only, which never syncs, so it can report a new week's phase against the previous week's `adaptation_pct`. Both self-correct on the next load. Contradicts `PZ-29` and `PZ-40`.
- **Why deferred:** Self-correcting and one render wide; the fix is a restructure of a hot render path (awaiting the sync before the reads, or lifting it out of the read path entirely), which is more blast radius than a spec pass should take on.
- **Unblocked by:** Deciding where the sync belongs. Cheapest correct fix: `await` the cycle read before the rest of the workout page's `Promise.all`, and have `getCyclePeriodization` ensure-sync for an active cycle. Better long-term: move the sync out of the read path (a mutation on session start, or a scheduled job) so no render depends on write ordering.
- **Touchpoints:** `src/lib/actions/training-cycles.ts` (`getActiveCycleForUser` 175-177, `syncPeriodizedTargets` 536-621, `getCyclePeriodization` 375-442), `src/app/programs/[id]/workout/page.tsx` (28-33), `src/app/cycles/[id]/page.tsx` (31), `src/lib/actions/workout-sets.ts` (`getWorkoutInsight` 1330-1350).

### Cycle periodization divergence D5: the periodization summary gate ignores duration anchors
- **What:** `getCyclePeriodization` decides whether a cycle is periodized at all by probing for one set with a non-null `peak_distance_meters` (`src/lib/actions/training-cycles.ts:391-402`), while the sync selects on **either** anchor (`:575-580`). A cycle whose endurance sets have all been switched to Time mode carries only `peak_duration_seconds`, so it keeps being synced every week but reports `null` — the cycle detail page and the in-workout header silently drop their periodization summary. Contradicts `PZ-38`.
- **Why deferred:** Needs every set in a cycle switched to time mode to bite, which no current generator produces; found by reading, not by a report.
- **Unblocked by:** Nothing — it is a one-line change. Widen the probe to `or(isNotNull(peakDistanceMeters), isNotNull(peakDurationSeconds))` so the gate matches the sync's own selection, and add a test covering a duration-anchored cycle.
- **Touchpoints:** `src/lib/actions/training-cycles.ts` (391-402, and the matching predicate at 575-580).

### Cycle periodization divergence D6: cycle edits do not invalidate the periodization sync
- **What:** `updateTrainingCycle` can change `duration_weeks` on an active cycle (`src/lib/actions/training-cycles.ts:689-693`). That changes `phaseLayout`, and therefore every week's phase and multiplier, but `last_synced_week` is left untouched — so the sync's idempotency key still matches the current week and no re-derivation happens until the next week boundary. The plan holds targets computed from a block shape that no longer exists. Contradicts `PZ-28`.
- **Why deferred:** Bounded (at most one week of stale targets) and only reachable by editing an active periodized cycle's duration, which the validators currently forbid for the 24/36/52-week blocks the generator produces (see D7).
- **Unblocked by:** Nothing blocking. Clear `last_synced_week` in `updateTrainingCycle` whenever a field the curve depends on changes (`duration_weeks`, and `goal`/`athlete_level` if they ever become editable). Consider doing the same in `upsertCycleSlot` so a slot added mid-week gets its sets synced immediately.
- **Touchpoints:** `src/lib/actions/training-cycles.ts` (`updateTrainingCycle` 654-701, `upsertCycleSlot` 821-896), `src/db/schema/training-cycles.ts` (`lastSyncedWeek` 55).

### Cycle periodization divergence D7: cycle duration validators reject generated long blocks
- **What:** `createTrainingCycleSchema` and `updateTrainingCycleSchema` accept `duration_weeks` only from `[4, 6, 8, 10, 12, 16]` (`src/lib/validators/training-cycles.ts:9-11, 20-26`), but the triathlon generator snaps to `ALLOWED_WEEKS = [4, 6, 8, 10, 12, 16, 24, 36, 52]` (`src/lib/utils/triathlon-plan.ts:100`) and inserts the cycle directly. A generated 24-week Ironman block therefore exists but can never have its duration edited — `updateTrainingCycle` returns "Invalid input" for every value it currently holds. Contradicts `PZ-2`, which states the curve supports whatever block length the generator can produce.
- **Why deferred:** Cosmetic until someone tries to edit a long block; the two lists drifted apart rather than either being wrong on its own.
- **Unblocked by:** Deciding which list is canonical. Export `ALLOWED_WEEKS` from `triathlon-plan.ts` (or move it somewhere neutral) and have both validators refine against it, so the two cannot drift again.
- **Touchpoints:** `src/lib/validators/training-cycles.ts` (9-11, 20-26), `src/lib/utils/triathlon-plan.ts` (`ALLOWED_WEEKS` 100, `snapWeeks` 135-139), `src/__tests__/training-cycle-validators.test.ts`.

### Cycle periodization divergence D8: manual edits to periodized sets revert silently — intent needed
- **What:** Editing an anchored endurance set's distance while it stays in distance mode writes the new `distance_meters` but leaves `peak_distance_meters` alone (`src/components/features/SetEditView.tsx:248-253`), so the next weekly sync overwrites the typed value from the anchor — up to a week later, with no warning. A **mode switch** on the same set does re-anchor (`:250-257`), so the two paths disagree about what an edit means. `PZ-36` states the curve owns the weekly target, which is a defensible reading; whether a direct edit should re-anchor, warn, or revert silently has never been decided, so the spec records the behaviour without endorsing it.
- **Why deferred:** Needs a product decision, not a code change. Any of the three options is implementable in the same place.
- **Unblocked by:** Deciding what a direct edit to a periodized set means. Re-anchoring is the least surprising (the athlete's number becomes the new peak, scaled back to this week); a note in the set editor saying the value is derived from a peak would be the minimum honest alternative.
- **Touchpoints:** `src/components/features/SetEditView.tsx` (240-258), `src/lib/actions/training-cycles.ts` (`syncPeriodizedTargets` 584-610), `docs/specs/cycle-periodization.md` (`PZ-36`, `PZ-37`).

## Codebase hygiene (deferred long-term)

### Remaining findings from the UI layout-shift audit
- **What:** `docs/ui-polish-audit.md` records 22 findings from a measured pass over the app (layout shift, skeleton fidelity, phone ergonomics). The in-workout cluster is fixed and marked `[x]`; the rest is still open — mainly the non-workout skeleton mismatches (`/exercises` loads an "Add Exercise" skeleton, the dashboard skeleton is a bare header, metrics puts the tab bar in the wrong scroll layer), the three coexisting volume formats, and the activity heatmap opening on the oldest weeks.
- **Why deferred:** The brief was the in-workout feel. Each remaining item is independent and carries its own measurement and proposed fix, so they can be picked up singly.
- **Unblocked by:** Nothing — pick an item off the doc. It lists a suggested order at the end.
- **Touchpoints:** see the file:line references per finding in `docs/ui-polish-audit.md`.

### Auto-carried weight still lands as a delayed text change (audit W6)
- **What:** `WorkoutSetsList.toggleSet` awaits `updateProgramSet` then calls `router.refresh()` when the next set has no weight configured, so that row's text flips from "8 reps" to "8 x 80kg" a few hundred ms after the tap.
- **Why deferred:** The *shift* half of this is gone — the suggestion-block fix made row heights stable, so this is now a delayed text change rather than the list jumping. Fixing the lag properly means writing the value through `workoutSession.setOverride` in the same frame, and the current code deliberately writes to the **program** (so the carried weight persists to the next workout). Changing that is a semantics decision, not a UI one, and it wasn't asked for.
- **Unblocked by:** Deciding whether the carry should persist to the program or only to the session. If program: keep the write, add an optimistic override alongside it and drop the `router.refresh()`. If session-only: replace the write with `setOverride`.
- **Touchpoints:** `src/components/features/WorkoutSetsList.tsx` (`toggleSet`, the auto-carry block), `src/components/features/WorkoutSetsClient.tsx` (`applySuggestion` — the optimistic pattern to copy).

### `create-admin` / `create-e2e-user` scripts cannot create an account
- **What:** Both scripts call `auth.api.signUpEmail`, which `src/lib/auth.ts` disables via `emailAndPassword.disableSignUp: true` (accounts are meant to come from `registerWithToken`). Both fail with *"Email and password sign up is not enabled"*, so a fresh database cannot be bootstrapped with a login by the documented route — which blocks the `verify:full` / smoke-pass prerequisites on any new environment. Worked around locally by creating the user through `auth.$context.internalAdapter` (create user + credential account with `ctx.password.hash`).
- **Why deferred:** Found while setting up an environment for the UI audit; unrelated to that work and it needs a decision on which path these scripts should use.
- **Unblocked by:** Deciding the intended bootstrap path — either switch both scripts to the admin plugin's `createUser` / the internal adapter, or have them mint an invite token and go through `registerWithToken` like a real signup.
- **Touchpoints:** `scripts/create-admin.ts:20`, `scripts/create-e2e-user.ts:30`, `src/lib/auth.ts` (`disableSignUp`), `src/lib/actions/invite-tokens.ts` (`registerWithToken`).

### SetEditView seeds its fields from overrides via `useState` initialisers
- **What:** `SetEditView` reads `workoutSession.overrides[set.id]` in `useState(...)` initialisers (reps, weight, duration, notes, failed, rir). Those run once. Overrides are restored from localStorage in a mount effect on a provider above, so on a **cold load of the set-edit URL** the initialisers may run before the overrides exist, leaving the editor showing program values while the set list shows adjusted ones. Not observed in the audit — the case wasn't exercised — but the ordering that caused the hydration mismatch fixed in this pass (see `useRenderedOverrides`) is the same ordering that would cause it.
- **Why deferred:** Unverified, and it is a correctness question about override initialisation rather than the layout-shift brief.
- **Unblocked by:** Reproduce first: apply a suggestion to a set, then hard-reload that set's `/sets/[setId]` URL and check whether the editor shows the adjusted or the program value. If adjusted, there is nothing to fix.
- **Touchpoints:** `src/components/features/SetEditView.tsx` (the `useState` block, ~lines 125–160), `src/contexts/workout-session-context.tsx` (`useRenderedOverrides` and the restore effect).

### Exercise-level checkmark: log side still bypasses the queue and overrides
- **What:** `toggleExercise` in `WorkoutExerciseList.tsx` now removes the `workout_sets` rows when the exercise is un-checked (added alongside the un-log fix). The **log** side was left as it was: it calls `logWorkoutSet` directly rather than the queue-backed `useWorkoutSetWriter().logWithRetry`, ignores every result, and logs the program's planned values without applying the session overrides that the set list displays. So a checkmark tap can silently fail (or write pre-override values) while the UI shows the exercise complete, and offline it produces an unhandled rejection with nothing queued.
- **Why deferred:** The un-log half was needed to close the UI/DB divergence that the un-log fix targeted. The log half is a distinct defect (it is P1-5 in the pre-release audit) with its own payload-construction work, and was out of the scope of the P0 pass.
- **Unblocked by:** Doing the P1 batch. Switch the `logWorkoutSet` calls to `useWorkoutSetWriter().logWithRetry`, read `workoutSession.overrides[set.id]` when building each payload the way `WorkoutSetsList.toggleSet` does, and check the results.
- **Touchpoints:** `src/components/features/WorkoutExerciseList.tsx` (`toggleExercise`), `src/contexts/pending-queue-context.tsx` (`useWorkoutSetWriter`), `src/components/features/WorkoutSetsList.tsx` (the payload shape to mirror).

### No automated test for the offline replay queue
- **What:** `pending-queue-context.tsx` now carries real logic — per-item backoff (`BACKOFF_MS`), a due-time filter, drop-after-`MAX_ATTEMPTS`, and the mount/hydration ordering that decides whether a queued workout replays on cold open. All of it was verified by hand (fake `navigator.onLine` + a rejecting `window.fetch`, then a cold reload) and none of it is covered by a test. It is the mechanism that prevents mid-workout data loss, so a silent regression here is expensive.
- **Why deferred:** The Vitest suite is pure-function only — no jsdom, no React Testing Library — so testing a provider means adding a browser-ish test environment and the deps that go with it, which is a bigger change than the fix it would guard.
- **Unblocked by:** Adding `jsdom` + `@testing-library/react` to the Vitest config. Then: assert that five rapid failures span the full backoff rather than draining instantly, that an item past `MAX_ATTEMPTS` is dropped exactly once, and that a queue hydrated from localStorage replays on mount without an `online` event. Alternatively extract the scheduling decision into a pure helper (`nextDue(queue, now)`) and unit-test that alone — cheaper, covers most of the risk.
- **Touchpoints:** `src/contexts/pending-queue-context.tsx`, `vitest.config.ts`.

### PR rollback on un-log restores by most-recent supersession
- **What:** `rollbackPRsForSet` in `workout-sets.ts` deletes the PR rows a un-logged set earned and un-supersedes the record each one displaced, picking that record as the most recently superseded row of the same `prType` for that exercise (plus the ±0.5 kg bracket for `reps_at_weight`). That is exact for the normal case, because a PR only ever supersedes the current record. It could restore the wrong row if two PRs of the same type for one exercise were superseded at the identical timestamp — reachable only via the concurrent-write race already noted as a separate audit item (PR detection is select-then-insert with no transaction).
- **Why deferred:** Closing it properly means making PR detection transactional and/or storing an explicit `supersededByPrId` link, which is a schema change beyond the un-log fix.
- **Unblocked by:** Doing the PR-transaction item. Add `superseded_by_pr_id` to `exercise_prs` (+ migration), set it when superseding, and roll back by following that link instead of ordering on `superseded_at`.
- **Touchpoints:** `src/lib/actions/workout-sets.ts` (`rollbackPRsForSet`, `detectAndRecordPRs`, `detectAndRecordEndurancePRs`), `src/db/schema/exercise-prs.ts`.

### `PageTransition` depends on a Next internal (`LayoutRouterContext`)
- **What:** The paired page-push/pop animation needs the outgoing page to keep rendering its *own* content while it slides away. `children` here is the router's children slot — one element whose identity is stable across navigations — so the element AnimatePresence keeps mounted for the exit otherwise re-renders with the destination's content, and the parallax animates two copies of the same screen. `FrozenRouter` pins the router context for a page that is leaving, using `LayoutRouterContext` imported from `next/dist/shared/lib/app-router-context.shared-runtime`.
- **Why deferred:** There is no public equivalent; this is the standard workaround for App Router exit animations. It compiles and runs correctly on Next 16.1.6 (verified on a production build).
- **Unblocked by:** Next removing or relocating the export — check this import on any Next major upgrade. If it disappears, the fallback is to drop the exit animation rather than ship the double-render; the rest of the transition (skeletons, curve, crossfade) does not depend on it.
- **Touchpoints:** `src/components/features/PageTransition.tsx` (`FrozenRouter`).

### Prefetch does not remove the in-workout loading boundary
- **What:** The workout screen now idle-prefetches its per-exercise routes (`IdlePrefetch`), and `cacheComponents` is on so every route is partially prerendered. Measured on a production build, that still does **not** make the real exercise content slide in: prefetch under PPR warms the *static shell* only, and every byte on these screens is user data, so the skeleton still covers the full 240ms slide and the content swaps in ~50ms after it settles. The crossfade softens that swap; it does not remove it.
- **Why deferred:** Removing it means giving these routes something real to prerender, which is a data-model change, not a config one — e.g. caching the program blueprint per user with `use cache` + a per-user `cacheTag`, invalidated on program edit. That is the same class of change as caching mutable set state, which is explicitly blocked below.
- **Unblocked by:** The write-path fixes have now landed (`logWorkoutSet` upserts, `unlogWorkoutSet` exists, the replay queue backs off) and the dead `/workout` revalidation targets are gone, so the original blockers are cleared. What remains is auditing the rest of the invalidation map — `revalidatePath("/")` still fires from 7 call sites and blows away the most expensive page in the app each time — and the 41 manual `router.refresh()` calls those dead targets left behind. Do that before putting a per-user server cache over program/session data.
- **Touchpoints:** `src/components/features/IdlePrefetch.tsx`, `src/lib/data/exercises.ts` (the `use cache` pattern to copy), `src/app/programs/[id]/workout/exercises/[programExerciseId]/page.tsx`.

### Caching mutable in-workout state is still off the table
- **What:** Logged sets, the active session, and completed-set flags remain uncached and should stay that way for now. `getAllExercises` is the only cached read (`src/lib/data/exercises.ts`, system rows only).
- **Why deferred:** The original reason (the UI and database disagreed about logged sets) is now fixed: `logWorkoutSet` upserts, `unlogWorkoutSet` deletes the row, and the replay queue backs off instead of dropping. The remaining reason is the invalidation map — `logWorkoutSet` revalidates `/workout` and `` `/workout/${id}` ``, neither of which exists, so nothing that renders the workout page is invalidated and roughly 30 manual `router.refresh()` calls are the only thing keeping set state correct. Caching on top of that converts a visible bug into an intermittent one.
- **Unblocked by:** Fixing the dead `revalidatePath` targets in `workout-sets.ts` and `workout-sessions.ts`, then doing one deliberate pass over the remaining ~70 call sites.
- **Touchpoints:** `src/lib/actions/workout-sets.ts`, `src/lib/actions/workout-sessions.ts`, `src/contexts/pending-queue-context.tsx`, `src/components/features/WorkoutSetsList.tsx`.

### Out-of-app push notifications via Service Worker
- **What:** Today the app uses the browser Notification API (in-app only). Real out-of-app push needs a Service Worker registration + `pushManager.subscribe()` + server-side delivery.
- **Why deferred:** Not blocking any current flow.
- **Unblocked by:** Product decision that out-of-app push is needed.
- **Touchpoints:** `src/lib/notifications.ts`.

### Custom-weight picker shipped without a browser smoke pass
- **What:** The custom-weight circle (`withCustomOption` in the weight sheets) and the `custom_weight_usage` telemetry shipped on `pnpm verify` alone — tsc, eslint and unit tests, no rendered UI. Unverified in a real browser: the circle's behaviour *while typing* (the options list reflows as each digit lands, since the list is derived from the `weight` state), the blur-time re-centre landing on the new circle, and the Insights "Custom Weights" section rendering against real rows.
- **Why deferred:** Explicitly skipped by the user after the local environment couldn't produce a running app — see the entry below. The logic is unit-tested (`src/__tests__/picker-options.test.ts`); what's untested is how it feels under a thumb.
- **Unblocked by:** Any environment where the app runs. Then walk steps 1–6 of the smoke protocol in CLAUDE.md, typing a non-preset weight (e.g. 18) and confirming an 18 circle lights instead of 17.5, plus a row landing in `custom_weight_usage`.
- **Touchpoints:** `src/lib/utils/picker-options.ts`, `src/components/features/SetEditView.tsx` (weight sheet ~line 921), `src/components/features/NewSetView.tsx` (weight sheet ~line 619), `src/components/features/AdminInsightsClient.tsx`.

### `make dev` cannot work against a remote Docker daemon
- **What:** `docker-compose.dev.yml` bind-mounts `.:/app` for hot-reload. That path is resolved on the *daemon's* filesystem, so when `DOCKER_HOST` points at a remote/DinD daemon (e.g. `tcp://localhost:2375`) the mount lands empty and `logeverylift-app` crash-loops on `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`. `make dev PROD=1` is unaffected — the runner stage ships the source in the image via the build context — but it's a production build, so it's a poor everyday dev loop. The Makefile also calls the `docker-compose` v1 binary, absent where only the `docker compose` v2 plugin is installed.
- **Why deferred:** Hit while setting up a smoke pass; unrelated to the change in flight, and the fix is an environment decision rather than a code one.
- **Unblocked by:** Deciding how remote-daemon setups should develop — document `make dev PROD=1` as the fallback, or sync the tree to the daemon host (`docker context`, mutagen, or a named volume seeded from the build context). Separately: switch the Makefile's `COMPOSE` to `docker compose` with a v1 fallback.
- **Touchpoints:** `docker-compose.dev.yml` (the `.:/app` mount), `Makefile` (`COMPOSE`, `dev` target), `CLAUDE.md` (Development + smoke-pass prereqs).

### The rest of the app has no behaviour spec yet
- **What:** `docs/specs/` holds the spec standard and two specs — [`smart-incrementation.md`](docs/specs/smart-incrementation.md) (40 rules `SI-1`…`SI-40`) and [`cycle-periodization.md`](docs/specs/cycle-periodization.md) (44 rules `PZ-1`…`PZ-44`). Every other feature is still described only by reference maps (`docs/workout-and-sets.md`, `docs/cycles-and-plans.md`, `docs/data-model.md`), which say where code lives but never what it is supposed to do. The candidates, roughly in order of how much a disagreement about intent would cost: the workout logging + rest/exercise timer flow, cycle **scheduling** and missed-workout catch-up (`src/lib/utils/cycle-position.ts` — explicitly out of scope for `PZ`), PR detection and rollback, the offline replay queue, and auth/session handling.
- **Why deferred:** Writing a spec means walking every rule against the source and re-verifying each `file.ts:line` — each pass so far has taken a full session and turned up 8 divergences. Doing several at once would either rush that verification or bury the findings.
- **Unblocked by:** Picking the next feature. Use the `feature-spec` skill (`.claude/skills/feature-spec/`), copy `docs/specs/TEMPLATE.md`, pick an unused rule prefix, and add a row to the Specs table in `docs/README.md` and the index in `docs/specs/README.md`.
- **Touchpoints:** `docs/specs/README.md` (the standard), `docs/specs/TEMPLATE.md`, `docs/README.md` (the Specs index), `.claude/skills/feature-spec/SKILL.md`.

## MCP server

### Redis-backed SSE stream resumption for the MCP server
- **What:** The MCP endpoint (`src/app/api/[transport]/route.ts`) runs `createMcpHandler` without a `redisUrl`. With Streamable HTTP, a long-running tool call holds an open response; across multiple instances a session that starts on one can't resume on another, so clients can drop mid-call.
- **Why deferred:** The app currently runs as a **single instance**, where this can't happen. Only relevant if/when it scales to multiple replicas.
- **Unblocked by:** Scaling past one instance — then provision Redis (same region) and pass its URL as the `redisUrl` config option to `createMcpHandler`. Add the var to `src/lib/env.ts` + `.env.example` first. (The in-memory MCP rate limiter in `src/lib/mcp/rate-limit.ts` would need to move to Redis at the same time.)
- **Touchpoints:** `src/app/api/[transport]/route.ts`, `src/lib/mcp/rate-limit.ts`, `src/lib/env.ts`.

### MCP tool coverage is partial (programs/cycles + profile/weight only)
- **What:** The MCP server exposes ~13 tools across programs, training cycles, and profile/weight. Workout logging/history, metrics/PRs, exercises, and social are NOT exposed.
- **Why deferred:** v1 scope was deliberately limited to two domains. The Server Actions for the other domains exist and follow the same `requireSession()` pattern.
- **Unblocked by:** A decision to widen the MCP surface. Mirror the existing pattern: add a `src/lib/mcp/tools/<domain>.ts` with a `register<Domain>Tools(server, userId)` and call it from the endpoint. Reuse the action logic but scope by the MCP `userId` (never reuse the cookie-session actions directly).
- **Touchpoints:** `src/lib/mcp/tools/`, `src/app/api/[transport]/route.ts`.

### `.well-known` route files are outside the tsc program
- **What:** `src/app/.well-known/**/route.ts` live under a dot-folder, which TypeScript's `**/*.ts` include glob skips, so `pnpm verify` does not type-check them (they use relative imports as a result). Next's bundler still builds them.
- **Why deferred:** The files are trivial one-line re-exports; the type-check gap is low-risk.
- **Unblocked by:** Wanting them covered — add an explicit `src/app/.well-known/**/*.ts` entry to `tsconfig.json` `include`.
- **Touchpoints:** `tsconfig.json`, `src/app/.well-known/`.

### MCP rate limiting — move to a shared store if the app scales
- **What:** MCP requests are rate-limited per `userId` (`src/lib/mcp/rate-limit.ts`), but the limiter is in-memory/process-local.
- **Why deferred:** Correct as-is for a **single instance**. Across multiple instances each would track its own counter, so the effective limit would be N× the intended one.
- **Unblocked by:** Scaling past one instance — move the counter to Redis (a token bucket keyed by `userId`). Pairs with the SSE/Redis entry above.
- **Touchpoints:** `src/lib/mcp/rate-limit.ts`, `src/app/api/[transport]/route.ts`.

### Auth: cookieCache delays ban / role revocation by up to 5 min
- **What:** `src/lib/auth.ts` enables a 5-minute encrypted session `cookieCache` to skip the DB session lookup. As a result, banning a user, downgrading an admin (`setUserRole`), or revoking a session takes up to 5 minutes to take effect, because role/ban are read from the cookie, not the DB.
- **Why deferred:** Deliberate performance tradeoff; the window is bounded at 5 min. Accepted for now.
- **Unblocked by:** A need for immediate revocation — then call `auth.api.getSession({ query: { disableCookieCache: true } })` inside `requireAdmin()` / the ban check, or drop `cookieCache`.
- **Touchpoints:** `src/lib/auth.ts`, `src/lib/utils/session.ts`.

### Minor: weight float comparison logs redundant history entries; reactions ignore privacy flag
- **What:** (1) MCP `update_profile` / `manage_weight` and their Server-Action originals compare a JS double against a Postgres `real` weight with `!==`, so re-sending the same weight can log a duplicate `user_weight_entry`. (2) `friends.ts toggleReaction` doesn't check the target's `showActivityToFriends` flag, so a friend can react to a session a user has hidden.
- **Why deferred:** Both are low-harm (data-quality / minor privacy), not data loss or a leak.
- **Unblocked by:** Caring about history cleanliness (round/compare at 0.01) or the privacy flag (add the `showActivityToFriends` check to `toggleReaction`).
- **Touchpoints:** `src/lib/mcp/tools/profile.ts`, `src/lib/actions/profile.ts`, `src/lib/actions/friends.ts`.

### MCP OAuth dynamic client registration is open
- **What:** The Better Auth `mcp` plugin exposes a dynamic client `registration_endpoint`, so any client can self-register an OAuth app. Access still requires the user to log in and consent, so this isn't a data-exposure hole — but it allows unbounded `oauth_application` rows.
- **Why deferred:** Standard MCP behavior; fine for current scale. The gate that matters (user auth + consent) is in place.
- **Unblocked by:** A need to restrict registration — add trusted-client config to the `mcp()` plugin, or prune stale/unused `oauth_application` rows on a schedule.
- **Touchpoints:** `src/lib/auth.ts`, `src/db/schema/auth.ts` (`oauth_application`).

### Run an independent security-review pass over the MCP + auth changes
- **What:** A security audit (Jun 2026) fixed the critical/high auth + MCP data-integrity findings (cross-user `getProgressiveSuggestions`/`upsertCycleSlot` leaks, `ai-model-configs` admin gating, login open-redirect, placeholder-secret boot guard, non-atomic MCP writes, validation gaps, rate-limit eviction). A fresh, independent pass was offered but deferred for time.
- **Why deferred:** No time right now; the verified high-severity items are already fixed and `pnpm verify` is green.
- **Unblocked by:** Running `/security-review` (or `/code-review high`) over the current branch diff before/after merge, and optionally addressing the lower-severity residuals captured in the entries above (cookieCache revocation lag, weight float dedup, reaction privacy flag).
- **Touchpoints:** whole MCP + auth surface — `src/lib/mcp/`, `src/app/api/[transport]/`, `src/lib/actions/`, `src/lib/auth.ts`, `src/middleware.ts`, `src/lib/env.ts`.

### iOS/WebKit: the first tap on a freshly-rendered page can be silently dropped
- **What:** On WebKit, a tap on an in-app `<Link>` issued shortly after a page renders is accepted by the anchor — `defaultPrevented` is `true`, so React had hydrated — but the App Router navigation never commits and the user stays put. Nothing is logged and nothing retries; the tap is simply gone. Reproduced on the workout screen (exercise row → set list) and on the set list (set row → set editor). The window follows a `router.refresh()`: dismissing the readiness sheet calls `confirmReadiness`, which runs a Server Action and refreshes, and a tap landing in that re-render is lost. Chromium never dropped the tap, which is why the e2e suite looked green when it was run there.
- **Why deferred:** Diagnosed while closing the WebKit gap on `ui/workout-layout-shift`; it is pre-existing on `main`, not caused by that branch, and fixing it properly means understanding why the App Router drops a navigation issued mid-refresh rather than papering over it in the components. The e2e suite is no longer exposed to it (`openFirstExercise` / `openFirstSetEditor` in `e2e/helpers.ts` retry the tap), so the suite is green — but the underlying product behaviour is unchanged and a real user gets a dead tap.
- **Impact:** Worst on the app's actual target platform. The dev build widens the window; production hydrates faster, so the window is narrower but not closed. Note this is the same user-visible symptom as the P1-1 tap-target work ("I tapped it and nothing happened"), from a different cause.
- **Unblocked by:** Deciding how to make navigation survive a concurrent refresh — e.g. not calling `router.refresh()` from `confirmReadiness` when the user has already interacted, deferring the readiness confirm until the first idle frame, or driving the row navigation through `router.push` in an explicit handler that can be retried.
- **Touchpoints:** `src/components/features/WorkoutSessionClient.tsx` (`showReadiness` / `confirmReadiness`), `src/components/features/ReadinessSheet.tsx`, `src/components/features/WorkoutExerciseList.tsx` (the row `<Link>`), `e2e/helpers.ts`.

### e2e: `exercise-timer-delay` intermittently fails on "element is not stable"
- **What:** Roughly 1 run in 6 on WebKit, `exercise-timer-delay` times out at 90 s clicking the Duration row, with Playwright reporting `element is not stable` — the control never stops moving long enough to be clicked. The other five runs pass in ~25 s.
- **Why deferred:** Not reproducible on demand. A diagnostic that samples every element's `getBoundingClientRect` per frame for 4 s found **zero** moving elements once the page transition had settled, so this is not a permanent oscillation — it looks like the click landing while the page-transition slide is still running, in a run where the dev server was also compiling. Chasing it further needs a capture from a failing run, which I could not force.
- **Unblocked by:** Catching one in the act — run the spec in a loop with `trace: "on"` and inspect the frame-by-frame screenshots of a failing attempt, or re-check against a production build where the transition is not competing with on-demand compilation.
- **Touchpoints:** `e2e/exercise-timer-delay.spec.ts`, `src/components/features/PageTransition.tsx`, `src/components/features/SetEditView.tsx`.

### A rest-time edit can be shown as saved without persisting
- **What:** Changing a set's rest time updates the label immediately, but the write is diffed against the last values the client fetched, so a change made before a `router.refresh()` has landed is silently skipped. The UI shows the new value and the database keeps the old one, with no error. Observed repeatedly through `e2e/rest-picker.spec.ts`, whose restore step hits exactly this window: on a lost race the program kept `05:00` while the UI reported the restore had succeeded. Reproduces on `main` as well as on this branch, so it is not new.
- **Why deferred:** Found while closing out the page-transition work, and fixing it properly means deciding how the rest write should reconcile against a stale diff base rather than adding another optimistic patch. The spec is now self-healing (it retries the restore and asserts persistence), so it no longer poisons the shared program for later runs, but the product behaviour is unchanged.
- **Impact:** Same class as the un-log/re-log divergence: the screen and the database disagree, and the user has no way to tell. Lower severity, since it is one field and re-editing after a refresh works.
- **Unblocked by:** Deciding whether the rest write should be unconditional, or should re-read before diffing.
- **Touchpoints:** `src/components/features/WorkoutSetsList.tsx` (`saveCurrentState` and the rest persistence path), `e2e/rest-picker.spec.ts`.
