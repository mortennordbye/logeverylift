# BACKLOG

Anything left unfinished, partially implemented, or explicitly deferred goes here. Each entry: what, why deferred, what would unblock it, where the relevant code lives.

Don't put work-in-progress here. WIP belongs on a branch. This is for *known* gaps the team has agreed to leave for later.

When you finish an item, delete it. When you add an item, write enough that someone unfamiliar with the conversation can pick it up.

---

## New features — additive

### Norwegian sign-in form on the welcome page
- **What:** `/welcome?lang=no` translates all of the welcome page's own copy, but the embedded sign-in form (labels, "Sign In" button, "New here? Create account") stays in English, as do `/login` and `/signup`.
- **Why deferred:** The Norwegian option was asked for on the front page only. `LoginForm` is shared with `/login`, so translating it means adding a language prop or real i18n rather than a page-local dictionary.
- **Unblocked by:** Deciding whether Norwegian should extend past the front page. If yes, introduce i18n (or a `lang` prop on `LoginForm`) and pass the welcome page's language through to `/login` and `/signup`.
- **Touchpoints:** `src/app/welcome/page.tsx` (`COPY`), `src/components/features/LoginForm.tsx`.

### AI Setup: seven training days a week
- **What:** AI Setup's plan builder offers 2 to 6 days per week. There is no 7-day split, and an AI edit can't add a day, because edits keep the picked days (`docs/ai-setup-plan.md`, D-6 and D-7).
- **Why deferred:** The old free-text box covered 7 days by asking a model for a whole plan; that path was removed so plans cost nothing. Nobody has asked for 7 days since.
- **Unblocked by:** A request for 7-day training. Then add a 7-day split to `autoSplit` (for example push/pull/legs twice plus a conditioning or mobility day), add 7 to `TEMPLATE_DAYS`, and extend the combination tests.
- **Touchpoints:** `src/lib/utils/plan-templates.ts` (`TEMPLATE_DAYS`, `autoSplit`, `SPLIT_DAYS`), `src/__tests__/plan-templates.test.ts`.

### Manage program shares: see and revoke who a program is shared with
- **What:** Sharing a program with a friend works (`ProgramShareButton` calls `shareProgram`), and the friend sees it under More → Friends → Shared programs. But the sharer has no way to see who they've shared a program with or to take a share back. The server side exists and is unused: `getOutgoingShares(programId)` lists a program's shares and `revokeShare(shareId)` removes one, both owner-checked. A screen (for example a "Shared with" list in the program's share sheet, each row with a Revoke button) is missing.
- **Why deferred:** Found during the 2026-10-21 dead-code cleanup (#77). The two actions were kept rather than deleted because they're a missing feature, not dead code; nobody has asked to revoke a share yet.
- **Unblocked by:** Wanting to manage shares. Build the list into the share UI, call `getOutgoingShares` on open and `revokeShare` per row, and add an e2e spec for share then revoke. If it's decided the feature isn't wanted, delete both actions instead.
- **Touchpoints:** `src/lib/actions/program-shares.ts` (`getOutgoingShares`, `revokeShare`), `src/components/features/ProgramShareButton.tsx`, `src/components/features/SharedProgramsClient.tsx`.

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

### Exercise-type: laterality dimension + backfill precision
- **What:** Exercise type shipped as a single flat enum (compound/accessory/isolation/plyometric/isometric) with a per-program override (Jun 2026). Two follow-ups: (1) the **unilateral/bilateral** laterality axis was intentionally left out — it's orthogonal (a Bulgarian split squat is compound *and* unilateral) and folding it into the one enum would be wrong; (2) the **library backfill is coarse** — `0039` derives type from `movement_pattern`, so cable/dumbbell isolation work tagged `push`/`pull` (curls, raises, flyes, pushdowns) is currently mislabeled `compound` (≈142 of ~196 rows landed on compound). The editor lets users correct individual exercises, but the bulk default is rough.
- **Why deferred:** (1) laterality is a separate feature with its own column + picker; no one asked for it yet. (2) precise per-exercise classification of the 191 seed entries is a manual judgment pass the user opted out of in favour of the heuristic.
- **Unblocked by:** (1) wanting unilateral/bilateral tracking — add a nullable `laterality` enum column to `exercises` (+ optional `program_exercises` override) mirroring the exercise-type plumbing. (2) wanting accurate types — do a one-time pass classifying the seed `EXERCISES` array explicitly (a name/equipment-aware heuristic: single-muscle + cable/machine ⇒ isolation), then a corrective migration `UPDATE` for existing rows.
- **Touchpoints:** `src/db/schema/exercises.ts`, `src/db/schema/programs.ts`, `src/lib/utils/exercise-type.ts` (`exerciseTypeFromPattern`), `scripts/seed.ts` (`EXERCISES`), `drizzle/0039_nice_supreme_intelligence.sql` (the backfill CASE), `src/components/features/ExercisesClient.tsx`.

## Privacy and legal

### Have a lawyer review the privacy policy and terms
- **What:** The privacy policy, terms and consent texts were drafted against GDPR, personopplysningsloven and ekomloven, but nobody with legal training has read them.
- **Why deferred:** Getting a review needs a person and possibly a fee; the drafts were needed now that sign-up is open.
- **Unblocked by:** A short review by a Norwegian privacy lawyer. Ask specifically about the two open questions below: required health-data consent, and AI consent with free models that may train on requests.
- **Touchpoints:** `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/components/features/ConsentChecks.tsx`, `src/components/features/AiConsentSheet.tsx`, `docs/privacy/data-inventory.md`.

### Health-data consent is required to sign up
- **What:** Sign-up needs both boxes ticked, including explicit consent to health data (Art. 9(2)(a)). GDPR Art. 7(4) is wary of consent made a condition of a service. The argument is that a training log can't work without training data, but body weight, readiness and heart rate are optional features.
- **Why deferred:** Letting people decline would mean hiding or disabling every body-data field (profile, weight history, readiness, HR zones, notes) for them, a large change for an uncertain gain.
- **Unblocked by:** The lawyer review above. If it says consent must be optional, add a `healthConsentAt`-gated mode that hides those fields, and make the second box optional.
- **Touchpoints:** `src/lib/actions/legal.ts` (`acceptTerms`), `src/components/features/ConsentChecks.tsx`, `src/components/features/AccountClient.tsx`.

### AI editing on free models that may keep requests
- **What:** AI Setup uses free OpenRouter models whose providers may store and train on requests, possibly outside the EEA. This is covered by an explicit opt-in that says so, but a no-training route would be cleaner. OpenRouter can exclude training providers per request (`provider.data_collection: "deny"`), which may leave no free model available.
- **Why deferred:** Testing it needs the production OpenRouter key, and a paid, zero-retention model costs money.
- **Unblocked by:** Trying `data_collection: "deny"` against the enabled free models. If they still answer, set it in `callOpenRouter` and soften the consent text and policy. Otherwise decide whether to pay for a no-training model.
- **Touchpoints:** `src/lib/llm.ts` (`callOpenRouter`), `src/components/features/AiConsentSheet.tsx`, `src/app/privacy/page.tsx`.

### Retention for inactive accounts
- **What:** Accounts and their data are kept until the user deletes them, however long they stay unused. Storage limitation (Art. 5(1)(e)) favours deleting long-inactive accounts.
- **Why deferred:** The app can't send email, so it can't warn someone before deleting their account, and silently deleting training history is worse than keeping it.
- **Unblocked by:** Email sending. Then warn after, say, 24 months without a login and delete 30 days later; add the rule to the policy and the inventory.
- **Touchpoints:** `docs/privacy/data-inventory.md`, `src/lib/account-data.ts`.

### Short DPIA
- **What:** A data protection impact assessment for health data processing. At this scale it is likely not mandatory, but Datatilsynet's list puts health data and new technology (AI) close to the line.
- **Why deferred:** Needs the lawyer review's answer on whether it is required.
- **Unblocked by:** The review. If required or wanted, write it to `docs/privacy/dpia.md` from the inventory.
- **Touchpoints:** `docs/privacy/data-inventory.md`.

## Smart-progression UX (deferred long-term)

### Skip suggestion compute for completed sets
- **What:** In `getProgressiveSuggestions`, skip program sets whose corresponding `workoutSet.isCompleted = true` in the active session.
- **Why deferred:** Marginal CPU win. The UI already settles the chips to a tick for completed sets rather than acting on them (`WorkoutSetsList.tsx:1901`). Adds a DB query for negligible benefit.
- **Unblocked by:** Profiling that shows suggestion compute is a real bottleneck (unlikely with current dataset sizes).
- **Touchpoints:** `src/lib/actions/workout-sets.ts` (`getProgressiveSuggestions`).

### Per-exercise (not per-set) progression UI
- **What:** Collapse the per-set `↑ Xkg` badges into one affordance per exercise: "↑ all working sets to 82.5 kg". Today, applying a suggestion propagates across siblings, but the badges still render per-set.
- **Why deferred:** Bigger UX redesign than the recent rounds covered. Hold until you've used the current per-set badges for a while and confirmed the clutter is real.
- **Unblocked by:** Concrete user feedback that the per-set badges are still too noisy now that warm-ups are filtered and the apply propagates.
- **Touchpoints:** `src/components/features/WorkoutSetsList.tsx` (`SortableSetRow`, the suggestion chips).

### Effort-prompt suppression doesn't round-trip through export/import
- **What:** `progressionSuppressEffortPrompt` (the "Skip the effort prompt" toggle, SI-43 in `docs/specs/smart-incrementation.md`) isn't included in the JSON export/import format, unlike its sibling `progressionApplyToPlan` which is explicitly round-tripped (`src/lib/actions/programs.ts:1021,1090,1263`, `src/lib/validators/workout.ts:500`). An imported program silently defaults the flag to `false` (prompt shown) regardless of what the exporter had set.
- **Why deferred:** Degrades gracefully — worst case is the prompt reappears on import, not silent data loss — and adding it means touching the export/import Zod schema plus its round-trip test (`src/__tests__/validators.test.ts:674-695` covers `applyToPlan`'s case) for a flag that just shipped and has no usage signal yet.
- **Unblocked by:** Confirmation the toggle sees real use; then add it next to `progressionApplyToPlan` in the same three call sites plus the import schema and its test.
- **Touchpoints:** `src/lib/actions/programs.ts` (`exportProgram`, `exportAllPrograms`, `importProgram`), `src/lib/validators/workout.ts:500`, `src/__tests__/validators.test.ts:674-695`.

### Logged weight vs program-planned weight quirk
- **What:** `buildSuggestion` takes `baseWeight` from the last logged session (`src/lib/utils/progression.ts:1221`), not the program's planned weight. If a user logs a one-off heavy single, the next suggestion is built off that single — which then usually shows "held" because the consensus gate kicks in. Surprising in edge cases.
- **Why deferred:** Rare in practice; the consensus gate masks most surprise. Tier 1 changes don't make it worse.
- **Unblocked by:** A user reporting concrete confusion.
- **Touchpoints:** `src/lib/utils/progression.ts:1206-1226`.

### pnpm 11 is pinned away from, not migrated to
- **What:** The Dockerfile installs `pnpm@10` at every stage, matching the major CI's `pnpm/action-setup` pins. It used to install whatever was newest, and when pnpm 11 shipped it turned `ERR_PNPM_IGNORED_BUILDS` into a hard error, so `pnpm install` began failing inside the image — breaking `make dev` and the production image CI pushes, with no change to this repo. Pinning restored the tested toolchain; it did not resolve the underlying question. Eight packages have build scripts pnpm has been *ignoring* all along (`sharp`, three `esbuild` versions, `unrs-resolver`, `lefthook`, `@sentry/cli`, `msw`), and `sharp` is the one that matters — Next.js uses it for image optimization, and it is a native module whose install script is what fetches its binaries.
- **Why deferred:** Allowing a package to build decides which packages may run arbitrary code at install time, and it changes what actually gets built in the image. That is a supply-chain decision, not a build fix, and it wants to land on its own rather than folded into an unrelated release. Until then every entry under `allowBuilds` in `pnpm-workspace.yaml` is `false` (#43). pnpm 11 had written them as unresolved placeholders, which failed its dependency check before any script ran, the pre-push `pnpm verify` included. `false` is what pnpm 10 already did, so nothing is built that was not built before, and local `pnpm` commands and the hook no longer need a flag or an environment variable.
- **Unblocked by:** Deciding which entries to flip to `true`, then verifying that image optimization still behaves — if `sharp` has never been built, the current production image is already running without it and allowing it would change that behaviour rather than preserve it. Check before assuming either way.
- **Touchpoints:** `Dockerfile` (four `npm install -g pnpm@10` lines), `.github/workflows/ci.yml:34-37`, `pnpm-workspace.yaml`.

### Two shapes left by migration 0051 read Custom in the progression sheet
- **What:** Two configurations nobody chose match no preset, so the sheet labels them Custom. (1) `reps` exercises with `progression_required_hits` null: the engine gates them on `REQUIRED_HITS` (2), which is what rep mode did before the rebuild, but the Rep ladder preset fixes the gate at 1. Prod had 14 such exercises on 2026-09-14. (2) Timed exercises that 0051 backfilled to `load` with `backoff`: the sheet and the engine both snap the advance to `duration` (`effectiveAdvance`, since the smart-incrementation review), but the Duration preset wants `hold`, so the regress axis still reads Custom. A whole-database count of shape (2) was not taken; one user has four (Cycling, Hollow Hold, two Warm Ups). The effort-cap cause of the same symptom was fixed in #43.
- **Why deferred:** Both fixes change behaviour, not just the label. Gating (1) on one session makes those exercises progress twice as fast; moving (2) to `hold` stops it backing off after misses. The Ironman programs that surfaced this were corrected by hand instead.
- **Unblocked by:** Choosing per shape between a data migration and a preset-table change that gives today's behaviour a name.
- **Touchpoints:** `src/lib/utils/progression-presets.ts` (`PROGRESSION_PRESETS`, `matchPreset`), `src/lib/utils/progression.ts:158` (`effectiveAdvance`, the advance snap), `drizzle/0051_progression_axes.sql`.

### A timed set cannot plan or progress weight
- **What:** A weighted hold (Pallof Hold against a cable, a loaded carry) can only progress its time. Saving a timed set from the program editor writes duration, rest and start delay but not weight, the set row renders only the time, and the `duration` advance suggests a longer hold, never more load. Weight can still be entered during a workout and is logged.
- **Why deferred:** Pallof Hold shipped on the `duration` advance, which the engine supports today. Weight on timed sets needs a new judging rule (hold the target time at this weight, then add weight) plus editor and row changes.
- **Unblocked by:** Deciding whether a weighted hold should progress weight at a fixed time, time at a fixed weight, or alternate. Then: write `weightKg` in the timed branch of the program-edit save, show it on the timed row, and add a load step to the `duration` case in the engine.
- **Touchpoints:** `src/components/features/SetEditView.tsx:348` (timed save omits weight), `src/components/features/WorkoutSetsList.tsx:1742` (timed row shows time only), `src/lib/utils/progression.ts:1634` (the `duration` case).

## Cycle periodization (spec divergences)

Findings from the [`cycle-periodization`](docs/specs/cycle-periodization.md) spec pass (2026-08-25 @ `91c1646`). Rule IDs are `PZ-n`; divergence IDs `D1`-`D8` are the rows of that spec's Divergences table.

### Cycle periodization divergence D4: the periodization sync races the reads that display it
- **What:** The sync runs lazily inside `getActiveCycleForUser` (`src/lib/actions/training-cycles.ts:175-177`). On the first visit of a new cycle-week the workout page starts `getProgramWithExercises` — which reads `program_sets` — in the same `Promise.all` as `getWorkoutInsight`, whose nested `getActiveCycleForUser` performs the sync (`src/app/programs/[id]/workout/page.tsx:28-33`). The set read almost always resolves first, so that render shows the previous week's targets under the new week's header. Separately, `/cycles/[id]` calls `getCyclePeriodization` only, which never syncs, so it can report a new week's phase against the previous week's `adaptation_pct`. Both self-correct on the next load. Contradicts `PZ-29` and `PZ-40`.
- **Why deferred:** Self-correcting and one render wide; the fix is a restructure of a hot render path (awaiting the sync before the reads, or lifting it out of the read path entirely), which is more blast radius than a spec pass should take on.
- **Unblocked by:** Deciding where the sync belongs. Cheapest correct fix: `await` the cycle read before the rest of the workout page's `Promise.all`, and have `getCyclePeriodization` ensure-sync for an active cycle. Better long-term: move the sync out of the read path (a mutation on session start, or a scheduled job) so no render depends on write ordering.
- **Touchpoints:** `src/lib/actions/training-cycles.ts` (`getActiveCycleForUser` 175-177, `syncPeriodizedTargets` 536-621, `getCyclePeriodization` 375-442), `src/app/programs/[id]/workout/page.tsx` (28-33), `src/app/cycles/[id]/page.tsx` (31), `src/lib/actions/workout-sets.ts` (`getWorkoutInsight` 1330-1350).

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

### SetEditView seeds its fields from overrides via `useState` initialisers
- **What:** `SetEditView` reads `workoutSession.overrides[set.id]` in `useState(...)` initialisers (reps, weight, duration, notes, failed, rir). Those run once. Overrides are restored from localStorage in a mount effect on a provider above, so on a **cold load of the set-edit URL** the initialisers may run before the overrides exist, leaving the editor showing program values while the set list shows adjusted ones. Not observed in the audit — the case wasn't exercised — but the ordering that caused the hydration mismatch fixed in this pass (see `useRenderedOverrides`) is the same ordering that would cause it.
- **Why deferred:** Unverified, and it is a correctness question about override initialisation rather than the layout-shift brief.
- **Unblocked by:** Reproduce first: apply a suggestion to a set, then hard-reload that set's `/sets/[setId]` URL and check whether the editor shows the adjusted or the program value. If adjusted, there is nothing to fix.
- **Touchpoints:** `src/components/features/SetEditView.tsx` (the `useState` block, ~lines 125–160), `src/contexts/workout-session-context.tsx` (`useRenderedOverrides` and the restore effect).

### One e2e worker started on the sign-in page in a main CI run
- **What:** In CI run 40006288669 (the merge of #117, 2026-10-23), every spec in one WebKit worker of E2E shard 1 (`parallelIndex` 1, seven specs across ai-setup, consent, exercise-timer, page-transition, progression-suggestion and readiness) failed because the page was the sign-in form, as if that worker's saved session was invalid from its first spec on. Its `authenticate worker 1` setup had passed. The same commit passed on the PR, and a re-run of the failed jobs passed.
- **Why deferred:** Found while shipping an unrelated illustration batch; the logs show no server error, and the cause was not found in the time spent.
- **Unblocked by:** Reproduce by running the e2e suite repeatedly with two workers and checking whether a worker's storage state is ever rejected; look at what can end the e2e users' sessions between `e2e/auth.setup.ts` writing the file and the first spec (session expiry or rotation in the auth config, the consent redirect, a spec that signs out). The run's artifacts (`playwright-report-shard-1`) have the page snapshots.
- **Touchpoints:** `e2e/auth.setup.ts`, `e2e/fixtures/test.ts` (`storageState`), `e2e/fixtures/env.ts`, `playwright.config.ts`.

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


### `eslint-config-next` held at 16.1.6 while `next` is on 16.4.2
- **What:** `eslint-config-next` 16.4.2 pulls `eslint-plugin-react-hooks` 7.1.1, whose stricter rules report 17 errors in existing code, mostly `react-hooks/set-state-in-effect` (14), plus `react-hooks/purity` and `react-hooks/immutability`.
- **Why deferred:** `next` was bumped to 16.4.2 to fix a router action-queue race that dropped taps and pulled users back a screen (`e2e/session-start-race.spec.ts`). Rewriting effects across the app to satisfy new lint rules is separate work and would have buried that fix.
- **Unblocked by:** Bumping `eslint-config-next` to match `next`, running `pnpm lint`, and fixing or deliberately suppressing each finding with a reason.
- **Touchpoints:** `package.json`, `eslint.config.mjs`, the files `pnpm lint` reports after the bump.
