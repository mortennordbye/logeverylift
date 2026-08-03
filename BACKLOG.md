# BACKLOG

Anything Claude (or anyone) leaves unfinished, partially implemented, or explicitly defers goes here. Each entry: what, why deferred, what would unblock it, where the relevant code lives.

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

## Codebase hygiene (deferred long-term)

### React Compiler lint rules demoted to warnings
- **What:** `eslint-config-next` 16.2 turned on the React Compiler rules. They report 14 problems across 8 files — 13 `react-hooks/set-state-in-effect` and 1 `react-hooks/purity`. Both are set to `"warn"` in `eslint.config.mjs` so the dependency bump that introduced them didn't have to carry a 14-site refactor. `pnpm lint` is clean of errors; the warnings still print.
- **Why deferred:** Most hits are the deliberate hydrate-from-localStorage-in-an-effect pattern (theme, pending queue, session overrides), which needs SSR-safe restructuring rather than a mechanical fix. The one `purity` hit (`WorkoutSetsList.tsx:417`, `Date.now()` in `setRestTimerEnd`) is a false positive — the call is inside an async event handler, not render.
- **Unblocked by:** Deciding to do the effects pass. Per site: move the read into a `useSyncExternalStore` or a lazy `useState` initialiser guarded for SSR, then flip each rule back to `"error"`. The purity one can be silenced with a targeted disable comment once the rest are addressed.
- **Touchpoints:** `eslint.config.mjs` (the override block), `src/components/ui/theme-provider.tsx:83`, `src/contexts/pending-queue-context.tsx:85`, `src/components/features/WorkoutSetsList.tsx:157,173,181,417`, `WorkoutSetsClient.tsx:106`, `WorkoutSessionClient.tsx:89,101`, `ProgramDetailClient.tsx:175,182`, `ProgramListClient.tsx:25`, `CyclesListClient.tsx:105`, `LogRunModal.tsx:75`.

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
- **What:** A multi-agent audit (Jun 2026) fixed the critical/high auth + MCP data-integrity findings (cross-user `getProgressiveSuggestions`/`upsertCycleSlot` leaks, `ai-model-configs` admin gating, login open-redirect, placeholder-secret boot guard, non-atomic MCP writes, validation gaps, rate-limit eviction). A fresh, independent pass was offered but deferred for time.
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
