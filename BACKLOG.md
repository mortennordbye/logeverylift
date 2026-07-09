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
