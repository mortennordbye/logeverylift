# Home screen widgets: audit, catalogue and build brief

<!-- doc-claims: skip — a point-in-time audit; its file:line refs describe the code as measured on 2026-11-13 (main at 0c8e29d), and the build rewrites most of src/app/page.tsx. -->

Status: phase 1 built (section 6, one PR, branch `feat/home-widgets`). Section 12 lists
where the build differs from this brief and why. The open questions in section 9 were
decided by the hub on 2026-11-13; the owner may change any of them. Two review passes
attacked the first draft; section 6 and 7 fold in their findings.

The request: let each user decide what the home screen (the "Workout" tab, `/`) shows, in
which order, and how big each part is. The whole screen is in scope: the "LogEveryLift"
title row, the cycle and today card, the week strip, the notices, and everything later plans
put there. All of it becomes parts of one modular widget system. Adding a widget later must
be one small, isolated change.

Contents:

1. Summary
2. Audit: the home screen today
3. Design: one registry, four kinds
4. Widget catalogue
5. Risks
6. Build brief (one PR)
7. Test plan
8. Privacy and MCP
9. Decisions
10. Sources
11. Changes after review
12. Build notes

## 1. Summary

- Today the home screen is one Server Component (`src/app/page.tsx`, 510 lines). It reads
  all data up front and renders a fixed list of cards in a fixed viewport that does not
  scroll. Only the `missedWorkoutsEnabled` setting changes what it shows.
- Build **one widget registry** that holds every part of the screen. Each entry has a
  **kind**: `header` (the title row), `widget` (what the user arranges), `notice` (cards that
  ask the user to act; they render in fixed slots when they have something, and the layout
  cannot hide them) and `pinned` (the no-cycle "Start a Workout" bar).
- **Today** (with its cycle and no-cycle variants) and **Endurance today** hold the start
  buttons. The user can move and resize them, but cannot hide them. Each has an error state
  that still links to `/new-workout`.
- **Reads only below the page.** `getActiveCycleForUser` writes (scheduled cycle start, block
  end, auto sessions, planned-session rows). The page runs every write before any `Suspense`
  boundary. Widget loaders only read.
- Store the layout in `user.home_layout jsonb`. `null` means "the default", computed in code
  per user type, so existing users see exactly today's home until they change it. It is read
  in the `getUserSettings` select the page already runs, so the default adds no query.
- Sizes: S (half width), M (full width), L (full width, taller). Outside edit mode two S
  widgets share a row. In edit mode every widget is a full-width row.
- Edit mode starts from an "Edit" button. Reorder with @dnd-kit (vertical list) plus "Move
  up" and "Move down" buttons (WCAG 2.5.7). Size from a per-row menu. Hide, add from a gallery,
  Undo, Reset, Cancel. The edit bar covers the bottom nav until Done or Cancel.
- Today's widgets render from page data with no skeleton. Only new widgets stream, each in
  its own `Suspense` and error boundary, and a hidden one runs no query.
- Adding a widget: one def file, one folder with `load.ts` and `View.tsx`, two one-line index
  edits, tests. Section 6.6 is the recipe.
- First commit of the PR: an e2e spec that pins today's home order per user type, run against
  the current code. It must pass unchanged after the rewrite.
- New widgets in this PR: **Recent PRs**, **Friends' activity** and **Garmin readiness**
  (admins only). All hidden by default.
- The AI coach reads the stored layout through `get_profile`. No write tool.

## 2. Audit: the home screen today

All references are `src/app/page.tsx` unless the row names another file. "Critical" means
the part is an entry point to a critical flow in `CLAUDE.md` (logging a set, timers,
finishing a workout) and must never disappear by mistake.

### 2.1 Page-level behaviour

| What | Where | Note for widgets |
|---|---|---|
| Terms gate: redirect to `/consent` | `:95` | Stays before anything renders. |
| `closeStaleOpenSessions()` sweep (writes) | `:98` | Page level, before any `Suspense`. |
| Today in the user's zone (`userToday`, which calls `getUserSettings`) | `:101`; `src/lib/user-settings.ts:33-35` | The settings select is where `home_layout` is read (6.3). |
| `getActiveCycleForUser()` (**writes**, see 2.4) | `:111`; `src/lib/actions/training-cycles.ts:146` | Page level, before any `Suspense`. Its result feeds `getWorkoutInsight` (`src/lib/actions/workout-sets.ts:1581`, `prefetchedCycleResult`). |
| One `Promise.all`: stats, sessions, insight, check-in, policy, endurance | `:116-123` | Stays one `Promise.all` in the page (6.4). |
| Fixed viewport: `h-[100dvh] ... overflow-hidden`; content `flex-1 ... overflow-hidden` | `:197`, `:205` | **The home does not scroll; content past the screen is clipped.** The week card uses `flex-1` (`:332`, `:382`, `:447`) to fill what is left. Larger and added widgets need a scroll area (R2). |
| Title row "LogEveryLift" (`h1`) | `:200-202` | Becomes the `header` widget. `e2e/auth.setup.ts:35` and `e2e/consent.spec.ts:55` expect this heading to be visible. |
| No `data-testid` on the today card or the week strip | whole file | The first commit adds them (6.2). |
| Bare skeleton | `src/app/loading.tsx` | Title only. Finding B2 in `docs/ui-polish-audit.md`. |
| Bottom nav "Workout" tab: the open workout if any, else `/` | `src/components/ui/bottom-nav.tsx:115-117` | "Continue workout" stays reachable from the nav. "Start" lives only on home. |

### 2.2 Parts of the screen, in render order

| # | Part | Component and place | Data | Who sees it | How it goes away today | Critical |
|---|---|---|---|---|---|---|
| H1 | Title "LogEveryLift" | Inline `:200-202` | none | everyone | never | no |
| N1 | Policy update notice | `PolicyUpdateNotice` (`src/components/features/PolicyUpdateNotice.tsx:10`), `:207` | `needsPolicyNotice(session)` | users behind on the policy version | Dismiss writes `markPolicySeen` | no, but a legal notice |
| N2 | AI check-in | `AiCheckinCard` (`src/components/features/AiCheckinCard.tsx:14`), `:209` | `getPendingCheckin()` | users with a pending check-in | answer "fits" or "dismissed" | no |
| N3 | Sick or returning banner | `IllnessBanner` (`src/components/features/DidYouDoIt.tsx:120`), `:211` | `enduranceHome` | endurance switch on | "I'm better" | no |
| W1 | Cycle header (name, week x/y, bar, end date) | Inline `:215-224`, inside the today card | cycle info | users with an active cycle | never | no |
| W2 | **Today** (program, done chip, overdue chip, insight, sessions list, Start, Do Again or Log in app, Different Program, Skip auto day) | Inline `:226-290`; `WorkoutInsightBanner` (`:244`), `TodaySessionsList` (`:247`), `SkipAutoDayButton` (`:274`) | today slot and sessions, completed dates, auto session, insight | users with an active cycle | never | **yes**: "Start Today's Workout" (`:271`), per-session starts, Different Program |
| W3 | Endurance today | `EnduranceTodayCard` (`src/components/features/guided/EnduranceTodayCard.tsx:21`), `:294` | `sessionCompliance` for today, units | endurance switch on, with a structured session today | null with no rows (`:22`) | **yes** for endurance: the guided player starts here |
| N4 | Did you do these? and missed key sessions | `DidYouDoItCard` (`src/components/features/DidYouDoIt.tsx:23`), `:297` | unconfirmed and missed key sessions | endurance switch on | null when nothing is open (`:29`) | no, but it answers planned vs done |
| N5 | Missed this week, Make up, Decline | Inline `:299-328`, `DeclineMakeupButton` (`:321`) | `info.missedSlots` | day-of-week cycles with a missed day | setting `missedWorkoutsEnabled` (`src/db/schema/users.ts:46`, read in `src/lib/actions/training-cycles.ts:211-214`) | "Make up" starts a workout |
| W4a | Week strip and weekly goal ring | Inline `:330-378`, `WeeklyGoalProgress` (`:375`) | week dates, `homeWeekPlanned`, completed dates, `stats.thisWeekWorkouts`, `weeklyGoal` | day-of-week cycles | never | no |
| W4b | Rotation strip and goal ring | Inline `:380-403` | cycle slots, today slot, stats | rotation cycles | never | no |
| W2' | No-cycle preview with "Set up a Cycle" | Inline `:405-440` | none | users with no cycle | a cycle exists | no |
| W4c | No-cycle week strip and goal ring | Inline `:442-487` | completed dates, stats | users with no cycle | a cycle exists | no |
| P1 | Pinned "Start a Workout" bar | Inline `:491-502` | none | users with no cycle | a cycle exists | **yes**: the only start without a cycle |
| N6 | Share prompt | `SharePromptLoader` in `Suspense` (`:504-506`; `src/components/features/SharePromptLoader.tsx:5`) | `isSharePromptDue()`, friend code | due users | answered | no |

Note the order: N4 and N5 render **between** Endurance today and the week strip, not on top.
The default layout must keep that (6.4, T1).

### 2.3 Planned for the home area

| Plan | What it adds | Kind |
|---|---|---|
| D4 readiness swaps (`docs/plans/triathlon-coach-plan.md:326-327`) | "Swap today's hard session for an easy one?" | notice |
| Garmin insights, advice on today's session (`docs/plans/garmin-insights-design.md:274`) | one line on today's session from readiness and phase | part of Today, or a notice |
| Web push and reminders (`docs/plans/web-push-and-reminders.md`) | an "enable reminders" prompt | notice |
| Endurance app, resume a guided run (`docs/plans/endurance-app.md:259`) | "Resume" on the endurance card | part of Endurance today |
| Garmin readiness today (`ReadinessCard`, `src/components/features/GarminTodayTab.tsx:97`) | only on `/more/garmin` now | widget |

### 2.4 Writes inside the home's reads

`getActiveCycleForUser` (`src/lib/actions/training-cycles.ts:146`) is a read by name but
writes:

- `startDueScheduledCycle(userId)` at the start (`:152`).
- Marks a cycle that ended as `completed` (`:188-190`).
- `syncPeriodizedTargets(...)` (`:201`).
- For day-of-week cycles, `weekdayToday` (`src/lib/planned-sessions.ts:504`) calls
  `ensureCycleSessions` (`:513`) and inserts auto sessions (`:561`).
- For rotation cycles, `insertAutoSessions(userId, due)` (`src/lib/actions/training-cycles.ts:281`).

`getCompletedSessions` must run after these, or the week strip misses today's auto session
while the Today card shows "Done · automatic". The page does this today: the cycle read
comes first (`:111`), the `Promise.all` after it (`:116`). Streaming widgets in parallel
would break it. Rule for the build: **every write runs at page level before any `Suspense`
boundary; loaders only read** (6.4, T3).

### 2.5 Settings that touch home

- `missedWorkoutsEnabled` on `user` hides N5 and the rotation "days overdue" chip
  (`src/components/features/SettingsClient.tsx:309`).
- `weeklyGoal` is in **localStorage** through `ThemeProvider`
  (`src/components/ui/theme-provider.tsx:51`, `:72`, `:123`). It does not sync across devices.
- `useUserSettings()` (`src/contexts/user-settings-context.tsx:50`) is a small external store,
  not a context: a context provider in the root layout made the cacheComponents shell render
  each page twice (`docs/plans/foundations.md`, A2, "Client settings"). Edit-mode state must
  live inside the page, not in the root layout.

## 3. Design: one registry, four kinds

| Kind | Members | Placement | Can the user... |
|---|---|---|---|
| `header` | Title | Always first, full width | change size (M title, L title with date and cycle week), hide it. The `h1` stays in the DOM as `sr-only` when hidden. |
| `widget` | Today, Cycle, Endurance today, Week, Weekly goal, and all new widgets | The user's order | move, resize, hide, add. Today and Endurance today: move and resize only. |
| `notice` | N1 to N6, later D4 swaps and the push prompt | A fixed **slot**: `top` (under the header), `afterTraining` (after the later of Today and Endurance today in the user's order), or `end` (share prompt, as now) | nothing through the layout. Each keeps its own dismiss path and setting. |
| `pinned` | P1 | Above the bottom nav | nothing. It shows when the user has no cycle, outside edit mode. |

Slots, with today's page as the proof:

| Slot | Notices | Matches today's page |
|---|---|---|
| `top` | policy, checkin, illness | `:207-211`, above the today card |
| `afterTraining` | didYouDoIt, missed | `:297-328`, after Endurance today and before the week strip |
| `end` | share | `:504-506` |

With the default order (Today, Endurance today, Week) `afterTraining` lands exactly where
N4 and N5 are now. If the user moves Week above Today, the two notices still follow the
training widgets, which is what they are about.

Why notices are not user-placed: a notice exists because the app needs an answer (consent,
compliance, a check-in). If a user hides it once, the app loses that answer for good. Garmin
Connect users report this problem with "My Day": dismissed cards come back and the order
resets, and they read it as a bug (section 10).

## 4. Widget catalogue

Sizes: **S** = half width, about 160x150 px on a 375 px phone. **M** = full width, about S
height. **L** = full width, about twice as tall. A dash means the size is not offered.

Cost is the extra server work for one home load when the widget is visible: **none**, **low**
(one indexed query), **medium** (an aggregate or several queries), **high** (a large read;
only from stored series).

Phase: **1** = this PR (section 6; "built" once merged code has it), **2** = next batch, **3** = later, **no** = do not build.

### 4.1 Training

| Widget | S | M | L | Data source (exists) | Who | Cost | Phase |
|---|---|---|---|---|---|---|---|
| Title (header) | - | "LogEveryLift" (default) | Title, date, cycle week | none | all | none | 1, built |
| Date | Day and date, as an eyebrow line | Same, full width | - | page data (today in the user's zone) | all | none | decision 19, built |
| **Today** (cycle and no-cycle variants) | Name, primary action, "More" menu with every other action (6.3) | Card without the cycle header | Card as now (default) | as now | all | as now | 1, built |
| Cycle progress | Week x/y | Name, week, bar, end date | - | `getActiveCycleForUser` (page data) | all; empty state without a cycle | none | 1, built |
| Endurance today | - | Rows as now (default) | Rows with step summary | `sessionCompliance`, `answerSession` | endurance | as now | 1, built |
| **Week** | - | Strip only | Strip and goal ring (default, as now) | as now; variants for day-of-week, rotation, no cycle | all | as now | 1, built |
| Weekly goal | Ring and count | Ring and label | - | `getWorkoutStats`, `weeklyGoal` | all | none | 1, built |
| Next session | Name and day | Name, day, summary, start link | - | cycle info, planned sessions | cycle | low | 2 |
| Season phase | Phase, week x of y | Plus phase bar | - | `listSeasons` (`src/lib/seasons.ts:83`) | endurance with a season | low | 2 |
| Race countdown | Days to race | Race, date, days, phase | - | `listSeasons`; `training_cycles.race_date` | users with a race | low | 2, built (S) |
| Missed this week, Make up | - | - | - | notice N5 | | | 1 (notice) |
| Did you do these? | - | - | - | notice N4 | | | 1 (notice) |
| Readiness swap | - | - | - | notice, package D4 | endurance | | with D4 |

### 4.2 Personal records

| Widget | S | M | L | Data source | Who | Cost | Phase |
|---|---|---|---|---|---|---|---|
| **Recent PRs** | Newest PR | Last 3 (default) | Last 6 | `getRecentPRs(limit)` (`src/lib/actions/metrics.ts:1160`) | all; empty state without PRs | low | 1, built |
| PR of the week | Best PR this week | Plus the lift's trend line | - | `getRecentPRs`, filtered to the user's week | all | low | 2 |
| Near-PR alert | "1 rep from a PR on Bench" | Up to 3 lifts in today's program close to a PR | - | **new**: today's program targets vs `exercise_prs` | cycle | medium | 3 |

### 4.3 Stats

| Widget | S | M | L | Data source | Who | Cost | Phase |
|---|---|---|---|---|---|---|---|
| Training streak | Weeks in a row | Plus last 8 weeks | - | `getSummaryStats` (`src/lib/actions/metrics.ts:1369`, streak at `:1430`) | all | medium | 2, built |
| Weekly volume | Sets this week | Top muscles vs target | All muscle bars | `getWeeklyMuscleVolume` (`src/lib/actions/metrics.ts:1113`) | all | medium | 2, built (S, as "Weekly sets") |
| Body weight | Latest and change | 30-day line | 90-day line | `getWeightHistory` (`src/lib/actions/profile.ts:65`) | users who log weight | low | 2, built (S, M) |
| Consistency | Weeks goal met, last 8 | Heatmap, 12 weeks | Heatmap, 26 weeks | `getHeatmapData` (`src/lib/actions/metrics.ts:1083`) | all | medium | 2 |
| Compliance | Planned vs done this week | Per sport | - | `sessionCompliance` (`src/lib/session-compliance.ts:217`) | endurance | medium | 2 |
| Summary totals | Workouts, sets | Workouts, sets, reps | - | `getWorkoutStats` | all | none | 3 |

### 4.4 Garmin (admins only today, `garminAllowed`)

Garmin access is on only for admin accounts where the key is set
(`src/lib/garmin/access.ts:15-17`). Each Garmin widget is available only with
`garminAllowed(role)`, its loader checks it again before it reads (6.5), and it shows
"Connect Garmin" when there is no connection.

| Widget | S | M | L | Data source | Cost | Phase |
|---|---|---|---|---|---|---|
| **Readiness** | Score and word | Score with contributor bars (default) | - | `getTodayData(...).metrics`; view `ReadinessCard` (`src/components/features/GarminTodayTab.tsx:97`) | medium (stored daily series) | 1, built |
| HRV | Last night vs baseline | 7-day dots | - | `getTodayData` (`hrvNight`, `metrics`) | medium | 2 |
| Sleep | Hours and score | Stages bar | 7 nights | `getTodayData(...).sleep`; `getSleepData` (`src/lib/garmin/queries.ts:317`) | medium | 2 |
| Body battery | At wake and now | High, low, charged, drained | - | `getTodayData(...).summary.bb*` | medium | 2 |
| Training load and form | Form and band | 6-week fitness, fatigue, form | Per sport | `getLoadSeries` (`src/lib/garmin/queries.ts:50`); without Garmin, `getTrainingLoad` (`src/lib/training-load.ts:149`) | medium | 2, built (M, L) |
| Today's activity | Steps | Steps, active kcal, intensity min, activities | - | `getTodayData(...).summary`, `.activities` | medium | 2 |
| VO2 max | Latest value | 180-day line | - | `getOverviewData` (`src/lib/garmin/queries.ts:638`, VO2 rows at `:660-668`) | medium | 3 |
| Recent activities | Last one | Last 3 | Last 6 | `getActivitiesData(userId, limit)` (`src/lib/garmin/queries.ts:389`) | low | 2 |
| Race predictor | Projected time | Projection and checklist | - | `getRaceProjection` (`src/lib/garmin/queries.ts:1050`) | high | 3 |

### 4.5 Friends

Friend data is another person's data. Every friends widget reads through the existing friend
actions, which filter on `users.showActivityToFriends` (`src/lib/actions/friends.ts:317`,
`:347`, `:433`), and never queries other users' `workout_sessions` directly. Each loader maps
rows to an explicit narrow shape (6.5). `getFriendsActivityFeed` selects `feeling`,
`exerciseCount` and `totalVolumeKg` (`src/lib/actions/friends.ts:420-424`); none of these
reach the widget.

| Widget | S | M | L | Data source | Who | Cost | Phase |
|---|---|---|---|---|---|---|---|
| **Friends' activity** | Newest friend workout | Last 3 (default) | Last 6 | `getFriendsActivityFeed` (`src/lib/actions/friends.ts:400`, 14 days) | all; empty state without friends | medium | 1, built |
| Reactions to my workouts | Count this week | Last 3 reactions | - | `getReactionsToMyWorkouts` (`:992`) | all | low | 2 |
| Friends' streaks | Top streak | Top 3 by streak, worked out today | - | `getFriends` (`:293`) | all | medium | 2 |
| Weekly leaderboard | My place | Top 5 | - | `getFriendsLeaderboard` (`:747`) | all | medium | 3, after its week start uses the user's zone (`:752-756` use the server clock) |

Empty state for all: "Add friends to see their workouts" with a link to `/more/friends`.

### 4.6 Quick actions

| Widget | S | M | L | Data source | Who | Cost | Phase |
|---|---|---|---|---|---|---|---|
| Start a workout | "New workout" button | Plus "Different program" | - | link `/new-workout` | all | none | 2 |
| Quick start | One favourite program | Two or three programs | - | programs list | all | low | 3, with its own e2e spec |
| Log body weight | Number field and Save | Plus last value | - | `logWeightEntry` (`src/lib/actions/profile.ts:91`) | all | none | 2 |
| Quick log (run or quick workout) | Button | - | - | the C2b quick workout when it exists | all | none | 3 |
| Rest timer | - | - | - | - | - | - | **no** (decision 9) |

### 4.7 Coach

| Widget | S | M | L | Data source | Who | Cost | Phase |
|---|---|---|---|---|---|---|---|
| Coach memory note | - | One entry the user pins | - | `listCoachMemory` (`src/lib/coach-memory.ts:40`); setting holds the entry id, never the text | users with entries | low | 3 |
| AI changes feed | Count this week | Last 3 changes with undo link | - | `getAssistantChanges` (`src/lib/actions/plan-revisions.ts:187`) | users with a connected assistant | low | 2 |

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **The user loses the way to start a workout** by hiding, by an audience change, or by a load error. | Today and Endurance today are not hideable; `resolveLayout` inserts a missing critical widget visible; their error state keeps a link to `/new-workout`; the no-cycle start stays a pinned bar. Tests T5, T6, U1. |
| R2 | **The home stops being one screen.** It is a fixed `100dvh` view, content past the screen is clipped, and the week card stretches to fill it. | The content area becomes `overflow-y-auto`. The last widget keeps its `flex-1` stretch when its def says `stretch: true` (Week), so the default looks the same. T1 and the screenshot step in 6.2. |
| R3 | **Hydration errors.** `toLocale*` and `Intl` in client labels; dnd-kit's generated ids. React #418 has failed on Linux WebKit before (`e2e/finish-reload.spec.ts:8`, `e2e/guided-workout.spec.ts:80`). | Widgets are Server Components and pass formatted strings. `DndContext` mounts only after Edit, with a fixed `id`. The e2e fixture fails on page exceptions. |
| R4 | **Writes race with reads** (2.4). | Writes at page level before any `Suspense`; loaders read only. T3. |
| R5 | **Drag on touch fights scroll; mixed sizes drag badly in a grid.** | Edit mode is a vertical list of full-width rows, drag from a `touch-none` handle, 8 px activation, Move up and down buttons. |
| R6 | **Server cost.** | Today's widgets use page data. Hidden streamed widgets run nothing. `home_layout` rides in the existing settings select. T2. |
| R7 | **One widget fails and takes the page down.** | `safeLoad` (with `unstable_rethrow` first) for loaders, and a client `WidgetErrorBoundary` per streamed slot for views. T4. |
| R8 | **Critical-flow regression from the rewrite.** `e2e/cycle-day.spec.ts`, `e2e/did-you-do-it.spec.ts`, `e2e/guided-workout.spec.ts`, `e2e/planned-sessions.spec.ts` open home. | JSX moves unchanged. The order spec from the first commit and those specs pass unchanged. |
| R9 | **Two devices save different layouts.** | The stored JSON carries `updatedAt`; a save from an older base returns a conflict (6.8). |
| R10 | **Friend data leak.** | Existing filtered actions only, narrow shape, payload test. |
| R11 | **The title heading disappears for tests and screen readers.** | The default shows it. When hidden, the `h1` stays as `sr-only`. |
| R12 | **Bundle growth** (`docs/plans/garmin-insights-design.md:501` asks that the home bundle does not grow). | Widgets are Server Components, charts plain SVG. Client code: `HomeGrid`, the edit list, the gallery sheet. @dnd-kit is already in the app. |

## 6. Build brief (one PR)

Written to be built in a fresh session. Read `CLAUDE.md`, `TESTING.md`, and sections 2 to 5
first. Trust the code over this text if they disagree; fix this doc in the same PR and say so
in the PR body. Branch off `main`. Schema change: yes. Critical flow: yes (home start entries).

### 6.1 Commit order inside the PR

1. **Pin today's home.** Add `data-testid`s to the current page only (no other change):
   `home-title`, `today-card`, `week-strip`, `rotation-strip`, `cycle-setup`, `missed-week`,
   `start-bar` (the existing `endurance-today`, `did-you-do-it`, `missed-key` stay). Add
   `e2e/home-default.spec.ts` (6.2). It must pass on this commit.
2. Schema, migration, `homeLayout: null` in the e2e reset (6.3).
3. Registry, layout functions, reducer, unit tests (6.5, 6.7).
4. Page rewrite into kinds and widgets, reading as in 6.4. `home-default.spec.ts` and the
   existing home specs pass unchanged.
5. Edit mode and the Server Action (6.8, 6.9).
6. The three new widgets and the gallery.
7. Privacy inventory, MCP field, `CLAUDE.md` smoke line, this doc's status.

### 6.2 Proof that the default is unchanged

`e2e/home-default.spec.ts`, written in commit 1 against the current code, WebKit and Chromium.
For each user type it sets up the account with `testDb()` and asserts the **order** of the
`data-testid`s inside the home content:

| User type | Expected order |
|---|---|
| Lifter, day-of-week cycle, a missed day | `home-title`, `today-card`, `missed-week`, `week-strip` |
| Lifter, rotation cycle | `home-title`, `today-card`, `rotation-strip` |
| No cycle | `home-title`, `cycle-setup`, `week-strip`, then `start-bar` outside the content |
| Endurance, day-of-week cycle, a session today and an unconfirmed one | `home-title`, `today-card`, `endurance-today`, `did-you-do-it`, `week-strip` |

Screenshots: there is no `toHaveScreenshot` in the repo yet. Baselines are per platform
(CI runs Linux), and the home shows the current date (the week ring, "ends" date). So:
take `toHaveScreenshot` per user type, light and dark, at 375x667, with `mask` on the week
strip day row and the "ends" text; create the baselines in CI's Linux run (`--update-snapshots`
in a one-off CI job, committed with commit 1). If they are not stable across two CI runs on
different days, delete them and attach manual before and after screenshots to the PR body
instead. The order spec stays either way.

Note: the content area clips today (`:205`), so at 375x667 a long home is cut off now and
scrolls after the rewrite. The spec checks order, not that every part is in view.

### 6.3 Data model and migration

Schema, `src/db/schema/users.ts`, next to the other display settings:

```ts
// The user's home screen layout (docs/home-widgets-audit.md). Null means the
// default for their user type (src/lib/home/layout.ts). Order, size, hidden and
// per-widget options only; never free text.
homeLayout: jsonb("home_layout").$type<StoredHomeLayout>(),
```

Migration: `pnpm db:generate`, answer "create column":

```sql
ALTER TABLE "user" ADD COLUMN "home_layout" jsonb;
```

Nullable, no default: no row rewrite, no backfill. Commit the SQL and `drizzle/meta/`.

Rollback:
- **Code rollback** (revert the PR): safe without touching the database. Old code never
  reads the column. Re-applying the PR brings saved layouts back.
- **Schema rollback**, only if the column must go: drizzle has no down migrations. Write a
  later forward migration `ALTER TABLE "user" DROP COLUMN IF EXISTS "home_layout";` after
  the code that reads it is gone. Only saved layouts are lost.

e2e reset: add `homeLayout: null` to the `users` update in `e2e/fixtures/reset.ts:106-122`,
so every spec starts from the default.

Stored JSON:

```ts
type StoredHomeLayout = {
  v: 1;                 // shape version
  updatedAt: string;    // ISO time of the save, for the conflict check (6.8)
  items: { id: string; size: "s" | "m" | "l"; hidden: boolean; settings?: Record<string, unknown> }[];
};
```

Only `header` and `widget` kinds appear in `items`.

Read path: add `homeLayout: users.homeLayout` to the select in `getUserSettings`
(`src/lib/user-settings.ts:16-30`) and return it as `homeLayout: unknown`. The page already
calls it through `userToday` (`:33-35`) and it is wrapped in React `cache()`, so the home
adds **no query**. Parse it with `parseStoredLayout` in the page only.

### 6.4 Page data flow

```
src/app/page.tsx (Server)
  session = requireSession(); consent gate                      as now
  -- writes, before any Suspense, in this order --
  await closeStaleOpenSessions()
  cycleResult = await activeCycle()            cache() around getActiveCycleForUser
  -- reads --
  core = await loadHomeCore(session, cycleResult)   one Promise.all as today:
        stats, completed sessions (from monday), insight (getWorkoutInsight(id, cycleResult)),
        checkin, policyNotice, endurance, weekPlanned, settings (with homeLayout)
  audience = { endurance: core.endurance !== null || enduranceEnabled, garmin: garminAllowed(role) }
  layout = resolveLayout(parseStoredLayout(core.settings.homeLayout), audience)
  render:
    header widget (or sr-only h1)
    notices slot "top"                         from core, no Suspense (as now)
    <HomeGrid layout ...>                      client
      core widgets (today, cycle, enduranceToday, week, weeklyGoal)
                                               render from core, no Suspense, no skeleton
      notices slot "afterTraining"             placed after the later of today/enduranceToday
      streamed widgets (recentPrs, friendsActivity, garminReadiness)
                                               <WidgetErrorBoundary><Suspense fallback=Skeleton>
                                               <StreamedWidget/> (safeLoad(load(ctx)))
    "Edit home" pencil at the end of the list, only when the title is hidden (decision 16)
  <StartBar/> when no cycle and not editing
  <Suspense><SharePromptLoader/></Suspense>    slot "end", as now
```

Rules:

- **Writes first.** Nothing below `loadHomeCore` writes. A streamed loader that needs cycle
  data takes it from `ctx.core`, never by calling `getActiveCycleForUser` again.
- **Today has no skeleton.** Today, Cycle, Endurance today, Week and Weekly goal render from
  `core`, so the start button is in the first HTML, as now.
- **`cache()` keys.** Shared wrappers in `src/lib/home/core.ts` take no arguments or only
  primitives (`activeCycle()`, `completedSince(mondayStr)`), so React `cache()` dedupes them.
  Pass `cycleResult` into `getWorkoutInsight` (`src/lib/actions/workout-sets.ts:1581`, second
  parameter), as the page does now.
- **Audience** is `{ endurance: boolean; garmin: boolean; cycle: boolean }`. Today switches
  between its cycle and no-cycle variants by data. Cycle progress is available only with an
  active cycle (owner, 2026-11-13: without one, Today already says "Set up a Cycle"); a saved
  Cycle progress stays in the stored row and comes back with a cycle. The page takes `cycle`
  from the core data; the Server Action reads whether an active cycle exists, without
  `getActiveCycleForUser`.
- `src/app/loading.tsx` shows a neutral skeleton (title, one card, one strip): it cannot know
  the user type. This also closes `docs/ui-polish-audit.md` B2.

### 6.5 Registry and widget contract

Folder layout, so two widgets added in parallel never touch the same lines:

```
src/lib/home/widgets/<id>.ts                      pure def, no React
src/lib/home/widgets/index.ts                     one import line per widget -> WIDGETS
src/components/features/home/widgets/<id>/load.ts streamed widgets only
src/components/features/home/widgets/<id>/View.tsx View, Empty, Skeleton (and Error if special)
src/components/features/home/widgets/index.ts     one import line per widget -> RENDERERS
```

Def (`src/lib/home/widgets/types.ts`):

```ts
export type WidgetSize = "s" | "m" | "l";
export type WidgetKind = "header" | "widget";
export type WidgetGroup = "training" | "prs" | "stats" | "garmin" | "friends" | "actions" | "coach";
export type Audience = { endurance: boolean; garmin: boolean; cycle: boolean };

export type WidgetDef = {
  id: string;                  // stable, never reused; retired ids go to RETIRED_IDS
  kind: WidgetKind;
  group: WidgetGroup;
  title: string;
  description: string;         // one line in the gallery
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  critical: boolean;           // holds a start entry: not hideable, re-inserted if missing
  stretch?: boolean;           // may fill leftover height when last (week)
  source: "core" | "stream";
  available: (a: Audience) => boolean;
  defaultVisible: (a: Audience) => boolean;
  settings?: z.ZodType;        // ids and numbers only
};
```

`src/lib/home/widgets/index.ts`:

```ts
import { today } from "./today";
import { week } from "./week";
// ...one line per widget
export const WIDGETS = { today, week /* ... */ } as const;
export type WidgetId = keyof typeof WIDGETS;
export const RETIRED_IDS: readonly string[] = [];
```

Notices live in `src/lib/home/notices.ts` (id, slot, render) and are not part of `WIDGETS`.

Render side (`src/components/features/home/define-widget.tsx`):

```ts
export function defineWidget<D>(w: {
  select?: (core: HomeCore) => D | null;              // source "core"
  load?: (ctx: HomeContext) => Promise<D | null>;     // source "stream": reads only
  View: (p: { data: D; size: WidgetSize; settings: unknown }) => React.ReactNode;
  Empty: (p: { size: WidgetSize }) => React.ReactNode;
  Skeleton: (p: { size: WidgetSize }) => React.ReactNode;
  Preview: (p: { size: WidgetSize }) => React.ReactNode;   // static, for the gallery and edit rows
  Error?: (p: { size: WidgetSize }) => React.ReactNode;    // default: "Couldn't load this."
}) { return w; }

// src/components/features/home/widgets/index.ts
export const RENDERERS = { today, week /* ... */ } satisfies Record<WidgetId, Renderer>;
```

`satisfies Record<WidgetId, Renderer>` makes `tsc` fail when a def has no renderer.

States every widget has:

| State | Rule |
|---|---|
| Loading | Streamed only: `Skeleton` for the stored size (S and M `h-36`, L `h-72`). Core widgets never show a skeleton. |
| Empty | `select` or `load` returns `null`: `Empty` shows one line and a link. Never renders nothing, or edit mode could not show it. |
| Error | Loader: `safeLoad(id, fn)` (`src/lib/home/safe-load.ts`) calls `unstable_rethrow(e)` first (so Next's redirect, not-found and dynamic-usage signals pass through), then logs `console.error("[homeWidget] load_failed", { id, error: e instanceof Error ? e.name : "unknown" })` and returns the error state. View: a client `WidgetErrorBoundary` around each streamed slot. **Today and Endurance today** have their own `Error` that still shows "Start a Workout" linking to `/new-workout`. |
| Data | `View`. Server Component; client parts get formatted strings only. Tap targets 44x44, `:active` feedback, theme tokens, a link to the full page. |
| Permission | `available(audience)` gates render and gallery. Loaders filter by `ctx.userId` or call an existing action that runs `requireSession`. Never a `userId` from the client. Garmin loaders call `garminAllowed(ctx.role)` again and return `null` when false. |
| Privacy | A loader returns an explicit narrow type, built field by field, never a spread of a DB row. Friends' activity returns `{ name, image, date, programName, setCount, sessionId }[]` and nothing else. |

### 6.6 How to add a widget (the recipe)

1. `src/lib/home/widgets/<id>.ts`: the `WidgetDef`. `defaultVisible: () => false` unless the
   owner asked for it on every home. `critical: true` only if it holds a start entry.
2. One import line in `src/lib/home/widgets/index.ts`.
3. `src/components/features/home/widgets/<id>/load.ts` (streamed) or a `select` (core).
   Read only. Reuse existing queries or actions. Return a narrow, serializable shape or `null`.
4. `src/components/features/home/widgets/<id>/View.tsx`: `defineWidget({...})` with View,
   Empty, Skeleton, Preview for each size in `sizes`.
5. One import line in `src/components/features/home/widgets/index.ts`.
6. Tests:
   - Component: View at each size, Empty, error (`src/__tests__/components/home-widgets/<id>.test.tsx`).
   - Unit: the loader's shaping if it does more than pass rows through.
   - Integration: only for new SQL, with an ownership check; for another person's data, a
     payload test of the exact keys.
   - e2e: none per widget. `e2e/home-widgets.spec.ts` loops over the registry.
7. Privacy: if the widget shows a kind of data home did not show before, or another person's
   data, run the `privacy-compliance` skill.
8. Docs: mark the row in section 4 as built.

Gallery "New" marks are out of scope for this PR (everything ships together). Later, add
`addedOn: "YYYY-MM-DD"` to the def and mark widgets added after the user's last save.

### 6.7 Layout resolution and defaults

`src/lib/home/layout.ts`, pure functions.

Phase 1 registry:

| id | Kind | Sizes (default) | critical | source | available | defaultVisible |
|---|---|---|---|---|---|---|
| `title` | header | M, L (M) | no | core | all | all |
| `today` | widget | S, M, L (L) | **yes** | core | all | all |
| `cycle` | widget | S, M (M) | no | core | cycle | none (Today L shows it) |
| `enduranceToday` | widget | M (M) | **yes** | core | endurance | endurance |
| `week` | widget | M, L (L), `stretch` | no | core | all | all |
| `weeklyGoal` | widget | S, M (S) | no | core | all | none (Week L shows it) |
| `recentPrs` | widget | S, M, L (M) | no | stream | all | none |
| `friendsActivity` | widget | S, M, L (M) | no | stream | all | none |
| `garminReadiness` | widget | S, M (M) | no | stream | garmin | none |

Notices: `policy`, `checkin`, `illness` (slot `top`); `didYouDoIt`, `missed` (slot
`afterTraining`); `share` (slot `end`). Pinned: `startBar`.

`defaultLayout(audience)` gives `title M, today L, enduranceToday M (endurance only), week L`.
With the slots in section 3, this renders the same parts in the same order as today for
every user type in the 6.2 table.

Today per size and state (every size keeps every action; the S "More" menu is a 44x44 button
that opens a sheet):

| State | S | M | L |
|---|---|---|---|
| One program, not done | name, "Start" (`/programs/<id>/workout`); More: Different Program | card without the cycle header | as now |
| Done (manual or auto) | name and Done chip, "Do Again" or "Log in app"; More: Skip (auto day), Different Program | same | as now |
| Several sessions | "N sessions today", the first open session's start; More: every other session's start, Different Program | same | as now |
| Rest day or no program | "Rest Day" or "No program today", "Start a Workout" (`/new-workout`) | same | as now |
| No cycle | "Set up a Cycle" (`/cycles`); the pinned bar stays | prompt and link, no placeholder | preview as now |

`resolveLayout(stored, audience)`:

- `stored === null`: `defaultLayout(audience)`.
- Zod `.strict()` parse; bad JSON gives `null` and logs `[homeLayout] invalid` with the user
  id only.
- Drop unknown and retired ids, and duplicates (keep the first).
- A size not in `sizes` falls back to `defaultSize`.
- A `critical` widget that is hidden becomes visible.
- A `critical` widget that is missing and whose `defaultVisible(audience)` is true is inserted
  visible at its default position (Today after `title`; Endurance today after Today). This
  covers a user who saved a layout and later gets the endurance switch.
- Other missing widgets are appended `hidden: true`, so the gallery lists them.
- Widgets whose `available` is false are left out of the result. They stay in the stored row
  (6.8), so they come back when the audience changes.

Existing users: no data migration. Every row is `null`, which renders the default. Reset
writes `null`. The default is never written into the column.

### 6.8 Server Action

`src/lib/actions/home-layout.ts`, from the canonical template in `CLAUDE.md`:

```ts
export async function saveHomeLayout(data: unknown): Promise<ActionResult<{ updatedAt: string | null }>>
```

- `requireSession()`. Zod, `.strict()`: `{ items: Item[] | null, baseUpdatedAt: string | null, force: boolean }`.
  Ids must be known and unique, `items.length <= Object.keys(WIDGETS).length`, sizes allowed,
  no critical widget hidden, settings parsed by each widget's schema.
- Read the stored row for `auth.user.id`. If its `updatedAt` is not `baseUpdatedAt` and
  `force` is false, return `{ success: false, error: "conflict" }`.
- `mergeForSave(stored, items, audience)`: compute the audience from the user row (endurance
  flag, role), then append to `items` the stored items whose widget is not available now, in
  their stored order. So turning endurance off and saving does not lose the endurance widgets.
- `items === null` (Reset): write `null`.
- `db.update(users).set({ homeLayout }).where(eq(users.id, auth.user.id))`, then
  `revalidatePath("/")`.
- Errors: `console.error("[saveHomeLayout] failed", { userId })`; return
  `{ success: false, error: "Couldn't save your home layout" }`.
- Client calls it through `callAction()`. Not through the offline replay queue.

### 6.9 Edit mode

> **Superseded in part by decision 17 (owner, 2026-11-13).** Edit mode is the real grid,
> as on the iPhone home screen, not a separate list: widgets jiggle, drag a whole widget to
> reorder, a "−" badge hides, a tap opens a sheet with Size, Move up, Move down and Hide,
> and "+ Add widget", Undo and Reset sit at the top. A long-press (500 ms, cancelled by
> more than 8 px of movement or a scroll) on any widget also enters edit mode. The rules
> below on saving, conflicts, Cancel, the covered bottom nav, `DndContext` mounted only in
> edit mode with `id="home-edit"`, and focus still apply; where they speak of rows, read
> widgets in the grid. Code: `src/components/features/home/HomeEditGrid.tsx`,
> `WidgetSheet.tsx`, `use-long-press.ts`.

`src/components/features/home/HomeGrid.tsx` (client) renders the grid outside edit mode and
`HomeEditList.tsx` inside it. State: `src/lib/home/layout-reducer.ts` (pure: `move`, `moveUp`,
`moveDown`, `resize`, `hide`, `show`, `add`, `reset`, `undo`) with `useReducer`. Key
`HomeGrid` on a hash of the server layout (`key={layoutHash}`), so `revalidatePath` after a
save, or a save from another tab, resets the reducer to the new server state.

Outside edit mode:
- Rows: consecutive S widgets pair in a two-column row; a lone S takes half a row; M and L
  take a full row. No CSS grid `dense`: visual order equals DOM order.
- The last widget stretches when its def has `stretch` (Week), as the page does now.

Enter:
- A pencil icon button (44x44, `aria-label="Edit home"`, visible focus ring, `:active`
  feedback) at the top right of the title row, and nowhere else. When the user hides the
  title, the pencil moves to the end of the list, so edit mode is always reachable
  (decision 16). No long-press.
- On enter, announce "Editing home. Drag or use Move up and Move down to reorder." in a polite
  live region, and move focus to the first row's handle.

In edit mode:
- The page shows **a vertical list of full-width rows**, one per visible widget, then a
  "Hidden" section. Each row: drag handle, the widget's static `Preview` at its current size,
  title, a size button that opens a menu with only the allowed sizes, "Move up", "Move down",
  and hide (minus). Critical rows show a lock with the label "Can't be hidden".
- Notices and the pinned start bar are not shown. Widget content is not rendered, so no link
  inside a widget can fire.
- **The edit bar covers the bottom nav**: fixed at the bottom, same height as the nav, higher
  z-index, with "Add widget", "Undo", "Reset". The nav is not reachable until Done or Cancel,
  so a client navigation cannot drop the draft. A `beforeunload` handler warns on reload or
  close while the draft has changes. Pad the list by the bar's height.
- The title row shows "Cancel" (left) and "Done" (right).

Reorder:
- Mount `DndContext` only in edit mode, with `id="home-edit"`, so its generated ids never
  meet server HTML.
- `SortableContext` with `verticalListSortingStrategy`. Sensors as
  `src/components/features/WorkoutExerciseList.tsx:66-71`: `PointerSensor` with
  `activationConstraint: { distance: 8 }`, `KeyboardSensor` with `sortableKeyboardCoordinates`.
  Listeners on the handle only, which has `touch-none`.
- Announcements name the widget and position ("Week moved to position 2 of 4").
- "Move up" and "Move down" are the single-pointer alternative WCAG 2.5.7 requires.

Resize: pick a size in the row's menu. The row's `Preview` changes at once. The server
renders the real widget at that size after Done.

Hide and show: minus moves the row to "Hidden"; plus puts it back at its old place and size.

Add: "Add widget" opens a bottom sheet with available, not-visible widgets, grouped by
`group`, each with its `Preview` and sizes. Add puts it last at `defaultSize` and focuses its
row.

Focus rules:
- After a move, focus stays on the moved row's control that was used.
- After hide, focus moves to the next row's handle (or the previous row if it was last).
- Enter on a row does nothing; Enter in the title row's "Done" saves.
- After Done or Cancel, focus returns to the "Edit" button that opened edit mode.

Undo steps back one change. Reset asks "Reset home to the default layout?" and saves `null`.

Done:
- `saveHomeLayout({ items, baseUpdatedAt, force: false })` through `callAction()`.
- Success: leave edit mode.
- `conflict`: "Your home was changed on another device." with "Reload" and "Save mine" (`force: true`).
- Other failure, or offline: stay in edit mode, keep the draft, show the error
  ("You're offline. Try again when connected." when `navigator.onLine` is false).

Cancel: drop the draft; ask "Discard changes?" if there are any.

Look: theme tokens only (`bg-muted`, `border-border`, `text-muted-foreground`,
`ring-primary`), so light and dark need no extra work. No wobble animation.

### 6.10 Files

Create:

| File | What |
|---|---|
| `e2e/home-default.spec.ts` | 6.2, commit 1 |
| `e2e/home-layout.spec.ts` | 7, e2e rows |
| `e2e/home-widgets.spec.ts` | 7, e2e rows |
| `src/lib/home/widgets/types.ts`, `index.ts`, and one `<id>.ts` per widget | registry |
| `src/lib/home/notices.ts` | notice ids and slots |
| `src/lib/home/layout.ts` | `defaultLayout`, `parseStoredLayout`, `resolveLayout`, `mergeForSave`, Zod schemas |
| `src/lib/home/layout-reducer.ts` | edit reducer |
| `src/lib/home/core.ts` | `activeCycle()`, `loadHomeCore()`, `HomeCore`, `HomeContext`; `enduranceHome` and `enduranceToday` moved from `page.tsx:53-89` |
| `src/lib/home/safe-load.ts` | `safeLoad` |
| `src/lib/actions/home-layout.ts` | `saveHomeLayout` |
| `src/components/features/home/define-widget.tsx` | `defineWidget`, `Renderer` |
| `src/components/features/home/HomeGrid.tsx` | client: rows, edit toggle, reducer |
| `src/components/features/home/HomeEditList.tsx` | client: sortable rows, toolbar, edit bar, focus |
| `src/components/features/home/WidgetGallerySheet.tsx` | client: add sheet |
| `src/components/features/home/WidgetErrorBoundary.tsx` | client error boundary |
| `src/components/features/home/Notices.tsx` | the notices by slot |
| `src/components/features/home/StartBar.tsx` | pinned bar, moved |
| `src/components/features/home/widgets/<id>/View.tsx` (and `load.ts` for streamed) for `title`, `today`, `cycle`, `enduranceToday`, `week`, `weeklyGoal`, `recentPrs`, `friendsActivity`, `garminReadiness` | widgets; today's JSX moved unchanged for the L size |
| `src/components/features/home/widgets/index.ts` | `RENDERERS` |
| `drizzle/<next>_home_layout.sql`, `drizzle/meta/*` | generated |
| tests in section 7 | |

Change:

| File | Change |
|---|---|
| `src/app/page.tsx` | commit 1: `data-testid`s only; commit 4: the shell in 6.4 |
| `src/app/loading.tsx` | neutral skeleton |
| `src/db/schema/users.ts` | `homeLayout` column |
| `src/lib/user-settings.ts` | select and return `homeLayout` |
| `e2e/fixtures/reset.ts` | `homeLayout: null` in the reset |
| `src/lib/mcp/tools/profile.ts` | `get_profile` returns `homeLayout` (8.2) |
| `docs/privacy/data-inventory.md` | Settings row: `home_layout` |
| `docs/plans/README.md` | status |
| `CLAUDE.md` | smoke pass: after step 3, "Edit home, Move up on Week, Done, reload, order kept" |

Do not change: `WorkoutSetsList`, timers, set editing, the workout routes, `bottom-nav.tsx`.

### 6.11 Acceptance criteria

- `e2e/home-default.spec.ts` passes on commit 1 and, unchanged, on the final commit.
- Today and Endurance today cannot be hidden through the UI, the Server Action, or a
  hand-written JSON value, and come back visible after an audience change.
- A throwing Today loader or view still shows a link to `/new-workout`.
- Order, size and hidden state persist across reload and across two browser contexts; a
  stale save gets the conflict prompt.
- A throwing streamed loader or view shows "Couldn't load this." in that widget only.
- Reorder works by drag (Chromium, WebKit), by Move up and down, and by keyboard.
- Every edit-mode control is at least 44x44 and has an accessible name.
- The default layout runs the same number of queries as today's page (T2).
- Garmin readiness never appears for a non-admin, in the grid or the gallery.
- No friend with `showActivityToFriends = false` appears, and the payload has only the
  narrow keys.
- No hydration error on WebKit or Chromium, before or after entering edit mode.
- The home JS bundle grows only by the home client components.
- Existing home specs pass unchanged. `pnpm verify`, `make e2e`, the 9-step smoke pass green.

## 7. Test plan

Per `TESTING.md`: pick the layer by what can break. Home is the entry to critical flows.

| Id | Layer | File | Test |
|---|---|---|---|
| T1 | e2e | `e2e/home-default.spec.ts` | Default order per user type (6.2), including `did-you-do-it` and `missed-week` between the training widgets and the week strip. Commit 1, then unchanged. |
| U1 | Unit | `src/__tests__/home-layout.test.ts` | `resolveLayout`: null gives the default per audience; unknown, retired and duplicate ids dropped; bad size falls back; hidden critical made visible; missing critical inserted visible when `defaultVisible`; other missing appended hidden; unavailable left out. `mergeForSave` keeps unavailable stored items in order. `.strict()` rejects extra keys and free-text settings. |
| U2 | Unit | same | The default for each 6.2 user type, with the notice slots, lists the same parts in the same order as T1. |
| U3 | Unit | `src/__tests__/home-layout-reducer.test.ts` | move, moveUp and moveDown at the ends, hide, show to the old place, resize to a disallowed size refused, add, undo stack, reset |
| U4 | Unit | `src/__tests__/home-widgets-registry.test.ts` | ids unique; `defaultSize` in `sizes`; `today` and `enduranceToday` critical; no id also in `RETIRED_IDS`; every streamed widget has `load`, every core widget `select` |
| U5 | Unit | `src/__tests__/home-plan.test.ts` | The streamed widgets the page renders are exactly the visible ones; a hidden one is never passed to `load`. |
| C1 | Component | `src/__tests__/components/home-today.test.tsx` | For each state in the 6.7 table, the set of action `href`s and buttons at S (including the More sheet) equals the set at L. The `Error` state links to `/new-workout`. Same for Endurance today's error. |
| C2 | Component | `src/__tests__/components/home-edit.test.tsx` | Edit renders the list and no widget content; Cancel restores; Done calls the action once; a failed save keeps edit mode and the draft; conflict shows the prompt; keyboard reorder and announcement text; focus rules from 6.9; `DndContext` absent before Edit. |
| C3 | Component | `src/__tests__/components/home-widgets/*.test.tsx` | Each widget's View at each size, Empty, error. Garmin readiness renders from a fixture (e2e accounts are not Garmin users by default). |
| T4 | Component | `src/__tests__/components/home-error-boundary.test.tsx` | A throwing View inside `WidgetErrorBoundary` shows "Couldn't load this." and the rest of the list stays. `safeLoad` rethrows a `redirect()` and catches a plain error. |
| T2 | Integration | `src/__tests__/integration/home-layout.test.ts` | Count statements through a test-only Drizzle logger: `loadHomeCore` for the default layout runs the same count as the pre-rewrite page reads (record the number in commit 1 with the same harness around the current reads); with all streamed widgets hidden, no streamed loader runs. |
| T3 | Integration | same | On an auto-complete day (a cycle slot with `autoComplete`), `loadHomeCore` returns today as done in both the Today data and the week's completed dates. |
| I1 | Integration | same | `saveHomeLayout` writes only the caller's row; refuses hidden critical, unknown id, bad size, extra keys, too many items; `null` resets; conflict without `force`; `force` overwrites; `mergeForSave` keeps endurance items when the switch is off; the column appears in `collectUserData`. |
| I2 | Integration | same | Friends' activity loader: a friend with activity hidden never appears; each row has exactly `name, image, date, programName, setCount, sessionId`. Garmin readiness loader returns `null` for a non-admin. |
| E1 | e2e | `e2e/home-layout.spec.ts` | Edit, Move up on Week, **hide Week**, resize Today to S, Done, reload: state persists (check with `testDb()`); Today S "Start" opens the workout; Reset restores the default. |
| E2 | e2e | same | No-cycle user: after a layout change, `start-bar` is still visible outside edit mode. |
| E3 | e2e | same | Endurance user: move Endurance today below Week, Done; "Start guided" still opens the player. |
| E4 | e2e | same | Offline (`context.setOffline(true)`): Done shows the offline message and keeps the draft; back online, Done saves. |
| E5 | e2e | `e2e/home-widgets.spec.ts` | Add every widget available to the e2e user from the gallery at each size; no console errors; reload persists. Garmin can be covered the way `e2e/garmin.spec.ts` does (it makes the account an admin; the e2e server sets `GARMIN_KEY_ENCRYPTION_KEY`, `playwright.config.ts:73`), but C3 and I2 are enough. |
| - | e2e | existing | `cycle-day`, `did-you-do-it`, `guided-workout`, `planned-sessions`, `consent`, `auth.setup` pass unchanged. |

All e2e on WebKit and Chromium. Then `pnpm verify`, `make e2e`, the 9-step smoke pass.

## 8. Privacy and MCP

### 8.1 Privacy steps

Storage: **`user.home_layout`**, not localStorage and not a new table.

| Option | For | Against |
|---|---|---|
| Column on `user` (chosen) | Syncs across devices. Server renders the right layout on first paint. `collectUserData` selects the whole `user` row (`src/lib/account-data.ts:74`), so export and deletion need no new code. Read in an existing select. | A migration. |
| New table | Clean for per-device layouts. | Must join the export list and the cascade test. No current need. |
| localStorage | No migration, works offline. | No sync; first paint shows the default, then jumps; not in the export; removed on sign-out. `weeklyGoal` already shows the cost. |

Steps in the PR:
1. Run the `privacy-compliance` skill (new column with user data; friend data shown in a new
   place).
2. `docs/privacy/data-inventory.md`, Settings row: add `home_layout` (which home widgets the
   user shows, in which order and size). Art. 6(1)(b), until deletion, like `distanceUnit`.
3. No new browser storage, no new recipient. Confirm with the skill that no policy text change
   and no `LEGAL_VERSION` bump is needed.
4. Widget settings hold ids and numbers only (`.strict()` Zod).
5. Friends' activity shows less than the Friends page: name, picture, date, program, set
   count. No feeling, notes or volume.

### 8.2 MCP decision

**Read only.** `get_profile` (`src/lib/mcp/tools/profile.ts:22`) adds:

```ts
homeLayout: { isDefault: boolean; items: StoredHomeLayout["items"] | null }
```

It returns the stored row as parsed by `parseStoredLayout`, with `isDefault: true` and
`items: null` when the column is null. It does **not** resolve the layout against the cycle:
`getActiveCycleForUser` needs a cookie session (`requireSession`) and writes (2.4). Update the
tool description in one sentence.

No write tool. The layout is the user's own space; a coach that rearranges it would surprise
the user and would need the revisions machinery (A4) for a low-value change. If a coach
feature must put something on home, it is a notice.

## 9. Decisions

Decided by the hub on 2026-11-13; the owner may change any of them.

| # | Question | Decision |
|---|---|---|
| 1 | Can the user hide Today? | No. Move and resize only. Same for Endurance today. |
| 2 | Can the user hide the title row? | Yes. The `h1` stays as `sr-only`, and the "Edit home" pencil moves to the end of the list. |
| 3 | Can the user hide or move notices? | No. They render in fixed slots and keep their own dismiss paths; "Missed this week" keeps its setting. |
| 4 | Where is the layout stored? | `user.home_layout jsonb`; null means default. |
| 5 | May the home scroll? | Yes. The default still looks the same. |
| 6 | Do new widgets appear on homes users already arranged? | No. They are appended hidden and listed in the gallery. |
| 7 | Are the new widgets (Recent PRs, Friends' activity, Garmin readiness) visible by default? | No. Nobody's home changes with this PR. |
| 8 | Move `weeklyGoal` from localStorage into the account? | Yes, in phase 2, as a Weekly goal setting, seeded once from localStorage. |
| 9 | Rest timer widget? | No. It belongs to an open workout. |
| 10 | Quick start widget? | Phase 3, with its own e2e spec. |
| 11 | Can the AI coach change the layout? | No. Read only through `get_profile`. |
| 12 | Long-press to enter edit mode? | Was: no, an "Edit" button. Now yes, as well as the pencil (decision 17). |
| 13 | One layout per account or per device? | Per account. |
| 14 | Endurance today above the strength card by default? | No. Keep today's order. |
| 15 | Weekly leaderboard widget? | Only after `getFriendsLeaderboard` uses the user's week. |
| 16 | Where is the way into edit mode? | Decided by the owner on 2026-11-13: only a pencil icon button ("Edit home") at the top right of the title row. No "Edit home" button at the end of the list, except when the title is hidden: then the pencil moves there. |
| 17 | What does edit mode look like? | Decided by the owner on 2026-11-13, replacing the list in 6.9: the real grid, as on the iPhone home screen. Two columns (S one, M and L both; L is the taller content). Widgets jiggle (off with reduced motion). Enter by the pencil or a long-press on a widget. Drag the whole widget to reorder; a "−" badge on hideable widgets; a tap opens a sheet with Size, Move up, Move down (WCAG 2.5.7) and Hide; "+ Add widget", Undo and Reset at the top. |
| 18 | Does Today show the day's exercises? | Decided by the owner on 2026-11-14: yes, as in the locked design. L: the counts, minutes, the first three exercises with their sets and "+ N more"; M: the counts; S: exercises and minutes. The per-lift tip only if the insight already gives it (it does not, so none). |
| 19 | Where does the date go? | Decided by the owner on 2026-11-14: its own widget, "Date" (S, M), in the gallery and not on the default home. The title row stays first. |
| 20 | Does the home follow the accent colour? | Decided by the owner on 2026-11-14: yes. `--brand` and `--brand-fill` follow the accent picked in settings, light and dark; blue stays the default; `--pos` does not change. |
| 21 | Do the new fonts and look spread to the rest of the app? | Decided by the owner on 2026-11-14: no. They stay on the home, for good. |

## 10. Sources

- Apple Human Interface Guidelines, Widgets (sizes; one tap target in small, several in
  larger; each size keeps the same focus):
  <https://developer.apple.com/design/human-interface-guidelines/widgets>
- W3C, Understanding SC 2.5.7 Dragging Movements (WCAG 2.2, Level AA; a single-pointer
  alternative to every drag; keyboard support alone does not meet it):
  <https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements>
- dnd-kit, Accessibility guide (keyboard sensor, screen reader announcements):
  <https://docs.dndkit.com/guides/accessibility>
- Garmin forums, "My Day" card order and dismissed cards:
  <https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-ios/267089/why-do-my-day-cards-keep-rearranging-and-removed-ones-keep-coming-back>,
  <https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-ios/148606/my-day-resets-to-defaults>,
  <https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-mobile-ios/116591/choose-or-rearrange-the-my-day-widgets>

## 11. Changes after review

Two review passes on 2026-11-13. Each finding was checked against the code first.

- Writes inside `getActiveCycleForUser` and `weekdayToday` are real (2.4). The reviewers
  cited `insertAutoSessions` at `training-cycles.ts:258`; it is at `:281`.
- "Did you do these?" and "Missed this week" sit between Endurance today and the week strip;
  the first draft put them on top. Fixed with notice slots.
- e2e accounts **can** see Garmin: `e2e/garmin.spec.ts` makes the account an admin and the
  e2e server sets the key (`playwright.config.ts:73`). Component and integration tests still
  carry the Garmin coverage, as asked.
- The current page has no `data-testid` on the today card or week strip, so commit 1 adds them
  before the order spec.
- The repo has no `toHaveScreenshot` yet, and the home shows today's date; 6.2 says how to make
  screenshots stable or fall back to manual ones.
- The `lifter` audience flag was not added: Recent PRs is available to all with an empty
  state, and a cycle-free audience lets the Server Action compute availability from the user
  row.
- `REGISTRY_VERSION`, `seen` and `since` are gone; a later `addedOn` date can drive "New"
  marks.
- The first draft's 2-column sortable grid with `rectSortingStrategy` is replaced by a vertical
  list in edit mode.

## 12. Build notes

Where the build differs from sections 6 and 7, and why. The code is the reference.

- **Migration** is `drizzle/0090_home_layout.sql` (0089 went to the nutrition plans).
- **Policy version.** The policy's Settings line and its MCP paragraph now name the home
  layout, so `LEGAL_VERSION` moved to `2026-11-13.4` (users are told once). `CONSENT_VERSION`
  stays: the layout is not health data and adds no purpose.
- **Readiness swap notice.** Main gained `ReadinessSwapCard` (package D4) after this audit.
  It is a notice, id `readinessSwap`, in slot `afterTraining` before `didYouDoIt`, where the
  old page rendered it (`src/lib/home/notices.ts`).
- **Endurance today renders nothing on a day without a structured session**, as the old card
  did, instead of an empty line. An empty line would change the home of every endurance user
  on a rest day. Edit mode shows the static preview, so the widget can still be moved.
- **T2 harness.** The statement count spies on `pool.query` and `pool.connect` and renders the
  page with `await Home()`, per user type, twice (first render writes, second is steady).
  It lives in `src/__tests__/integration/home-queries.test.ts`, written in commit 1 and
  unchanged since. Under Vitest React's `cache()` does not dedupe, so the page reads the
  settings once directly (`getUserSettings`, then `todayIn`) instead of adding a call.
- **Core widgets** are wrapped in a Suspense boundary whose fallback is the widget's error
  state. Nothing in them suspends; the boundary only lets a server component that throws
  deep in a view show its error state instead of failing the page.
- **Garmin readiness** reads one row of `garmin_daily_metrics` (the newest up to today) rather
  than `getTodayData`, which reads the whole Today tab. The value is the same.
- **Edit mode is the grid** (decision 17). While a widget is dragged the grid reorders
  under it and the widget follows the pointer in an overlay, so S, M and L widgets keep an
  honest layout; after a swap the same neighbour does not swap back until the pointer has
  left it, which stops flicker between widgets of different heights. Mouse and pen drag after
  8 px; touch after holding 180 ms (dnd-kit's TouchSensor), so a swipe still scrolls.
- **Size in edit mode** shows the real widget at the size it was saved at, and its static
  preview at any other size, until Done: the server renders the real widget at the new size.
  Rendering every size of every widget on each home load would grow the page for everyone.
- **L is not a fixed double height.** Widgets keep their natural height, so nothing is
  clipped; L is the taller content of the same widget.
- **The title row** cannot be moved, only resized or hidden: a header is always first.
- **A save drops widgets the user cannot have** from the client's list instead of refusing
  the save; `mergeForSave` keeps the stored ones. The conflict check is part of the UPDATE.
- **Reset** saves `null` at once after its confirm, and leaves edit mode.
- **`UserSettingsLoader`** passes only the zone and units to the client, so the layout is
  not sent to every page.
- **Screenshots.** No `toHaveScreenshot` baselines: they need a Linux CI job. The fallback in
  6.2 applies: manual before and after screenshots, per user type, light and dark.
- **U5** is an integration test in `src/__tests__/integration/home-layout.test.ts`: it
  renders the page with Recent PRs and Friends hidden, then visible, awaits the streamed
  slots and counts calls to each renderer's `load`. It tests the page's own loop, so there
  is no separate helper for it. The U4 renderer check is in
  `src/__tests__/integration/home-widgets.test.ts` (importing the renderers needs the env).
- **A stored layout that does not parse** renders the default, and the page sends base
  `null`. The save then checks the row against the value it read, not its `updatedAt`;
  otherwise every save from that row would be a conflict.
- **After a save** edit mode stays, with the draft and "Saving…", until the refreshed page
  arrives (`router.refresh()` in a transition), so the old layout does not show first.
  Cancel, Reset and Save mine are disabled while a save runs.
- **A retry sends what failed.** Done after an error and Save mine after a conflict send the
  payload of the failed save; a failed Reset is retried as a Reset, not saved as a fixed
  default layout. An edit after the failure drops it, and the draft is sent.
- **Long-press and text selection.** `[data-widget]` has `user-select: none`, so holding a
  widget on iOS does not start a text selection.

### Redesign and phase 2 widgets (2026-11-14)

The home now follows the locked design, `docs/design/home-redesign/home-locked.html`.
Where the build differs from it or from section 4, and why:

- **Fonts and tokens.** Big Shoulders (the current Google family that replaced Big Shoulders
  Display; its `opsz` axis is set to 72 for the display look) and Work Sans load through
  `next/font` in `src/components/features/home/fonts.ts`, for the home page and its sheets
  only; by owner decision 21 they stay there. The tokens `--brand`, `--brand-fill`, `--pos`,
  `--font-display`, `--font-ui` and the home surfaces are in `src/app/globals.css`.
  `.home-ui` maps the shared tokens (`--muted`, `--primary`, `--muted-foreground`) to the
  home's look, so the notices and Endurance today match without their own changes.
- **Accent colour** (decision 20). The theme provider marks `<html>` with `data-accent`
  (`src/components/ui/theme-provider.tsx`), and `globals.css` maps each accent to `--brand`
  and `--brand-fill`, light and dark. Blue, green and orange use the design's values; the
  design has no white or purple, which follow the same 4.5:1 rule. `.home-ui` sets `--primary`
  to `--brand`, so the shared parts follow.
  - The pre-paint script in `src/app/layout.tsx` (`prePaintThemeScript` in
    `src/lib/utils/accent.ts`) sets `data-accent` and the custom tokens before the first
    paint, from the same localStorage keys, so a non-blue accent does not paint blue first.
  - A custom accent is not used as picked: `customAccentTokens` darkens (light theme) or
    lightens (dark theme) it until brand text has 4.5:1 on every home surface, derives a fill
    with 4.5:1 for white text, and picks white or #0b0b0c for text on the brand. They reach
    the CSS as `--brand-custom`, `--brand-fill-custom` and `--on-brand-custom`.
- **Edit entry stays the pencil** (decision 16), restyled as the design's round pill, and not
  the design's "Edit" text button. Edit mode keeps Cancel, Undo and Reset, which the design
  does not show.
- **Title.** M is the title alone, as before. The date is the Date widget (decision 19); the
  title's L size keeps its date and cycle week line, which was simpler than removing it.
- **Today** (decision 18) reads the day's program in one more statement, `readTodayPlan`
  in `src/lib/home/core.ts`, filtered by the program's owner, only on a day with one program.
  That is why the T2 counts in `src/__tests__/integration/home-queries.test.ts` are 2 higher
  for a user with a program today (the query and the pool checkout it makes). The minutes use
  `estimateSessionMinutes`. There is no "Day 2" (the cycle has no day number to show) and no
  per-lift tip or up chip: `WorkoutInsight` has no suggested weight per lift. The no-cycle
  prompt has no "Browse programs" link:
  every size of Today must keep the same actions (C1).
- **Week.** L has the ring beside the days and a legend; the design's sets, volume and time
  tiles are not built (no source on the home). Past planned days not done show as missed.
- **Recent PRs** has no gain pill or confetti: `getRecentPRs` returns no previous value.
- **Friends' activity** has no reaction button: a reaction is a write, and "Reactions to my
  workouts" is its own widget (4.5).
- **Streak** (S, M). The streak and the bars both come from `getHeatmapData`'s days
  (`streakWeeks`, `weekCounts` in `src/lib/home/widget-data.ts`), in Monday-to-Sunday weeks
  of the sessions' own dates around `ctx.today`, so a session at Monday 00:30 in Oslo counts
  in the new week. The Progress page still uses `getSummaryStats`, which cuts weeks in UTC.
  There is no "best streak", which no action returns. S says "Keep it lit." once this week
  has a session, and "Train this week to keep it." before.
- **Body weight** (S, M) shows kg; the app has no weight unit setting. It links to Progress,
  where weight is logged. When the latest entry is older than the 30-day window, the line
  under the number gives its date ("82.4 kg on 3 Sep") instead of a change.
- **Training load** (M, L) reads `getTrainingLoad`, which picks the source itself: the stored
  Garmin series when `garminAllowedFor` is true and there are days, else the app's sessions.
  It is available to endurance and Garmin users and links to `/week`. The line is the 7-day
  fatigue (ATL); the design's "sweet spot" band is left out, since the bars' scale has no
  agreed band. The 28 days are placed by date (`loadSummary` in
  `src/lib/home/widget-data.ts`): a day the Garmin series lacks is a 0 bar, and its fatigue
  decays from the day before as one rest day. The load figure is the last 7 calendar days.
  Form is today's state, so when the newest day with data is older than yesterday the widget
  shows the 7-day load as its number and no form (hub decision, 2026-11-14).
- **Weekly sets** (S) is the catalogue's "Weekly volume". It counts the sessions dated in the
  user's own Monday-to-Sunday week (`getWeeklyMuscleVolume` with a `week` range from
  `ctx.today`). Without the range, as on the Progress page, the week is the server's UTC week.
- **Race countdown** (S) is for endurance users: the soonest A race on or after today from
  `listSeasons`. A cycle's own `race_date` is not read.
- Sizes from section 4 that the design does not show (Weekly volume M and L, Body weight L,
  Training load S and per-sport L, Race countdown M) are in `BACKLOG.md`.
- **Samples and previews.** The "Add widget" gallery shows each widget's own view with
  made-up data from `src/components/features/home/samples.ts` (`Sample` in the renderer),
  the same for every user, as the design's "Add a widget" sheet does. Edit mode, at a size
  other than the saved one, shows the neutral skeleton (`Preview`): the user's own home never
  shows made-up numbers (hub decision, 2026-11-14; the owner may change it). No loader runs
  for either.
- **Second pass against the design** (hub, 2026-11-14), measured at 390 px with
  `getBoundingClientRect`: Week no longer stretches to fill the screen and is as tall as its
  content (164 px at M, as in the design); the hero's main action is the white 54 px button in
  every state, the other action a ghost link; "Make up" in the missed notice is a small tinted
  pill and Decline muted text, rows still 44 px; the insight shows in the hero as the design's
  one-line tip pill (headline only), not the full banner; Readiness S uses the design's 24 px
  number.
- **Third pass against the design** (two reviews, 2026-11-14): the edit-mode jiggle is the
  design's, one swing each way per 0.28 s, alternating, every second widget half a swing
  behind; the streak's inner flame has its own flicker (`home-flicker2`) and the sparkline
  area fades in (`home-fade`), both only without reduced motion; the no-cycle heading is
  24 px, sheet titles 20 px, the Today name 34 px at line height 1.15. The set-up link's
  accessible name is "Set up a Cycle", without the arrow.
- **Done dot in dark** uses `--brand-fill` on purpose, not the design's `--brand`: white on
  the fill has 5.5:1, white on the design's light blue 2.9:1.
- **Light theme in the mockup.** The locked mockup's light theme still paints some parts with
  its older tokens (a leak from before the v2 tokens). Light comparisons follow the v2 intent
  (`--brand`, `--brand-fill`, neutrals), not those pixels.
- **A failed plan read** (`readTodayPlan`) shows Today without its exercise list and logs
  `[Home] today_plan_read_failed`; before, it showed the error page.
