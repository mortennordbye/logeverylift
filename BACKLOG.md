# BACKLOG

Anything left unfinished, partially implemented, or explicitly deferred goes here. Each entry: what, why deferred, what would unblock it, where the relevant code lives.

Don't put work-in-progress here. WIP belongs on a branch. This is for *known* gaps the team has agreed to leave for later.

When you finish an item, delete it. When you add an item, write enough that someone unfamiliar with the conversation can pick it up.

---

## New features — additive

### Home widgets: catalogue sizes the locked design left out
- **What:** Sizes from the widget catalogue (`docs/home-widgets-audit.md`, section 4) not built with the redesign: Weekly volume M (top muscles vs target) and L (all muscle bars), Body weight L (90-day line), Training load S (form and band) and per-sport L, Race countdown M (race, date, days, phase).
- **Why deferred:** The locked design (`docs/design/home-redesign/home-locked.html`) gives these widgets only the sizes that were built, and the redesign built to it.
- **Unblocked by:** A design for each size from the owner. The data is already read by each widget's loader, except the race's season phase (`listSeasons` returns `currentPhase`).
- **Touchpoints:** `src/lib/home/widgets/weekly-sets.ts`, `body-weight.ts`, `training-load.ts`, `race-countdown.ts`; `src/components/features/home/widgets/*/View.tsx`.

### Garmin for every user
- **What:** Open the Garmin section (connection, More → Garmin, background import, AI tools) to all users. Today it is on in prod for admin accounts only (`garminAllowed` in `src/lib/garmin/access.ts`), which is the owner's own data.
- **Why deferred:** The Garmin Connect Personal API Supplemental Terms (last updated 2026-10-01, section 1) say: "Any API key issued to you is personal to you and may be used only by you in connection with applications, services, or tools that you develop or operate for your own use. You may not sell, transfer, sublicense, distribute, disclose, or otherwise share your API key with any third party." So letting other users paste their own key is ruled out: they would disclose it to us and use a tool they do not operate. Violations can lead to key revocation (section 3). The owner's own use is allowed, which is what runs in prod. The route for other users is the Garmin Connect Developer Program (Garmin's consent screen, no shared keys); its Starter tier is reported free for up to about 1,000 users, Enterprise has a $1,000 entry fee and confidential per-user fees from April 2027 at the earliest. The owner chose owner-only on 2026-11-12.
- **Unblocked by:** Being accepted into the Garmin Connect Developer Program and moving from per-user Personal API keys to its OAuth flow. Then: decide whether GPS tracks in `garmin_activity_streams` need their own opt-in (decision G-2 in `docs/plans/garmin-deep-data.md`); follow the `privacy-compliance` checklist (policy text from `docs/privacy/data-inventory.md`, including the AI tools' Garmin metrics, `garmin_fuel_logs`, the population ratings from profile gender and age, and the opt-in weight sync whose copies stay when Garmin data is deleted), bump `LEGAL_VERSION`, raise `CONSENT_VERSION` because these are new health-data categories; then widen `garminAllowed`.
- **Touchpoints:** `src/lib/garmin/access.ts`, `src/lib/actions/garmin.ts`, `src/lib/garmin/`, `src/app/privacy/page.tsx`, `src/lib/constants/legal.ts`.

### Seasons: fitness projection across phases
- **What:** The Garmin race views read the A race from the season, but the fitness projection to race day uses only the active phase's curve. Phases after it are not projected. (The other gap of the seasons package, limits on the chained start and on `resume`, closed with D2 part 2: `docs/plans/limits-strength-readiness.md`.)
- **Why deferred:** The projection across phases needs the timeline of every later phase and its programs, which belongs with D2's load model.
- **Unblocked by:** Nothing now: D1's load and the weekly load ramp (D2 part 2) are in. Build the projection from `getSeasonDetail` phases, each with its own curve (`cycleLoad`).
- **Touchpoints:** `src/lib/garmin/analytics/projection.ts`, `src/lib/garmin/queries.ts` (`getRaceProjection`).

### Dated sessions: what C2 left for later
- **What:** Three gaps left by the session model (C2, `docs/plans/sessions.md`):
  - `dismissed_makeups` is still written when a whole day is declined, so an app from before C2 keeps hiding the day after a rollback (hub decision 13). Reads use the session's status only. Drop the writes and the table one release after C2.
  - The calendar shows no program on a rotation cycle's days (hub decision 14), though `listPlanned` can work them out.
  - A rotation session can be skipped or changed over MCP only; the app has no button for it.
- **Why deferred:** The first is a rollback safety net for one release. The other two were left out to keep the rotation lifter's screens unchanged in C2.
- **Unblocked by:** One release of C2 in prod without a rollback (then a migration drops the table and `dismissIfDayClear` goes); and an owner choice on rotation days in the calendar.
- **Touchpoints:** `src/lib/planned-sessions.ts` (`dismissIfDayClear`, `listPlanned`, `applyRotationOp`), `src/components/features/CycleCalendarClient.tsx` (`getDayInfo`), `src/db/schema/dismissed-makeups.ts`.

### Nutrition and race plans: what E1 and E2 left for later
- **What:** Three gaps left by the nutrition and race-day package (E1, E2, `docs/plans/nutrition-and-race-day.md`):
  - Drop the `garmin_fuel_logs` table. Migration 0089 copied its rows into `fuel_logs`; nothing reads or writes it now, and it is kept one release only so a rollback loses no Garmin fuel log.
  - Race plans for olympic and sprint triathlons, and for run and ride races (decision 6). The rules and the timeline cover half and full only; `racePlan` refuses other distances.
  - A research pass on run pacing off the bike and on race swim pacing. The research reference has neither, so the run guide pace (80-85 % full, 85-90 % half of threshold speed) and the swim offset (CSS + 5 s/100 m) are labelled Inference (decisions 3 and 4).
- **Why deferred:** The drop must wait one release for rollback. Other distances and new pacing rules need research the reference does not hold yet; the owner's race is a half.
- **Unblocked by:** One release after E1 ships, a migration that drops `garmin_fuel_logs` (and its schema, export entry and delete line). For distances and pacing: a new research pass (T1) with evidence labels, then extend `LEG_METERS`, `BIKE_IF`, `BIKE_TSS_CAP` and `RUN_SPEED_SHARE`.
- **Touchpoints:** `src/db/schema/garmin.ts` (`garminFuelLogs`), `src/lib/account-data.ts`, `src/lib/garmin/delete-data.ts`, `src/lib/utils/race-plan.ts`, `src/lib/race-plans.ts`, `docs/research/endurance-training-reference.md`.

### Step editor for structured workouts
- **What:** A screen to build and change a structured workout step by step (steps, repeats, end conditions, targets). Today only a connected assistant creates and changes workouts (`manage_workout`, `manage_planned_session` `set_workout`); the app's library (`/more/workouts`) lists, duplicates, renames, deletes and restores them.
- **Why deferred:** Decision 2 in `docs/plans/workouts-and-compliance.md` (section 18): C4 and C5 built the schema, the library, planned vs done and sick periods on the server; the views, the editor and the guided player belong to package C6.
- **Unblocked by:** The follow-up PR C6b (decision 2 in `docs/plans/endurance-app.md`, section 17: the player and load ship first, reviewed alone). Build the editor on the schema check in `src/lib/utils/workout-steps.ts` (`parseWorkout`), so the app and MCP refuse the same workouts, and list the library with `listWorkouts`.
- **Touchpoints:** `src/lib/utils/workout-steps.ts`, `src/lib/workouts.ts`, `src/lib/actions/workouts-compliance.ts` (`manageWorkout`), `docs/mcp/workout-steps.md`.

### Brick, library and Garmin controls in the app
- **What:** Three controls from section 7 of `docs/plans/workouts-and-compliance.md` that the app does not show yet: "Update from library" and "Link as brick" in the calendar day sheet; the list of the day's Garmin activities in the "Yes" sheet for admins (6.5); and Recently deleted with Restore for sick periods. The server has all of them (`applySessionOp` ops `update_from_library`, `link_brick`, `unlink_brick`, `pick`; `restoreDeletedAthleteRow` for a sick period), and the assistant can use them over MCP. The app's Server Action and validator accept none of them yet: add each op to `plannedSessionOpSchema` with its control.
- **Why deferred:** The C4/C5 build kept the app UI to the answers, the sick periods and the library list; these are less used and fit the C6 views.
- **Unblocked by:** Package C6, or an owner request. Sick periods also need a read of deleted rows (a `deleted` option on `listIllness`).
- **Touchpoints:** `src/components/features/CycleCalendarClient.tsx`, `src/components/features/SessionAnswers.tsx`, `src/components/features/AthleteProfileClient.tsx`, `src/lib/illness.ts` (`listIllness`), `src/lib/validators/planned-sessions.ts` (`plannedSessionOpSchema`), `src/lib/actions/workouts-compliance.ts`.

### Home week strip for workout sessions
- **What:** A dated session that runs a structured workout, not a program, does not count on the home screen's week strip. Package C6 added the "Endurance today" card on home and the week view (`/week`), which show them; the strip still reads C2's program-only home read.
- **Why deferred:** The strip is part of the lifter's home card, which C6 kept unchanged (`docs/plans/endurance-app.md`, 4.1). The week view covers the endurance user.
- **Unblocked by:** An owner request. Count workout sessions in `homeWeekPlanned` for endurance users only, and keep the lifter characterization tests green.
- **Touchpoints:** `src/lib/home/core.ts` (`loadHomeCore` reads `homeWeekPlanned` into `weekPlanned`), `src/components/features/home/widgets/week/View.tsx` (the strip), `src/lib/home-week.ts`, `src/components/features/guided/EnduranceTodayCard.tsx`.

### Guided player: start offline from a cold app
- **What:** The guided player needs its page opened online once: one server render loads the workout, the targets and the units. After that it runs, and keeps its result, offline. A phone with no network that opens the app cold cannot start a session.
- **Why deferred:** Decision 7 in `docs/plans/endurance-app.md` (section 17). Caching the page and its data for offline start needs a service worker strategy for these routes and a test that runs offline.
- **Unblocked by:** A real need (a pool with no signal). Then precache today's `/planned/[id]/play` and `/pool` when the home card renders, or keep the player's data in the saved run.
- **Touchpoints:** `src/app/sw.ts`, `src/app/planned/[id]/play/page.tsx`, `src/components/features/guided/useGuidedPlayer.ts`.

### Guided player: spoken cues
- **What:** The player cues each step with beeps, a screen flash and a screen-reader line. A voice that reads the next step and its target ("Work, 10 minutes, 220 to 233 watts") would help when the phone is out of sight.
- **Why deferred:** Decision 5 in `docs/plans/endurance-app.md`: not in version 1. `speechSynthesis` behaves differently on iOS (it needs a gesture and can stop in the background).
- **Unblocked by:** An owner request and a device check on iOS.
- **Touchpoints:** `src/lib/audio-cues.ts`, `src/components/features/guided/useGuidedPlayer.ts`.

### Load: pace and CSS load for Garmin runs and swims
- **What:** Sessions logged in the app get run pace load and swim load from CSS (`src/lib/utils/training-load.ts`). Garmin activities still use power, heart rate or Garmin's own TSS (`src/lib/garmin/analytics/activity.ts`), though the Garmin design (2.2) planned pace and CSS load for them too.
- **Why deferred:** Decision 14 in `docs/plans/endurance-app.md`: the owner's Garmin loads keep their method in the C6/D1 PR.
- **Unblocked by:** An owner yes. Then add `run_pace` and `swim_css` to `computeActivityMetrics` with the user's thresholds, bump `ACTIVITY_MODEL_VERSION`, and check the first real swim file (pool lengths).
- **Touchpoints:** `src/lib/garmin/analytics/activity.ts`, `src/lib/utils/training-load.ts`, `src/lib/garmin/metrics-job.ts`.

### Load: research pass on session RPE, run pace and swim load
- **What:** The three load models of package D1 (minutes × RPE × 0.22, run pace with IF², swim with IF³ from CSS) are labelled Inference: the research reference has no section on them.
- **Why deferred:** Decision 20 in `docs/plans/endurance-app.md`. T1 says the reference changes by a research pass, not by hand edits.
- **Unblocked by:** A research pass that adds session-RPE load (Foster), rTSS and swim load with their evidence; then update the labels in `LOAD_EVIDENCE` and the week view's info.
- **Touchpoints:** `docs/research/endurance-training-reference.md`, `src/lib/utils/training-load.ts`, `src/lib/mcp/tools/endurance-app.ts` (`LOAD_EVIDENCE`), `src/app/week/page.tsx`.

### Load: assistant-logged strength sessions in the Garmin series
- **What:** The Garmin worker counts strength load only from sessions with `source` `app`; strength sessions an assistant logged (`log_session`) do not count. App endurance sessions from both sources now count (decision 15 in `docs/plans/endurance-app.md`), and the app series without Garmin counts both.
- **Why deferred:** The C6/D1 PR changes no strength number for the owner.
- **Unblocked by:** An owner yes. Then add `assistant` to the source filter in `strengthSessions` and bump `DAILY_MODEL_VERSION`.
- **Touchpoints:** `src/lib/garmin/metrics-job.ts` (`strengthSessions`).

### Per-sport split of mixed app sessions in the Garmin series
- **What:** In the Garmin series, an app session with strength sets counts whole as strength (wall time × session RPE), as in model v2, even when it also holds a run or a ride, such as a warm-up run in a gym session. The app series for users without Garmin splits such a session by sport (the endurance sets by their own method, strength on the rest of the time).
- **Why deferred:** Review fix 1 in `docs/plans/endurance-app.md` (section 19): adding the endurance sets on top double counted the warm-up, and splitting would change the owner's stored strength numbers. Leaving them out keeps the series as in v2.
- **Unblocked by:** An owner yes. Then give the strength path the wall time minus the endurance sets' time, as `appSessionLoads` does, add those sets as app endurance entries, and bump `DAILY_MODEL_VERSION`.
- **Touchpoints:** `src/lib/garmin/analytics/daily.ts` (`buildDailyMetrics`), `src/lib/garmin/metrics-job.ts` (`strengthSessions`), `src/lib/training-load.ts` (`appSessionLoads`).

### Load: the Garmin series waits for the next sync after an app log
- **What:** For a Garmin user, an endurance session logged in the app (a guided run, "Yes, I did it") reaches fitness and fatigue only when the Garmin worker rebuilds the daily series, which happens after new Garmin data arrives. Users without Garmin see it at once.
- **Why deferred:** Rebuilding the series from a Server Action would put Garmin work on the logging path.
- **Unblocked by:** The owner noticing the delay. Then mark the series stale (`garmin_connections.metrics_version` to null) when an app endurance session is saved, so the next worker run rebuilds it.
- **Touchpoints:** `src/lib/step-results.ts`, `src/lib/session-answers.ts` (`confirmDone`), `src/lib/garmin/metrics-job.ts`.

### Run logger: RPE starts at 6
- **What:** The run logger offers RPE 6 to 10 only (`RPE_OPTIONS` in `src/components/features/LogRunModal.tsx`), so an easy run logs at least 6 and its session-RPE load reads high. The guided player's results screen offers 1 to 10.
- **Why deferred:** Decision 11 in `docs/plans/endurance-app.md`: the logger is part of the set logging flow, a critical flow. Runs with a threshold pace use pace load instead.
- **Unblocked by:** An owner yes, with the logging e2e specs.
- **Touchpoints:** `src/components/features/LogRunModal.tsx`.

### Garmin laps as step results
- **What:** A structured session done outdoors with a watch gets step results only by hand or from the assistant. The Garmin file's laps could fill them.
- **Why deferred:** Out of scope of the C6/D1 PR (`docs/plans/endurance-app.md`, section 0); laps rarely match steps one to one.
- **Unblocked by:** An owner request. Map laps to play steps by order and duration, and write them with `saveStepResults` as source `assistant` or a new `garmin`.
- **Touchpoints:** `src/lib/step-results.ts`, `src/lib/garmin/fit.ts`, `src/lib/utils/step-results.ts`.

### Pounds for weights
- **What:** Show and take weights in lb for users who want it: every weight label and input (set logging, set edit, program edit, history, session detail, metrics, records, friends' feeds), progression steps in lb (5 lb, 2.5 lb) instead of converted kg steps, and plates and bars in lb (45 lb bar, 45/35/25/10/5/2.5 lb plates) in the plate calculator and the weight presets. Storage stays kg.
- **Why deferred:** The owner chose endurance units only for the foundations PR (A2 in `docs/plans/triathlon-coach-plan.md`, brief `docs/plans/foundations.md`). The owner trains in kg, and lb done well needs lb-native steps and plates, not only a converted label. So there is no `weight_unit` column yet.
- **Unblocked by:** A user who asks for lb. Then add `user.weight_unit` (`kg` | `lb`) next to `distanceUnit` in `src/db/schema/users.ts`, add it to `Units` in `src/lib/utils/units.ts`, `setDisplayUnits` and the MCP `update_profile`, convert at the edge like distance (`fieldToMeters` keeps a value saved back unchanged, so do the same for weight against the `decimal(6,2)` column), and give the progression engine and `src/lib/utils/plates.ts` lb step and plate sets.
- **Touchpoints:** `src/lib/utils/units.ts`, `src/lib/utils/format.ts` (`loggedSetLabel`, `formatVolume`), `src/lib/utils/plates.ts`, `src/lib/utils/picker-options.ts`, `src/components/features/SetEditView.tsx`, `src/components/features/WorkoutSetsList.tsx` (`prBadgeLabel`), `src/components/features/PrFeedList.tsx` (`formatPrValue`).

### Time zone and units: places still on the server zone or metric
- **What:** The user's time zone and endurance units (`src/lib/utils/user-date.ts`, `src/lib/utils/units.ts`) cover the weekly sync, the cycle views, cycle start dates, the home page, the workout session date, and the endurance screens. These still use the server's zone or metric:
  - "this week" sums in metrics (`src/lib/actions/metrics.ts:178`, `:210`), friends (`src/lib/actions/friends.ts:642`, `:753`), the AI generation day limit (`src/lib/actions/ai-generate.ts:74`) and the admin demo data (`lastMonday`, `src/lib/actions/admin.ts:35`);
  - the training streak (`computeStreakWeeks`, `src/lib/utils/training-streak.ts`), which counts UTC weeks because its week starts come from Postgres `date_trunc('week', startTime)` on UTC timestamps (`src/lib/actions/metrics.ts:1407`, `src/lib/mcp/tools/workouts.ts:358`); per-user weeks need those queries cut in the user's zone too;
  - the Garmin pages, which take today from the Garmin profile's zone (`garminToday`, `src/lib/garmin/today.ts:11`) and show metric;
  - friends' set labels, built on the server in metric (`src/lib/actions/friends.ts:1163`);
  - progression step labels for distance ("+0.5km", `src/components/features/WorkoutSetsClient.tsx:1439`, and the rule text at `src/lib/utils/progression.ts:1101`);
  - distance presets stay metric distances shown converted (3.1mi, not 3 mi).
- **Why deferred:** The foundations brief (`docs/plans/foundations.md`) scoped A2 to the weekly sync, the cycle views and the logging date. The rest affects display only, and every user today is in one zone and metric.
- **Unblocked by:** A user in another zone or on miles who reports one of these, or the C6 endurance views, which should reuse `todayIn` and `useUnits`. For Garmin, decide whether the user's zone or Garmin's wins (the user's zone should, with Garmin's as the fallback).
- **Touchpoints:** listed above.

### Empty sessions closed by the stale sweep still show as workouts
- **What:** A workout screen opened and left becomes a session with no sets. The stale sweeps (`closeStaleSessions` in `src/lib/actions/workout-sessions.ts`) close it as `isCompleted` with no duration. It then shows in history and counts in the home page's "done today" and week strip (`getCompletedSessions`, `src/lib/actions/workout-sets.ts:1435`) until `scripts/cleanup-ghost-sessions.ts` removes it after 7 days. The weekly sync already ignores it.
- **Why deferred:** The sweeps must not delete it, since its sets may still be in the phone's offline queue. Hiding it means changing history and the home page, which are near critical flows, and main has the same behaviour today. Kept out of the foundations PR to keep it off more critical-flow code.
- **Unblocked by:** A rule for reading sessions with no sets: leave them out of history, `getCompletedSessions` and the home strip (keep `source = 'auto'` days), or mark them "empty". Tests: a component or e2e check that a closed empty session does not show as done, and that a session whose queued sets land later does.
- **Touchpoints:** `src/lib/actions/workout-sets.ts` (`getCompletedSessions`), `src/app/page.tsx`, `src/app/history/`, `src/lib/actions/workout-sessions.ts`.

### Run the ghost-session cleanup in prod
- **What:** Remove old empty "completed" sessions in prod with `scripts/cleanup-ghost-sessions.ts` (decision D23): completed sessions with no sets, notes or feeling, older than 7 days. The app no longer gives them a false duration (`closeStaleSessions` in `src/lib/actions/workout-sessions.ts`) and the weekly sync ignores them, but it does not delete them.
- **Why deferred:** Deleting prod data needs the owner. Agents never run it against prod.
- **Unblocked by:** The owner, after the foundations PR deploys, runs the dry run in the prod pod (`kubectl exec -n <namespace> deploy/<app> -- node /app/scripts/cleanup-ghost-sessions.js`), reads the list, then runs it again with `--delete`. Then delete this entry.
- **Touchpoints:** `scripts/cleanup-ghost-sessions.ts`, `src/lib/ghost-sessions.ts`.

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

### Retire the triathlon plan generator after C4
- **What:** Remove the fixed triathlon plan generator (the "Triathlon plan" page and its action) once the assistant builds endurance plans from structured workouts and seasons.
- **Why deferred:** It is still the only way to make an endurance plan in the app. Package C3 changed it lightly (the intake interview first, prefill from the profile, strength by goal) and decided with the owner on 2026-11-12 to retire it later (`docs/plans/athlete-profile.md`, 2.7 and 12). It plans a full distance from fixed volumes and ignores hours per week, the longest day, the race distance and thresholds.
- **Unblocked by:** Package C4 (structured endurance workouts) is built, with C1's seasons, so the assistant can build a plan from parts (`docs/plans/workouts-and-compliance.md`). It still needs the owner's yes. Then delete the page, form, action and blueprint with their tests, and drop the cycles-list entry.
- **Touchpoints:** `src/lib/utils/triathlon-plan.ts`, `src/lib/actions/triathlon-plan.ts`, `src/components/features/TriathlonPlanForm.tsx`, `src/app/cycles/triathlon/page.tsx`, `src/components/features/CyclesListClient.tsx` (the "Triathlon plan" entry), `src/__tests__/triathlon-plan.test.ts`.

### Readiness without Garmin
- **What:** The readiness flag (HRV below the band two days and resting HR up) and the rule `hard_after_low_readiness` read Garmin daily rows only. A user with no Garmin data gets "not checked", and no readiness swap is suggested.
- **Why deferred:** Hub decision 6 in `docs/plans/limits-strength-readiness.md`: the app has no other morning HRV or resting HR source, and the 1-5 readiness at the start of a workout comes too late for a morning decision. Garmin stays admin-only for licence reasons.
- **Unblocked by:** A morning entry of resting HR (and HRV if the user has it) in the app, or another wearable source. Then feed it to `readinessFlag` with the same two-signal rule.
- **Touchpoints:** `src/lib/utils/training-limits.ts` (`readinessFlag`), `src/lib/training-limits.ts` (`limitContext`).

### Discipline on the custom-exercise form inside a program
- **What:** The custom-exercise form on `/exercises` shows the discipline field (swim, bike or run) when the endurance switch is on. The same form opened from a program's "Add exercise" picker does not, because the picker does not pass the switch.
- **Why deferred:** The owner's decision 5 in `docs/plans/ai-coach.md` named the custom-exercise form; the picker is a second entry point that needs the switch read on the program page, and the assistant can set the discipline with `create_exercise` meanwhile.
- **Unblocked by:** Reading `enduranceEnabledFor` on the program page and passing `enduranceEnabled` through `ProgramAddExerciseWrapper` to `ExercisesClient`.
- **Touchpoints:** `src/components/features/ProgramAddExerciseWrapper.tsx`, `src/components/features/ExercisesClient.tsx`, `src/app/programs/[id]/page.tsx`.

### Sport-specific endurance fields (pool length, bike power/cadence, swim stroke)
- **What:** The set editor captures distance/duration/incline/HR-zone only. Triathletes often want pool length, swim stroke, or bike power/cadence. Planned structured workouts now hold a pool length, a stroke per step and cadence targets (`poolLengthM`, `stroke`, `cadence` in `src/lib/utils/workout-steps.ts`), but logged sets have no columns for them.
- **Why deferred:** Not needed to log and track the three disciplines; add when a concrete need appears.
- **Unblocked by:** A request for one of these specific metrics.
- **Touchpoints:** `src/db/schema/workout-sets.ts`, `src/components/features/SetEditView.tsx`, `src/components/features/LogRunModal.tsx`.

### Two workouts in one day — rotation walker edge case
- **What:** `walkRotation` in `src/lib/utils/cycle-position.ts` consumes at most one completed session per calendar day. If a user logs two workouts on the same date, the second one doesn't advance the rotation cursor.
- **Why deferred:** Vanishingly rare in practice; the previous modulo-counter version had the inverse limitation (double-counted, arguably more wrong).
- **Unblocked by:** Concrete report of a power user hitting it.
- **Touchpoints:** `src/lib/utils/cycle-position.ts` (`walkRotation`), tests in `src/__tests__/cycle-position.test.ts`.

### Wearable plan suggestion: decide whether it applies itself
- **What:** Garmin recovery and load signals now feed `computeAdaptationFactor` (HRV state, resting HR flag, sleep debt, ACWR, ramp; plan 2.14), but only as a suggestion with an Apply button on the Garmin Training tab. The weekly sync never uses them. Decide whether the sync should apply them on its own.
- **Why deferred:** Decision O-3 in `docs/plans/garmin-insights-design.md`: suggest first for four weeks, then decide with real weeks of data. Built 2026-11-11.
- **Unblocked by:** Four weeks of the owner using the suggestion (from 2026-11-11). If it should apply itself, pass `wearableSignals` into the signals `syncPeriodizedTargets` reads, and update the integration test that asserts the sync ignores them.
- **Touchpoints:** `src/lib/utils/periodization.ts` (`computeAdaptationFactor`, `WearableSignals`), `src/lib/periodization-sync.ts` (`wearableSuggestion`, `applyWearableSuggestion`), `src/__tests__/integration/wearable-suggestion.test.ts`.

### Garmin review: items outside the seven build steps
- **What:** Parts of the Garmin section review that the build order did not include: Day tiles with the difference from your 28-day normal, the lowest sleeping HR marked on the 30 h chart, insights that scroll to the chart that proves them; the four Training tiles as small 6-week charts, sport chips on intensity distribution; deep and REM sleep in minutes against the 28-day median, Garmin's sleep sub-scores as the reason for a low score; an hours and load totals column on the Activities calendar, a cell value switch, one quality value per list row; the activity map coloured by pace, power or altitude, run dynamics stream charts, LogEveryLift sets under the strength heart-rate line, this session against the last similar one, efficiency drift over the session; overlays 8 (session end on the sleep timing chart), 11 (readiness against session quality) and 13 (this season against last, from 2027). Correlation pairs 7 (session end against bedtime) and 10 (steps against HRV) were also left out.
- **Why deferred:** Not in the build order the owner asked for (steps 1 to 7 of the review); the build order was the agreed scope.
- **Unblocked by:** The owner picking which to build. Pair 7 needs local session end times compared with the local sleep start; pair 10 needs steps in the daily series.
- **Touchpoints:** `src/components/features/GarminTodayTab.tsx`, `src/components/features/GarminLoadTab.tsx`, `src/components/features/GarminSleepTab.tsx`, `src/components/features/GarminActivitiesTab.tsx`, `src/components/features/GarminActivityView.tsx`, `src/lib/garmin/analytics/correlations.ts` (`PAIRS`).

### Garmin: plan-aware strength_before_key insight
- **What:** The `strength_before_key` insight fires on any heavy strength load the day before. Plan 4.1 wants it only for a heavy leg session before a planned quality run or ride.
- **Why deferred:** It needs which lifts were legs (muscle groups of the matched LogEveryLift session) and which of today's planned sessions is the key one (the cycle's slot for today).
- **Unblocked by:** Reading today's planned session from the active cycle, and the muscle groups of yesterday's sets.
- **Touchpoints:** `src/lib/garmin/analytics/session-insights.ts`, `getSessionInsights` in `src/lib/garmin/queries.ts`.

### iOS backgrounding — residual gaps after the resume-hardening pass
- **What:** A Jun 2026 pass made the rest/exercise timers and completed-set toggles re-sync on resume (visibilitychange + pageshow + focus; rest timers rebuild from `restTimerEnds`, completed sets re-pull from the server). Two gaps remain: (1) the **exercise (timed-set) countdown** isn't persisted, so a *cold* eviction mid-timed-set loses it entirely (only warm resume recovers it); (2) **unsaved SetEditView edits** (typed but not Saved) live only in React state and are lost on eviction — only Saved overrides persist to localStorage.
- **Why deferred:** (1) timed sets are short and rarely span a long background; persisting `endsAt` to the context/localStorage is extra surface for an edge case. (2) auto-persisting drafts on each keystroke is a bigger change; the explicit Save is the documented contract.
- **Note:** The guided player (package C6) does not have gap (1): it saves its run under `guidedWorkout` on every event and resumes it after a cold eviction (`src/components/features/guided/useGuidedPlayer.ts`).
- **Unblocked by:** A real iOS device repro showing either gap bites in practice. Then: persist the exercise timer's `endsAt` alongside `restTimerEnds` and rehydrate on mount; and/or debounce-persist SetEditView field state to a draft key cleared on Save/navigation.
- **Touchpoints:** `src/components/features/WorkoutSetsList.tsx` (exercise timer state + resync effects), `src/contexts/workout-session-context.tsx` (persistence keys), `src/components/features/SetEditView.tsx` (draft state).

### Count failed sets correctly in PR and volume math
- **What:** Failed sets (`workout_sets.is_failed`) now show a "Failed" badge in session detail, but PR detection and volume totals still treat them like any other logged set. Decide whether a failed set can set a PR and whether it counts toward volume, then apply that in the metrics and PR code.
- **Why deferred:** Display was the planned scope of the show-hidden-data brief; changing what counts as a PR or as volume is a training-logic decision nobody has made yet.
- **Unblocked by:** A decision on the rule (e.g. failed sets never set a PR but still count as volume).
- **Touchpoints:** `src/lib/actions/workout-sets.ts` (PR detection in `logWorkoutSet`, history volume in `getCompletedSessions`), `src/components/features/SessionDetailClient.tsx` (session volume), `src/lib/utils/progression.ts` (optional: treat `isFailed` as a hard fail).

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


## Codebase hygiene (deferred long-term)

### September dates can break hydration on WebKit
- **What:** Node's ICU formats an en-GB short month for September as "Sept", WebKit as "Sep". A client component that formats a date with `toLocaleDateString("en-GB", { month: "short" })` renders different text on the server and in WebKit, which is React error #418 on every WebKit load that shows a September date. Progress's week labels were fixed on `fix/back-navigation` (they now use `dayMonth`). The shared `formatDateShort` in `src/lib/utils/format.ts` and the inline calls in `ProgramDetailClient` and `WorkoutSessionClient` (the last session's date) still use the locale formatter.
- **Why deferred:** Found while building back navigation; out of its scope, and the workout screen is a critical flow that wants its own test.
- **Unblocked by:** Nothing. Make `formatDateShort` use fixed month names like `dayMonth` (a unit test with "2026-09-21" fails today), switch the two inline calls to it, and check the other `toLocaleDateString` calls in client components the same way.
- **Touchpoints:** `src/lib/utils/format.ts` (`formatDateShort`), `src/lib/home/labels.ts` (`dayMonth`), `src/components/features/ProgramDetailClient.tsx`, `src/components/features/WorkoutSessionClient.tsx`.

### Deploy during the day without disturbing an active workout
- **What:** Find a way to ship to prod during the day without any effect on users who are in the middle of a workout. Today the rule is "do not merge while someone trains": before each merge the operator checks prod for open workout sessions with a set in the last 30 minutes and waits. On 2026-11-13 a merge waited more than an hour for another user to finish. Every deploy changes all Server Action IDs (`CLAUDE.md`, "Server Action stability across deploys"), so an open app must reload once; the client keeps queued sets through that reload (`src/lib/utils/stale-bundle.ts`), but a reload mid-set, a lost rest timer, or a slow pod switch still disturbs the lifter.
- **Why deferred:** The owner asked to look at this later (2026-11-13). The current wait rule is safe, just slow.
- **Unblocked by:** Pick an approach and test it. Options to look at: keep the old pod serving old action IDs until its clients reload (version skew support, e.g. Next.js `deploymentId` / skew protection, or two ReplicaSets during a drain window); a stable action-ID salt without putting the key in the public image (build the key into a private image, or inject the salt at build from a CI secret into a private registry); delay the client reload until the workout screen is idle (no timer running, no open set edit); and show a "new version ready" banner on the workout screen instead of a forced reload. Measure with the e2e stale-bundle spec plus a deploy during a running e2e workout.
- **Touchpoints:** `src/lib/utils/stale-bundle.ts`, `src/contexts/pending-queue-context.tsx`, `next.config.ts`, `Dockerfile`, `.github/workflows/ci.yml`, the ArgoCD/Kargo rollout config, and the open-workout check the hub runs before merging (`deploys-break-open-workouts` memory).

### Two open tabs overwrite each other's offline queue
- **What:** Each tab keeps its own copy of the offline queue in React state and writes the whole queue to localStorage `pendingMutationQueue` on every change. With two tabs or PWA windows open, the last tab to write wins, so a set queued in one tab can be erased by the other tab's write. Each tab also replays its own copy, so a set can be sent twice.
- **Why deferred:** It was there before the stale-bundle fix and is out of its scope. Logging a workout in two tabs at once is rare.
- **Unblocked by:** A report of a set lost or doubled with two tabs open, or a wish to make the queue safe across tabs. Then merge with the stored queue by item id on each write and listen for the `storage` event (or use a `BroadcastChannel`), and let only one tab replay at a time (for example with `navigator.locks`).
- **Touchpoints:** `src/contexts/pending-queue-context.tsx` (the hydrate and persist effects, `replayAll`), `src/lib/utils/pending-queue.ts` (`mergeReplayed`).

### Writes outside the offline queue are not kept across a deploy
- **What:** After a deploy, only set log and un-log writes (`useWorkoutSetWriter`) are queued and sent again from the new bundle. Every other client write goes through `callAction()`, which detects the stale bundle, returns a failed result ("App updating") and reloads. The caller reverts its change, so nothing is lost silently, but the user has to make that change again after the reload (for example a rest-time edit or a program edit).
- **Why deferred:** The 2026-11-12 incident was about logged sets. Queueing other writes means giving each one a queue kind and a replay path, which is a larger change than the fix needed.
- **Unblocked by:** A report of a non-set write lost to a deploy, or a decision to queue more workout writes. Then add the write as a `QueuedMutation` kind and enqueue it on a stale-bundle failure, as `logWithRetry` does.
- **Touchpoints:** `src/lib/utils/stale-bundle.ts` (`callAction`), `src/contexts/pending-queue-context.tsx` (`QueuedMutation`, `useWorkoutSetWriter`).

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

### WebKit e2e specs that fail now and then on CI
- **What:** Three WebKit specs each failed once on CI on 2026-11-01 (runs on PRs #179 and #180) and passed on a re-run. (1) `e2e/exercise-timer-delay.spec.ts:44`: after Save in the timed set editor the screen stayed on Edit Set; the trace shows no request and `router.back()` did not navigate, so `+3s` never appeared on the list. (2) `e2e/warmups.spec.ts:31`: 4 set rows instead of 8 after "Generate warm-ups". (3) `e2e/drag-reorder.spec.ts:122` ("un-logging a moved set removes its own log"). All three passed in two full local runs. The setup-notes flake from the same days had a real cause (a controlled textarea reset by a re-render, fixed in #181), so these may hide user-facing bugs too.
- **Why deferred:** Found while shipping #179 and #180; re-running got them through, and the cause was not looked for.
- **Unblocked by:** The failing runs' `playwright-report-shard-1` artifacts have traces. For (1), check whether the Save handler ran at all (a tap before hydration, or a re-render swallowing it); for (2), whether the list re-rendered from a stale `sets` prop after the insert.
- **Touchpoints:** `e2e/exercise-timer-delay.spec.ts`, `e2e/warmups.spec.ts`, `e2e/drag-reorder.spec.ts`, `src/components/features/SetEditView.tsx`, `src/components/features/WorkoutSetsList.tsx`.

### `e2e/session-edit.spec.ts` fails on a developer Mac, also on main
- **What:** "a set's weight edited in history is saved and becomes the record" fails locally on WebKit and Chromium, also on a clean `main` (checked 2026-11-01), and passes in CI. The current weight record comes back as 82.49 kg, from the Bench Press history the e2e reset seeds, instead of the 72.5 kg the spec writes.
- **Why deferred:** Not caused by the work it was found during; CI is green, so it does not block merges, but it makes every local `make e2e` report two failures.
- **Unblocked by:** Compare the seeded set dates and `rebuildPRsFrom`'s window under the Mac's UTC+1 against CI's UTC; if a timezone moves which seeded sets the rebuild sees, either the spec should pick an exercise with no seeded history or the rebuild has a real timezone bug.
- **Touchpoints:** `e2e/session-edit.spec.ts`, `e2e/fixtures/reset.ts` (`seedDemoData`), `src/lib/actions/workout-sets.ts` (`rebuildPRsFrom`).

### Check prod for timed sets that carry a planned weight
- **What:** Since #180 a timed set whose planned working sets carry a weight is a weighted hold and progresses its weight at a fixed time instead of its time (SI-29a in `docs/specs/smart-incrementation.md`). Before, the weight was ignored. Any existing timed set with an incidental weight (an import, an AI or MCP-built plan) switched silently. Dev data has none.
- **Why deferred:** Answering it means querying the production database, which was out of scope for that change.
- **Unblocked by:** A read-only count of `program_sets` joined to timed exercises with `weight_kg > 0`. If any look incidental, clear their weight; if they are real weighted holds, nothing to do.
- **Touchpoints:** `src/lib/utils/progression.ts` (`weightedHold`), `src/components/features/WorkoutSetsClient.tsx` (`weightedHold`).

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
- **Planned:** see [`docs/plans/web-push-and-reminders.md`](docs/plans/web-push-and-reminders.md).
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

### MCP tool coverage is partial (no logging, exercises or social)
- **What:** The MCP server exposes ~18 tools across programs, training cycles, profile/weight, and read-only workout history and metrics. Logging a workout, the exercise library, and social are NOT exposed.
- **Why deferred:** v1 scope was deliberately limited to two domains. The Server Actions for the other domains exist and follow the same `requireSession()` pattern.
- **Unblocked by:** A decision to widen the MCP surface. Mirror the existing pattern: add a `src/lib/mcp/tools/<domain>.ts` with a `register<Domain>Tools(server, userId)` and call it from the endpoint on the scoped `server`. Mark read tools `readOnlyHint: true`; any other tool needs read and change access (`src/lib/mcp/scopes.ts`). Reuse the action logic but scope by the MCP `userId` (never reuse the cookie-session actions directly).
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

### Minor: weight float comparison logs redundant history entries
- **What:** MCP `update_profile` / `manage_weight` and their Server-Action originals compare a JS double against a Postgres `real` weight with `!==`, so re-sending the same weight can log a duplicate `user_weight_entry`.
- **Why deferred:** Low-harm data-quality issue, not data loss or a leak.
- **Unblocked by:** Caring about history cleanliness (round/compare at 0.01).
- **Touchpoints:** `src/lib/mcp/tools/profile.ts`, `src/lib/actions/profile.ts`.

### MCP OAuth dynamic client registration is open
- **What:** The `mcp()` plugin in `src/lib/auth.ts` runs with `allowDynamicClientRegistration` and `allowUnauthenticatedClientRegistration`, so any client can self-register an OAuth client (RFC 7591). Access still requires the user to log in and consent, so this isn't a data-exposure hole, but it allows unbounded `oauth_client` rows. MCP 2026-07-28 deprecates this in favour of Client ID Metadata Documents (`@better-auth/cimd`), which the app does not offer yet; a client that only speaks CIMD cannot connect.
- **Why deferred:** Registration is what today's MCP clients use, and the gate that matters (user login + consent) is in place. CIMD makes the server fetch client-supplied URLs, which needs its own SSRF-safe transport and review.
- **Unblocked by:** A need to restrict registration, or a client that needs CIMD. Then add `cimd()` with `metadataProfile: "mcp-2026-07-28"` and turn off unauthenticated registration, or prune stale `oauth_client` rows on a schedule.
- **Touchpoints:** `src/lib/auth.ts`, `src/db/schema/auth.ts` (`oauthClients`).

### Run an independent security-review pass over the MCP + auth changes
- **What:** A security audit (Jun 2026) fixed the critical/high auth + MCP data-integrity findings (cross-user `getProgressiveSuggestions`/`upsertCycleSlot` leaks, `ai-model-configs` admin gating, login open-redirect, placeholder-secret boot guard, non-atomic MCP writes, validation gaps, rate-limit eviction). A fresh, independent pass was offered but deferred for time.
- **Why deferred:** No time right now; the verified high-severity items are already fixed and `pnpm verify` is green.
- **Unblocked by:** Running `/security-review` (or `/code-review high`) over the current branch diff before/after merge, and optionally addressing the lower-severity residuals captured in the entries above (cookieCache revocation lag, weight float dedup, reaction privacy flag).
- **Touchpoints:** whole MCP + auth surface — `src/lib/mcp/`, `src/app/api/[transport]/`, `src/lib/actions/`, `src/lib/auth.ts`, `src/middleware.ts`, `src/lib/env.ts`.


### `eslint-config-next` held at 16.1.6 while `next` moves on
- **What:** `eslint-config-next` 16.4.x pulls `eslint-plugin-react-hooks` 7.1.1, whose stricter rules report 18 errors in existing code (checked with 16.4.3): `react-hooks/set-state-in-effect` (14), `react-hooks/immutability` (2) and `react-hooks/purity` (2). `.github/dependabot.yml` ignores `eslint-config-next`, so the weekly npm group does not fail lint on it.
- **Why deferred:** `next` was bumped to 16.4.2 to fix a router action-queue race that dropped taps and pulled users back a screen (`e2e/session-start-race.spec.ts`). Rewriting effects across the app to satisfy new lint rules is separate work and would have buried that fix. Most findings are in the workout screens, which are critical flows.
- **Unblocked by:** Bumping `eslint-config-next` to match `next`, running `pnpm lint`, and fixing or deliberately suppressing each finding with a reason. Then remove the `eslint-config-next` ignore from `.github/dependabot.yml`.
- **Touchpoints:** `package.json`, `eslint.config.mjs`, `.github/dependabot.yml`, the files `pnpm lint` reports after the bump.

### Two Dependabot alerts with no fix inside current ranges
- **What:** minimatch 9.0.9 and 10.2.4 are in the GHSA-g3hv-75wg-m249 range (fixed in minimatch 11.0.1). They come in through `glob` (from `@serwist/build` and `@sentry/bundler-plugins`), `@ts-morph/common` (from `shadcn`) and `@typescript-eslint/typescript-estree`. deepmerge 4.3.1 (from `shadcn`) has a low advisory with no patched release. All of these run at build or lint time only, not in the server.
- **Why deferred:** Each fix is a major bump of a transitive package that its dependents do not allow. A pnpm override to minimatch 11 could break them, and dependency review rejects minimatch 10.2.6 as still vulnerable.
- **Unblocked by:** Releases of `glob`, `@ts-morph/common` or `@typescript-eslint/typescript-estree` that accept minimatch 11, or a `shadcn` release without deepmerge. Then run `pnpm update --depth Infinity minimatch deepmerge`.
- **Touchpoints:** `pnpm-lock.yaml`, `pnpm-workspace.yaml` (`overrides`), `package.json` (`shadcn`, `@serwist/next`, `@sentry/nextjs`).

### `@types/node` held at the Node 24 major
- **What:** `.github/dependabot.yml` ignores `@types/node` 25 and later. Dependabot PR #174 (24 to 26) was closed.
- **Why deferred:** The app runs on Node 24 (`Dockerfile`, CI `node-version: 24`). Types for a newer major allow APIs that the runtime does not have.
- **Unblocked by:** Moving the runtime to a newer Node LTS major. Then bump `@types/node` to that major and widen or remove both Node ignores in `.github/dependabot.yml`.
- **Touchpoints:** `package.json`, `Dockerfile`, `.github/workflows/ci.yml`, `.github/dependabot.yml`.
