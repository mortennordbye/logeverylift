# Home screen widgets: audit, catalogue and build brief

<!-- doc-claims: skip — a point-in-time audit; its file:line refs describe the code as measured on 2026-11-13 (main at 0c8e29d), and phase 1 rewrites most of src/app/page.tsx. -->

Status: proposal. Nothing here is built. The owner settles the open questions in section 9,
then a build agent builds phase 1 from section 6 with no conversation history.

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
6. Build brief (phase 1, then phases 2 and 3)
7. Test plan
8. Privacy and MCP
9. Open questions
10. Sources

## 1. Summary

- Today the home screen is one Server Component (`src/app/page.tsx`, 510 lines). It reads
  all data in one `Promise.all` and renders a fixed list of cards in a fixed viewport that
  does not scroll. No part of it is configurable, except that the `missedWorkoutsEnabled`
  setting hides "Missed this week".
- Build **one widget registry** that holds every part of the screen. Each entry has a
  **kind**: `header` (the title row), `widget` (what the user arranges), `notice` (cards that
  ask the user to act; they show on top when they have something, and the layout cannot hide
  them) and `pinned` (the no-cycle "Start a Workout" bar). One contract, one render path.
- **Today** holds "Start Today's Workout". The user can move and resize it, but cannot hide
  it. The bottom nav reaches only a workout that is already open, so without Today a user has
  no way to start the planned workout.
- Store the layout as one nullable `jsonb` column, `user.home_layout`. `null` means "the
  default". The default is computed in code per user type. A user who never edits sees
  exactly today's home, and later changes to the default reach them too.
- Sizes: S (half width), M (full width), L (full width, taller). Two S widgets in a row
  share it. Reading order is layout order.
- Edit mode starts from an "Edit" button. Reorder with @dnd-kit (the same sensors as the
  workout lists) plus "Move up" and "Move down" buttons (WCAG 2.5.7). Resize with an S/M/L
  control, hide with a minus button, add from a gallery sheet. Cancel, Undo, Reset.
- Each widget is an async Server Component in its own `Suspense` and its own error guard.
  A hidden widget runs no query. A failing widget shows "Couldn't load", not the error page.
- Adding a widget is: one registry entry, one loader, one view, one render-map line, tests.
  Section 6.5 is the recipe.
- Phase 1 builds the system, turns all of today's home into widgets, and adds three new
  widgets: **Recent PRs**, **Friends' activity** and **Garmin readiness** (admins only).
- The AI coach gets read access to the layout through `get_profile`. No write tool.

## 2. Audit: the home screen today

All references are `src/app/page.tsx` unless the row names another file. "Critical" means
the part is an entry point to a critical flow in `CLAUDE.md` (logging a set, timers,
finishing a workout) and must never disappear by mistake.

### 2.1 Page-level behaviour

| What | Where | Note for widgets |
|---|---|---|
| Terms gate: redirect to `/consent` | `:95` | Stays before any widget renders. |
| `closeStaleOpenSessions()` sweep | `:98` | Stays page level. It must run once, not once per widget. |
| Today in the user's zone, week dates | `:101-108` | Shared by several widgets. Compute once into a home context. |
| `getActiveCycleForUser()` | `:111` (`src/lib/actions/training-cycles.ts:146`) | Read by Cycle, Today, Missed, Week. Wrap in React `cache()`. |
| One `Promise.all`: stats, sessions, insight, check-in, policy, endurance | `:116-123` | Splits per widget. |
| Fixed viewport: `h-[100dvh] ... overflow-hidden`; content `flex-1 ... overflow-hidden` | `:197`, `:205` | **The home does not scroll today.** The week card uses `flex-1` (`:332`, `:382`, `:447`) to fill the rest of the screen. Added and larger widgets need a scroll area (risk R2). |
| Title row "LogEveryLift" (`h1`) | `:200-202` | Becomes the `header` widget. `e2e/auth.setup.ts:35` and `e2e/consent.spec.ts:55` find this heading. |
| Bare skeleton | `src/app/loading.tsx` | Title only. Already finding B2 in `docs/ui-polish-audit.md`. |
| Bottom nav "Workout" tab: the open workout if any, else `/` | `src/components/ui/bottom-nav.tsx:115-117` | "Continue workout" stays reachable from the nav. "Start" lives only on home. |

### 2.2 Parts of the screen

| # | Part | Component and place | Data | Who sees it | How it goes away today | Critical |
|---|---|---|---|---|---|---|
| H1 | Title "LogEveryLift" | Inline `:200-202` | none | everyone | never | no |
| N1 | Policy update notice | `PolicyUpdateNotice` (`src/components/features/PolicyUpdateNotice.tsx:10`), `:207` | `needsPolicyNotice(session)` | users behind on the policy version | Dismiss writes `markPolicySeen` | no, but a legal notice |
| N2 | AI check-in | `AiCheckinCard` (`src/components/features/AiCheckinCard.tsx:14`), `:209` | `getPendingCheckin()` | users with a pending check-in | answer "fits" or "dismissed" | no |
| N3 | Sick or returning banner | `IllnessBanner` (`src/components/features/DidYouDoIt.tsx:120`), `:211` | `enduranceHome` | endurance switch on | "I'm better" | no |
| W1 | Cycle header (name, week x/y, bar, end date) | Inline `:215-224`, inside the today card | cycle info | users with an active cycle | never | no |
| W2 | **Today** (program, done chip, overdue chip, insight, sessions list, Start, Do Again, Different Program, Skip auto day) | Inline `:226-290`; `WorkoutInsightBanner` (`:244`), `TodaySessionsList` (`:247`), `SkipAutoDayButton` (`:274`) | today slot and sessions, completed dates, auto session, insight | users with an active cycle | never | **yes**: "Start Today's Workout" (`:271`), per-session starts |
| W3 | Endurance today | `EnduranceTodayCard` (`src/components/features/guided/EnduranceTodayCard.tsx:21`), `:294` | `sessionCompliance` for today, units | endurance switch on, with a structured session today | null with no rows (`:22`) | **yes** for endurance: the guided player starts here |
| N4 | Did you do these? and missed key sessions | `DidYouDoItCard` (`src/components/features/DidYouDoIt.tsx:23`), `:297` | unconfirmed and missed key sessions | endurance switch on | null when nothing is open (`:29`) | no, but it answers planned vs done |
| N5 | Missed this week, Make up, Decline | Inline `:299-328`, `DeclineMakeupButton` (`:321`) | `info.missedSlots` | day-of-week cycles with a missed day | setting `missedWorkoutsEnabled` (`src/db/schema/users.ts:46`, read in `src/lib/actions/training-cycles.ts:211-214`) | "Make up" starts a workout |
| W4a | Week strip and weekly goal ring | Inline `:330-378`, `WeeklyGoalProgress` (`:375`) | week dates, `homeWeekPlanned`, completed dates, `stats.thisWeekWorkouts`, `weeklyGoal` | day-of-week cycles | never | no |
| W4b | Rotation strip and goal ring | Inline `:380-403` | cycle slots, today slot, stats | rotation cycles | never | no |
| W1' | No-cycle preview with "Set up a Cycle" | Inline `:405-440` | none | users with no cycle | a cycle exists | no |
| W4c | No-cycle week strip and goal ring | Inline `:442-487` | completed dates, stats | users with no cycle | a cycle exists | no |
| P1 | Pinned "Start a Workout" bar | Inline `:491-502` | none | users with no cycle | a cycle exists | **yes**: the only start without a cycle |
| N6 | Share prompt | `SharePromptLoader` in `Suspense` (`:504-506`; `src/components/features/SharePromptLoader.tsx:5`) | `isSharePromptDue()`, friend code | due users | answered | no |

### 2.3 Planned for the home area

| Plan | What it adds | Kind |
|---|---|---|
| D4 readiness swaps (`docs/plans/triathlon-coach-plan.md:326-327`) | "Swap today's hard session for an easy one?" | notice |
| Garmin insights, advice on today's session (`docs/plans/garmin-insights-design.md:274`) | one line on today's session from readiness and phase | part of Today, or a notice |
| Web push and reminders (`docs/plans/web-push-and-reminders.md`) | an "enable reminders" prompt | notice |
| Endurance app, resume a guided run (`docs/plans/endurance-app.md:259`) | "Resume" on the endurance card | part of Endurance today |
| Garmin readiness today (`ReadinessCard`, `src/components/features/GarminTodayTab.tsx:97`) | only on `/more/garmin` now | widget |

### 2.4 Settings that touch home

- `missedWorkoutsEnabled` on `user` hides N5 and the rotation "days overdue" chip
  (`src/components/features/SettingsClient.tsx:309`).
- `weeklyGoal` is in **localStorage** through `ThemeProvider`
  (`src/components/ui/theme-provider.tsx:51`, `:72`, `:123`). It does not sync across devices.
- `useUserSettings()` (`src/contexts/user-settings-context.tsx:50`) is a small external store,
  not a context: a context provider in the root layout made the cacheComponents shell render
  each page twice (`docs/plans/foundations.md`, A2, "Client settings"). Any home edit-mode
  state must live inside the page, not in the root layout.

## 3. Design: one registry, four kinds

| Kind | Members | Placement | Can the user... |
|---|---|---|---|
| `header` | Title | Always first, full width | change size (M title, L title with date and cycle week), hide it. The `h1` stays in the DOM (visually hidden) when hidden. |
| `widget` | Cycle, Today, Endurance today, Week, Weekly goal, and all new widgets | The user's order | move, resize, hide, add. Today: move and resize only. |
| `notice` | N1 to N6, later D4 swaps and the push prompt | Under the header, above widgets, fixed order, only when they have content | nothing through the layout. Each keeps its own dismiss path and setting. |
| `pinned` | P1 | Above the bottom nav | nothing. It shows when the user has no cycle. |

Why notices are not user-placed: a notice exists because the app needs an answer (consent,
compliance, a check-in). If a user hides it once, the app loses that answer for good. Garmin
Connect users report this problem with "My Day": dismissed cards come back and the order
resets, and they read it as a bug (sources in section 10). Notices still use the same
registry, contract, loader and error guard as widgets.

Why "Missed this week" is a notice and not a widget: it already has its own on/off setting,
and "Make up" is a start entry. It stays where it is (open question 3).

## 4. Widget catalogue

Sizes: **S** = half width, about 160x150 px on a 375 px phone. **M** = full width, about S
height. **L** = full width, about twice as tall. A dash means the size is not offered.

Cost is the extra server work for one home load when the widget is visible: **none**, **low**
(one indexed query), **medium** (an aggregate or several queries; cache it), **high** (a large
read; only from stored series).

Phase: **1** = build now (section 6), **2** = next batch, **3** = later, **no** = do not build.

### 4.1 Training

| Widget | S | M | L | Data source (exists) | Who | Cost | Phase |
|---|---|---|---|---|---|---|---|
| Title (header) | - | "LogEveryLift" (default) | Title, date, cycle week | none | all | none | 1 |
| Cycle progress | Week x/y | Name, week, bar, end date (as the top of today's card) | - | `getActiveCycleForUser` | cycle | none (shared) | 1 |
| **Today** | Program and Start | Today card without the cycle header | Today card with the cycle header (default, as now) | as now | cycle | as now | 1 |
| Cycle setup (no cycle) | - | The no-cycle preview (default) | - | none | no cycle | none | 1 |
| Endurance today | - | Rows as now (default) | Rows with step summary | `sessionCompliance`, `answerSession` | endurance | as now | 1 |
| **Week** | - | Strip only | Strip and goal ring (default, as now) | as now; variants for day-of-week, rotation, no cycle | all | as now | 1 |
| Weekly goal | Ring and count | Ring and label | - | `getWorkoutStats`, `weeklyGoal` | all | none (shared) | 1 |
| Next session | Name and day | Name, day, short summary, start link | - | `getActiveCycleForUser`, planned sessions | cycle | low | 2 |
| Season phase | Phase, week x of y | Plus phase bar | - | `listSeasons` (`src/lib/seasons.ts:83`) | endurance with a season | low | 2 |
| Race countdown | Days to race | Race, date, days, phase | - | `listSeasons`; `training_cycles.race_date` | users with a race | low | 2 |
| Missed this week | - | - | - | notice N5 | | | 1 (notice) |
| Make-up | - | - | - | part of N5 | | | 1 (notice) |
| Did you do these? | - | - | - | notice N4 | | | 1 (notice) |
| Readiness swap | - | - | - | notice, package D4 | endurance | | with D4 |

### 4.2 Personal records

| Widget | S | M | L | Data source | Who | Cost | Phase |
|---|---|---|---|---|---|---|---|
| **Recent PRs** | Newest PR | Last 3 (default) | Last 6 | `getRecentPRs(limit)` (`src/lib/actions/metrics.ts:1160`) | lifter | low | 1 |
| PR of the week | Best PR this week | Plus the lift's trend line | - | `getRecentPRs`, filtered to the user's week | lifter | low | 2 |
| Near-PR alert | "1 rep from a PR on Bench" | Up to 3 lifts in today's program close to a PR | - | **new**: compare today's program targets to `exercise_prs` | lifter with a cycle | medium | 3 |

### 4.3 Stats

| Widget | S | M | L | Data source | Who | Cost | Phase |
|---|---|---|---|---|---|---|---|
| Training streak | Weeks in a row | Plus last 8 weeks | - | `getSummaryStats` (`src/lib/actions/metrics.ts:1369`, streak at `:1430`) | all | medium | 2 |
| Weekly volume | Sets this week | Top muscles vs target | All muscle bars | `getWeeklyMuscleVolume` (`src/lib/actions/metrics.ts:1113`) | lifter | medium | 2 |
| Body weight | Latest and change | 30-day line | 90-day line | `getWeightHistory` (`src/lib/actions/profile.ts:65`) | users who log weight | low | 2 |
| Consistency | Weeks goal met, last 8 | Heatmap, 12 weeks | Heatmap, 26 weeks | `getHeatmapData` (`src/lib/actions/metrics.ts:1083`) | all | medium | 2 |
| Compliance | Planned vs done this week | Per sport | - | `sessionCompliance` (`src/lib/session-compliance.ts:217`) | endurance | medium | 2 |
| Summary totals | Workouts, sets | Workouts, sets, reps | - | `getWorkoutStats` | all | none (shared) | 3 |

### 4.4 Garmin (admins only today, `garminAllowed`)

Garmin access is on only for admin accounts where the key is set
(`src/lib/garmin/access.ts:15-17`). Each Garmin widget has `available: garminAllowed(role)`,
and an empty state "Connect Garmin" when there is no connection.

| Widget | S | M | L | Data source | Cost | Phase |
|---|---|---|---|---|---|---|
| **Readiness** | Score and word | Score with contributor bars (default) | - | `getTodayData(...).metrics`; view `ReadinessCard` (`src/components/features/GarminTodayTab.tsx:97`) | medium (stored daily series) | 1 |
| HRV | Last night vs baseline | 7-day dots | - | `getTodayData` (`hrvNight`, `metrics`) | medium | 2 |
| Sleep | Hours and score | Stages bar | 7 nights | `getTodayData(...).sleep`; `getSleepData` (`src/lib/garmin/queries.ts:317`) | medium | 2 |
| Body battery | At wake and now | High, low, charged, drained | - | `getTodayData(...).summary.bb*` | medium | 2 |
| Training load and form | Form and band | 6-week fitness, fatigue, form | Per sport | `getLoadSeries` (`src/lib/garmin/queries.ts:50`); without Garmin, `getTrainingLoad` (`src/lib/training-load.ts:149`) | medium | 2 |
| Today's activity | Steps | Steps, active kcal, intensity min, today's activities | - | `getTodayData(...).summary`, `.activities` | medium | 2 |
| VO2 max | Latest value | 180-day line | - | `getOverviewData` (`src/lib/garmin/queries.ts:638`, VO2 rows at `:660-668`) | medium | 3 |
| Recent activities | Last one | Last 3 | Last 6 | `getActivitiesData(userId, limit)` (`src/lib/garmin/queries.ts:389`) | low | 2 |
| Race predictor | Projected time | Projection and checklist | - | `getRaceProjection` (`src/lib/garmin/queries.ts:1050`) | high (uses the load series) | 3 |

Training load without Garmin also exists for endurance users (`getTrainingLoad`), so that
widget can serve both groups with one view.

### 4.5 Friends

Friend data is another person's data. Every friends widget must read through the existing
friend actions, which already filter on `users.showActivityToFriends`
(`src/lib/actions/friends.ts:317`, `:347`, `:433`), and must never query `workout_sessions`
of other users directly. Widgets show names, program name, date and set count. They do not
show `feeling` or notes, even where the friends page might.

| Widget | S | M | L | Data source | Who | Cost | Phase |
|---|---|---|---|---|---|---|---|
| **Friends' activity** | Newest friend workout | Last 3 (default), with react button | Last 6 | `getFriendsActivityFeed` (`src/lib/actions/friends.ts:400`, 14 days) | users with friends | medium | 1 |
| Reactions to my workouts | Count this week | Last 3 reactions | - | `getReactionsToMyWorkouts` (`:992`) | users with friends | low | 2 |
| Friends' streaks | Top streak | Top 3 friends by streak, worked out today | - | `getFriends` (`:293`) | users with friends | medium | 2 |
| Weekly leaderboard | My place | Top 5 | - | `getFriendsLeaderboard` (`:747`) | users with friends | medium | 3 (its week start uses the server's clock, `:752-756`, not the user's zone; fix first) |

Empty state for all: "Add friends to see their workouts" with a link to `/more/friends`.

### 4.6 Quick actions

| Widget | S | M | L | Data source | Who | Cost | Phase |
|---|---|---|---|---|---|---|---|
| Start a workout | "New workout" button | Plus "Different program" | - | none; link `/new-workout` | all | none | 2 |
| Quick start | One favourite program | Two or three programs | - | programs list | lifter | low | 3 (second start entry; needs its own e2e) |
| Log body weight | Number field and Save | Plus last value | - | `logWeightEntry` (`src/lib/actions/profile.ts:91`) | all | none | 2 |
| Quick log (run or quick workout) | Button | - | - | the C2b quick workout when it exists | all | none | 3 |
| Rest timer | - | - | - | - | - | - | **no**: the rest timer belongs to an open workout and is on the workout screen; the nav dot already marks an open workout. A home copy adds a second entry to a critical flow. |

### 4.7 Coach

| Widget | S | M | L | Data source | Who | Cost | Phase |
|---|---|---|---|---|---|---|---|
| Coach memory note | - | One entry the user pins | - | `listCoachMemory` (`src/lib/coach-memory.ts:40`); setting holds the entry id, never the text | users with entries | low | 3 |
| AI changes feed | Count this week | Last 3 changes with undo link | - | `getAssistantChanges` (`src/lib/actions/plan-revisions.ts:187`) | users with a connected assistant | low | 2 |

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **The user hides the way to start a workout.** | Today has `hideable: false`. `resolveLayout` and the Server Action's schema both refuse a hidden Today. The no-cycle start stays a pinned bar. Tests for each. |
| R2 | **The home stops being one screen.** It is a fixed `100dvh` view that never scrolls, and the week card stretches to fill it. | The content area becomes `overflow-y-auto`. The last widget keeps its `flex-1` stretch when its def says `stretch: true` (Week), so the default home looks the same. Screenshots in both themes at 375x667 and 430x932, before and after. |
| R3 | **Hydration errors.** `toLocale*` and `Intl` in client labels differ between server and browser; React #418 has failed on Linux WebKit before (`e2e/finish-reload.spec.ts:8`, `e2e/guided-workout.spec.ts:80`). | Widgets are Server Components and pass formatted strings to client parts. Edit-mode labels are static. The e2e fixture fails on page exceptions. |
| R4 | **Drag on touch fights scroll.** | Drag only from a handle with `touch-none`, 8 px activation. Move up and down buttons are the main touch path. |
| R5 | **Server cost.** | Hidden widgets cost nothing. Shared reads use `cache()`. The default layout must add no query over today's page. Garmin widgets read the stored daily series. |
| R6 | **One widget fails and takes the page down.** An RSC error inside `Suspense` goes to `error.tsx`. | Every loader runs through `safeLoad` (6.4), which logs `[homeWidget] load_failed` with the widget id and returns an error state. |
| R7 | **Critical-flow regression from the page rewrite.** `e2e/cycle-day.spec.ts`, `e2e/did-you-do-it.spec.ts`, `e2e/guided-workout.spec.ts`, `e2e/planned-sessions.spec.ts` open home. | Move JSX into widget components unchanged. Those specs must pass unchanged. |
| R8 | **Two devices save different layouts.** | Last write wins. Low value data. |
| R9 | **Friend data leak.** | Friends widgets use only the existing friend actions (4.5). An integration test: a friend with `showActivityToFriends = false` never shows. |
| R10 | **The header heading disappears for tests and screen readers.** | When the user hides the title, the `h1` stays as `sr-only`. Check `e2e/auth.setup.ts:35` still passes with the default layout (it does: the title is visible by default). |
| R11 | **Bundle growth.** `docs/plans/garmin-insights-design.md:501` asks that the home and workout bundles do not grow. | Widgets are Server Components. Charts are plain SVG. Only `HomeGrid`, the toolbar and the gallery sheet ship as client code, and @dnd-kit is already in the app bundle. |

## 6. Build brief

This section is written to be built in a fresh session. Read `CLAUDE.md`, `TESTING.md`, and
sections 2 to 5 above first. Trust the code over this text if they disagree, fix this doc in
the same PR, and say so in the PR body.

### 6.1 Packages

| PR | Scope | Schema | Critical flow |
|---|---|---|---|
| **1a** | Registry, layout model, column and migration, Server Action, page rewrite into widgets (all of today's home), `HomeGrid` with edit mode: reorder, resize, hide, show, Cancel, Undo, Reset | yes | yes (home start entries) |
| **1b** | Gallery sheet ("Add widget"), versioning (`seen`, `since`), and the first three new widgets: Recent PRs, Friends' activity, Garmin readiness | no | no |
| 2 | Catalogue rows marked phase 2, in batches of 3 to 5 widgets per PR | no | no |
| 3 | Rows marked phase 3, after the open questions on them are settled | maybe | Quick start: yes |

1a and 1b are the phase 1 asked for now. 1a ships alone because it changes the home for
every user; 1b only adds.

### 6.2 Phase 1 widget set

| id | Kind | Sizes (default) | Hideable | Default visible | Source of the view |
|---|---|---|---|---|---|
| `title` | header | M, L (M) | yes (h1 stays sr-only) | all | `:200-202` |
| `policy` | notice | - | no | when due | `PolicyUpdateNotice` |
| `checkin` | notice | - | no | when pending | `AiCheckinCard` |
| `illness` | notice | - | no | endurance, when sick or returning | `IllnessBanner` |
| `didYouDoIt` | notice | - | no | endurance, when open | `DidYouDoItCard` |
| `missed` | notice | - | setting `missedWorkoutsEnabled` | day-of-week, when missed | `:299-328` |
| `share` | notice | - | no | when due | `SharePromptLoader` |
| `cycle` | widget | S, M (M) | yes | **no** (Today L already shows it) | `:215-224` |
| `today` | widget | S, M, L (L) | **no** | cycle users | `:213-291` |
| `cycleSetup` | widget | M (M) | yes | no-cycle users | `:405-440` |
| `enduranceToday` | widget | M (M) | yes | endurance | `EnduranceTodayCard` |
| `week` | widget | M, L (L) | yes | all | `:330-403`, `:442-487` (three variants) |
| `weeklyGoal` | widget | S, M (S) | yes | **no** (Week L already shows it) | `WeeklyGoalProgress` |
| `startBar` | pinned | - | no | no-cycle users | `:491-502` |
| `recentPrs` (1b) | widget | S, M, L (M) | yes | **no** | new view; `getRecentPRs` |
| `friendsActivity` (1b) | widget | S, M, L (M) | yes | **no** | new view; `getFriendsActivityFeed` |
| `garminReadiness` (1b) | widget | S, M (M) | yes | **no**; `available` only with `garminAllowed` | `ReadinessCard` |

The default layout, by user type (this order is today's page order):

| User | Default widgets in order |
|---|---|
| Lifter, cycle | title M, today L, week L |
| Endurance, cycle | title M, today L, enduranceToday M, week L |
| No cycle | title M, cycleSetup M, week L (no-cycle variant), plus `startBar` |
| Endurance, no cycle | title M, cycleSetup M, enduranceToday M, week L, plus `startBar` |

Today S: program name and the primary start button only. Today M: the card without the cycle
header. Today L: the card as now. Week M: the strip only. Week L: strip and goal ring, as now.
Rotation and no-cycle variants follow the same rule.

### 6.3 Data model and migration

Schema, `src/db/schema/users.ts`, next to the other display settings:

```ts
// The user's home screen layout (docs/home-widgets-audit.md). Null means the
// default for their user type, computed in src/lib/home/layout.ts. Only order,
// size, hidden and per-widget options; never free text.
homeLayout: jsonb("home_layout").$type<StoredHomeLayout>(),
```

Migration: run `pnpm db:generate`, answer "create column". The SQL is one line:

```sql
ALTER TABLE "user" ADD COLUMN "home_layout" jsonb;
```

It is nullable with no default, so it rewrites no rows and needs no backfill. Commit the
SQL and the `drizzle/meta/` snapshot with the schema change.

Rollback:
- **Code rollback** (revert the PR): safe without touching the database. Old code never
  reads the column. Users who saved a layout get the old home back, and get their layout back
  if the PR is re-applied.
- **Schema rollback** (only if the column must go): drizzle has no down migrations, so write a
  new forward migration `ALTER TABLE "user" DROP COLUMN IF EXISTS "home_layout";` in a later
  PR, after the code that reads it is gone. Saved layouts are lost; nothing else is.

Stored JSON:

```ts
type StoredHomeLayout = {
  v: 1;              // shape version of this JSON
  seen: number;      // REGISTRY_VERSION the user last saved against
  items: { id: string; size: "s" | "m" | "l"; hidden: boolean; settings?: Record<string, unknown> }[];
};
```

Only `header` and `widget` kinds appear in `items`. Notices and pinned parts are never stored.

### 6.4 Registry and widget contract

`src/lib/home/widgets.ts` (*new*): pure data, no React, so the reducer, the Server Action,
MCP and the tests can import it.

```ts
export const REGISTRY_VERSION = 1;

export type WidgetSize = "s" | "m" | "l";
export type WidgetKind = "header" | "widget" | "notice" | "pinned";
export type WidgetGroup = "training" | "prs" | "stats" | "garmin" | "friends" | "actions" | "coach";

export type Audience = {
  endurance: boolean;          // enduranceEnabledFor(userId)
  garmin: boolean;             // garminAllowed(role)
  cycle: "day_of_week" | "rotation" | null;
};

export type WidgetDef = {
  id: WidgetId;                // stable, never reused; retired ids stay listed in RETIRED_IDS
  kind: WidgetKind;
  group: WidgetGroup;
  title: string;               // edit mode and gallery label
  description: string;         // one line in the gallery
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  hideable: boolean;           // false for today
  stretch?: boolean;           // may fill leftover height when last (week)
  available: (a: Audience) => boolean;     // false: never rendered, not in the gallery
  defaultVisible: (a: Audience) => boolean;
  since: number;               // REGISTRY_VERSION that added it
  settings?: z.ZodType;        // per-widget options; ids and numbers only, never free text
};

export const WIDGETS = { title: {...}, today: {...}, ... } satisfies Record<WidgetId, WidgetDef>;
```

`src/components/features/home/render.tsx` (*new*): the render map. Its type is
`Record<WidgetId, WidgetRender>`, so a registry id without a view fails `tsc`.

```ts
export type HomeContext = {
  userId: string;
  role: string | null;
  today: Date;                 // userToday()
  todayStr: string;
  weekDates: string[];
  audience: Audience;
};

export type WidgetRender<D = unknown> = {
  load: (ctx: HomeContext, settings: unknown) => Promise<D | null>;  // null = empty state
  View: (p: { data: D; size: WidgetSize; settings: unknown }) => React.ReactNode;
  Empty: (p: { size: WidgetSize }) => React.ReactNode;  // one line and a link; never renders nothing
  Skeleton: (p: { size: WidgetSize }) => React.ReactNode;  // the real height for that size
};
```

States every widget has:

| State | Rule |
|---|---|
| Loading | `Skeleton` for the stored size, in the widget's own `Suspense`. Same height as the real view (fixed heights for new widgets: S and M `h-36`, L `h-72`; today's widgets keep their current geometry). |
| Empty | `load` returns `null`. `Empty` shows one line and a link ("No PRs yet. Log a workout."). Notices are the exception: a notice with no data renders nothing. |
| Error | `safeLoad(id, fn)` (in `src/lib/home/safe-load.ts`) catches, logs `console.error("[homeWidget] load_failed", { id, error: e.name })` (ids only, per `CLAUDE.md`), and the widget shows "Couldn't load this." with no stack and no user data. |
| Data | `View`. Server Component. Any client part gets formatted strings only (no `Intl` or `toLocale*` on the client). Every tap target 44x44. Tap feedback with `:active`. Theme tokens only. Links to the full page (`/more/metrics`, `/more/garmin`, `/more/friends`). |
| Permission | `available(audience)` gates render and the gallery. `load` still filters by `ctx.userId` in every query, or calls an existing action that does (`requireSession` inside). Never a `userId` from the client. |

A widget does not render while the user is in edit mode with a hidden state; edit mode shows
hidden widgets as a title row only, so no load runs for them.

### 6.5 How to add a widget (the recipe)

One widget is one PR of about five files. Nothing else in the home changes.

1. **Registry.** Add the id to `WidgetId` and an entry to `WIDGETS` in
   `src/lib/home/widgets.ts`. Bump `REGISTRY_VERSION` by one and set `since` to the new value.
   Set `defaultVisible` to `() => false` unless the owner asked for it on every home.
2. **Loader.** `src/lib/home/loaders/<id>.ts`: `load(ctx, settings)`. Reuse an existing query
   or action; filter by `ctx.userId`; return a small serializable shape or `null`. Shared reads
   go through the `cache()` helpers in `src/lib/home/context.ts`.
3. **View.** `src/components/features/home/widgets/<Name>Widget.tsx`: `View`, `Empty`,
   `Skeleton` for each size in `sizes`.
4. **Render map.** One line in `src/components/features/home/render.tsx`.
5. **Gallery preview.** A static preview per size (no data) in the same file as the view.
6. **Tests.**
   - Unit: the loader's shaping, if it does more than pass rows through
     (`src/__tests__/home-widgets/<id>.test.ts`).
   - Component: `View` at each size, `Empty`, and the error state
     (`src/__tests__/components/home-widgets.test.tsx`, one `describe` per widget).
   - Integration: only if the loader adds new SQL; include an ownership check (another
     user's rows never appear).
   - e2e: none per widget. `e2e/home-widgets.spec.ts` loops over the registry and adds every
     widget available to the e2e user, at each size, and fails on any console error.
7. **Privacy.** If the widget shows a kind of data the home did not show before, or another
   person's data, run the `privacy-compliance` skill. Most widgets show data the user can
   already see elsewhere in the app and need no inventory change.
8. **Docs.** Add the row to section 4 of this doc, or move it to phase "done".

### 6.6 Layout resolution, defaults and versioning

`src/lib/home/layout.ts` (*new*), pure functions:

- `defaultLayout(audience)`: the table in 6.2, as a `ResolvedLayout`.
- `parseStoredLayout(json)`: Zod. Bad JSON gives `null` and logs `[homeLayout] invalid`
  with the user id.
- `resolveLayout(stored, audience)`: returns the list to render, in order.
  - `stored === null`: `defaultLayout(audience)`.
  - Drop unknown and retired ids. Drop duplicates (keep the first).
  - A size not in `sizes` falls back to `defaultSize`.
  - `today` hidden: set visible. `today` missing: insert it first after `title`.
  - Widgets with `since > stored.seen` that are not in `items`: append as `hidden: true`, so
    the gallery can mark them "New". New things never appear on a home the user arranged.
  - Widgets whose `available` is false are filtered from the result but kept in the stored
    list on the next save (`mergeForSave`), so they come back if the audience changes (the
    endurance switch goes on again).
- **Existing users:** no data migration. Every row is `null`, which renders the default,
  which is today's page. A characterization test (section 7) proves it per user type.
- **Default is code.** Never write the default into the column. Reset writes `null`.

### 6.7 Server Action

`src/lib/actions/home-layout.ts` (*new*), copied from the canonical template in `CLAUDE.md`:

```ts
export async function saveHomeLayout(data: unknown): Promise<ActionResult<null>>
```

- `requireSession()`, then Zod: `{ layout: StoredHomeLayout | null }`. The schema is built
  from the registry: ids must be known, sizes allowed, `today` not hidden, settings parsed by
  each widget's own schema, at most 60 items.
- `db.update(users).set({ homeLayout }).where(eq(users.id, auth.user.id))`.
- `revalidatePath("/")`.
- Errors: `console.error("[saveHomeLayout] failed", { userId })`, return
  `{ success: false, error: "Couldn't save your home layout" }`.
- Client calls it through `callAction()` (`src/lib/utils/stale-bundle.ts`). It does **not**
  go through the offline replay queue: a lost layout save loses no training data, and
  replaying an old layout over a newer one from another device is worse.

### 6.8 Rendering

```
src/app/page.tsx (Server)
  requireSession, consent gate, closeStaleOpenSessions
  ctx = homeContext(session)              today, week, audience
  layout = resolveLayout(await getHomeLayout(userId), ctx.audience)
  <HomeShell>                             fixed header area + scroll area
    <HeaderWidget size>                   or sr-only h1 when hidden
    <Notices ctx/>                        each notice in its own Suspense
    <HomeGrid layout={layout} defs={...}> Client: rows, edit mode, dnd
      {layout.map(item =>
        <Suspense key=item.id fallback={<Skeleton size/>}>
          <WidgetSlot id size settings ctx/>   async: safeLoad + View/Empty/error
        </Suspense>)}
    </HomeGrid>
    "Edit home" button at the end of the list
  </HomeShell>
  <StartBar/> when no cycle
  <SharePromptLoader/> as now
```

- `HomeGrid` is a Client Component. It receives the server-rendered widgets as children,
  keyed by id, and the layout list. Edit mode moves and wraps them; it never refetches.
- Rows: consecutive S widgets pair into a two-column row. A lone S takes half a row; edit
  mode shows the empty half as a dashed slot. M and L take a full row. No CSS grid `dense`
  packing: visual order must equal DOM order for screen readers and dnd.
- `getHomeLayout(userId)` in `src/lib/home/layout-read.ts`: React `cache()`, one indexed read
  of `user.home_layout`. Keep it out of `getUserSettings`, which many pages call.
- `src/lib/home/context.ts`: `homeContext()`, plus `cache()` wrappers for shared reads:
  `activeCycle()`, `weekSessions()` (from `getCompletedSessions(monday)`), `workoutStats()`,
  `enduranceHome()` (moved out of `page.tsx:68-89`).
- `src/app/loading.tsx`: draw the lifter default layout's skeletons (title, today L, week L).
  This also closes `docs/ui-polish-audit.md` B2.
- Resizing in edit mode shows the new size's skeleton until Done; Done saves, revalidates,
  and the server renders the new size. Do not render every size up front.

### 6.9 Edit mode UX

1. **Enter.** An "Edit" text button at the right of the title row (44x44), and an "Edit
   home" button at the end of the list, which stays when the title is hidden. No long-press
   in phase 1: on home a long press lands on links, fights with scroll, and on iOS opens the
   link preview.
2. **In edit mode:**
   - The title row shows "Cancel" left and "Done" right.
   - Notices hide while editing.
   - Each widget gets a dashed `border-border` outline and a toolbar row above its content:
     drag handle, title, size control (segmented S/M/L, only the allowed sizes), "Move up",
     "Move down", and a minus button (hide). Today shows a lock icon in place of the minus,
     with the label "Today can't be hidden". Each control is 44x44, which is why the toolbar is
     its own row and not laid over an S widget (about 160 px wide).
   - Widget content is `inert`. Links and buttons inside do nothing.
   - Hidden widgets list under the grid in a "Hidden" section, each with a plus button.
   - A pinned bottom bar above the nav: "Add widget" (1b), "Undo", "Reset".
3. **Reorder.** @dnd-kit `DndContext` and `SortableContext` with `rectSortingStrategy`.
   Sensors as `src/components/features/WorkoutExerciseList.tsx:66-71`: `PointerSensor` with
   `activationConstraint: { distance: 8 }`, and `KeyboardSensor` with
   `sortableKeyboardCoordinates`. Drag listeners on the handle only, which has `touch-none`.
   Screen reader announcements name the widget title and position ("Week moved to position
   2 of 4").
4. **Move without dragging.** "Move up" and "Move down" are the single-pointer alternative
   WCAG 2.2 SC 2.5.7 requires; keyboard support alone does not meet it. e2e tests use them.
5. **Resize.** Tap a size. The widget shows that size's skeleton.
6. **Hide and show.** Minus moves the widget to "Hidden". Plus puts it back at its old place
   and size.
7. **Add (1b).** "Add widget" opens a bottom sheet with the app's sheet pattern. It lists
   available widgets that are not visible, grouped by `group`, each with a static preview, its
   sizes, a "New" mark when `since > seen`, and "Add". Add puts it last at `defaultSize` and
   scrolls to it.
8. **Undo.** The reducer keeps a history stack for the edit session. Undo steps back once.
9. **Reset.** Confirm "Reset home to the default layout?", then save `null`.
10. **Done.** `saveHomeLayout` through `callAction()`. Success: leave edit mode. Failure: stay,
    keep the draft, show the error. Offline: "You're offline. Try again when connected."
11. **Cancel.** Drop the draft. If there are changes, ask "Discard changes?".

Look: theme tokens only (`bg-muted`, `border-border`, `text-muted-foreground`,
`ring-primary`), so light and dark need no extra work. No wobble animation. dnd-kit's own
transform during drag. Entering edit mode adds toolbars above widgets; keep the widget the
user was looking at in place by scrolling by the added height (`scrollIntoView({ block:
"nearest" })` on the first visible widget).

State: `src/lib/home/layout-reducer.ts` (*new*, pure): actions `move`, `moveUp`, `moveDown`,
`resize`, `hide`, `show`, `add`, `reset`, `undo`. `HomeGrid` uses it with `useReducer`.
No context provider in the root layout (see 2.4).

### 6.10 Files

Create:

| File | What |
|---|---|
| `src/lib/home/widgets.ts` | registry, types, `REGISTRY_VERSION`, `RETIRED_IDS` |
| `src/lib/home/layout.ts` | `defaultLayout`, `parseStoredLayout`, `resolveLayout`, `mergeForSave`, Zod schemas |
| `src/lib/home/layout-reducer.ts` | edit reducer |
| `src/lib/home/layout-read.ts` | `getHomeLayout` (cached read) |
| `src/lib/home/context.ts` | `homeContext`, shared `cache()` reads, `enduranceHome` moved from the page |
| `src/lib/home/safe-load.ts` | `safeLoad` |
| `src/lib/home/loaders/*.ts` | one per widget that needs more than the shared reads |
| `src/lib/actions/home-layout.ts` | `saveHomeLayout` |
| `src/components/features/home/render.tsx` | render map |
| `src/components/features/home/HomeGrid.tsx` | client: rows, edit mode, dnd |
| `src/components/features/home/WidgetToolbar.tsx` | client: handle, size, move, hide |
| `src/components/features/home/WidgetGallerySheet.tsx` (1b) | client: add sheet |
| `src/components/features/home/Notices.tsx` | the six notices, each in `Suspense` |
| `src/components/features/home/widgets/TitleWidget.tsx` | header |
| `src/components/features/home/widgets/CycleWidget.tsx` | cycle progress |
| `src/components/features/home/widgets/TodayWidget.tsx` | the today card, moved unchanged, plus S and M |
| `src/components/features/home/widgets/CycleSetupWidget.tsx` | no-cycle preview, moved |
| `src/components/features/home/widgets/EnduranceTodayWidget.tsx` | wraps `EnduranceTodayCard` |
| `src/components/features/home/widgets/WeekWidget.tsx` | three variants, moved, plus M |
| `src/components/features/home/widgets/WeeklyGoalWidget.tsx` | wraps `WeeklyGoalProgress` |
| `src/components/features/home/widgets/RecentPrsWidget.tsx` (1b) | new |
| `src/components/features/home/widgets/FriendsActivityWidget.tsx` (1b) | new |
| `src/components/features/home/widgets/GarminReadinessWidget.tsx` (1b) | reuses `ReadinessCard` |
| `src/components/features/home/StartBar.tsx` | pinned bar, moved |
| `drizzle/<next>_home_layout.sql` and `drizzle/meta/*` | generated |
| tests in section 7 | |

Change:

| File | Change |
|---|---|
| `src/db/schema/users.ts` | `homeLayout` column |
| `src/app/page.tsx` | becomes the shell in 6.8 (well under 150 lines) |
| `src/app/loading.tsx` | default-layout skeletons |
| `src/lib/mcp/tools/profile.ts` | `get_profile` returns `homeLayout`: visible widget ids and sizes, resolved; update the description |
| `docs/privacy/data-inventory.md` | Settings row: add `home_layout` |
| `docs/plans/README.md` | status of this brief |
| `CLAUDE.md` | smoke pass step 2 still checks the "LogEveryLift" header; add one line under step 3: "Edit home, move Week up, Done, reload, order kept" |

Do not change: `WorkoutSetsList`, timers, set editing, or the workout routes.

### 6.11 Acceptance criteria

1a:
- A user who never edits sees the same home as before, for each user type in 6.2, in light
  and dark, at 375x667 and 430x932. Screenshots before and after in the PR.
- Today cannot be hidden through the UI, the Server Action, or a hand-written JSON value.
- Order, size and hidden state persist across reload and across two browser contexts.
- A loader that throws shows "Couldn't load this." in that widget only.
- Reorder works with drag (Chromium, WebKit), with Move up and down, and with the keyboard.
- Every edit-mode control is at least 44x44 and has an accessible name.
- The default layout runs no more queries than today's page (count in the integration test
  or a query log in the PR).
- Existing home specs pass unchanged. `pnpm verify`, `make e2e`, smoke pass green.

1b:
- The gallery lists only widgets `available` for the user, grouped, with "New" marks.
- Recent PRs, Friends' activity and Garmin readiness render data, empty and error states at
  each size.
- Garmin readiness never appears for a non-admin, in the grid or the gallery.
- A friend with `showActivityToFriends = false` never appears in Friends' activity.
- The home JS bundle grows only by `HomeGrid`, the toolbar and the sheet (no chart library).

## 7. Test plan

Per `TESTING.md`: pick the layer by what can break. Home is the entry to critical flows, so
1a ships with an e2e spec, and the bug-fix rule (failing test first) applies to fixes found
on the way.

| Layer | File (*new*) | Test | PR |
|---|---|---|---|
| Unit | `src/__tests__/home-layout.test.ts` | `resolveLayout`: null gives the default per user type; unknown and retired ids dropped; duplicate dropped; bad size falls back; hidden Today made visible; missing Today inserted; `since > seen` appended hidden; unavailable widget filtered but kept by `mergeForSave` | 1a |
| Unit | same | **Characterization:** for the four user types in 6.2, the default renders the same parts in the same order as today's page | 1a |
| Unit | `src/__tests__/home-layout-reducer.test.ts` | move, moveUp and moveDown at the ends, hide, show to the old place, resize to a disallowed size refused, add, undo stack, reset | 1a |
| Unit | `src/__tests__/home-widgets-registry.test.ts` | every id has a render entry (also `tsc`); every `defaultSize` is in `sizes`; `today.hideable === false`; ids unique; no id in both `WIDGETS` and `RETIRED_IDS` | 1a |
| Component | `src/__tests__/components/home-grid.test.tsx` | Edit shows toolbars; content is `inert`; Cancel restores; Done calls the action once; a failed save keeps edit mode and the draft; keyboard reorder and the announcement text | 1a |
| Component | `src/__tests__/components/home-widgets.test.tsx` | each widget's View at each size, Empty, error state; Today S still has "Start Today's Workout" with the right `href` | 1a, 1b |
| Integration | `src/__tests__/integration/home-layout.test.ts` | `saveHomeLayout` writes only the caller's row; refuses hidden Today, unknown id, bad size, free-text settings; `null` resets; the column is in `collectUserData`; Friends' activity loader leaves out a friend with activity hidden; Garmin loader returns nothing for a non-admin | 1a, 1b |
| e2e | `e2e/home-layout.spec.ts` | Edit, Move up on Week, hide Weekly goal, resize Today to M, Done, reload: state persists (check with `testDb()`); "Start Today's Workout" still starts the workout; Reset restores the default. WebKit and Chromium | 1a |
| e2e | `e2e/home-widgets.spec.ts` | add each available widget from the gallery at each size; no console errors; reload persists | 1b |
| e2e | existing | `cycle-day`, `did-you-do-it`, `guided-workout`, `planned-sessions`, `consent`, `auth.setup` pass unchanged | every PR |

Then `pnpm verify`, `make e2e`, and the 9-step smoke pass in `CLAUDE.md`.

## 8. Privacy and MCP

### 8.1 Privacy steps

Storage choice: **`user.home_layout`**, not localStorage and not a new table.

| Option | For | Against |
|---|---|---|
| Column on `user` (chosen) | Syncs across devices. The server renders the right layout on first paint: no flash, no hydration risk. `collectUserData` selects the whole `user` row (`src/lib/account-data.ts:74`), so export and deletion need no new code. | A migration. |
| New table | Clean for per-device layouts. | Must join the export list and the cascade test. No current need. |
| localStorage | No migration, works offline. | No sync; first paint shows the default, then jumps; not in the export; `clearLocalUserData` removes it on sign-out. `weeklyGoal` already shows the cost. |

Steps in PR 1a:
1. Run the `privacy-compliance` skill (new column with user data).
2. `docs/privacy/data-inventory.md`, Settings row: add `home_layout` (which home widgets the
   user shows, in which order and size). Legal basis Art. 6(1)(b), retention until deletion,
   like `distanceUnit`. It is a display preference, not health data by itself.
3. No new browser storage, no new recipient, so no policy text change and no `LEGAL_VERSION`
   bump. Confirm with the skill.
4. Widget settings hold ids and numbers only, never free text (the Zod schema enforces it).
5. Friends widgets (1b): no new data flow. They show data the Friends page already shows,
   through the same filtered actions. Confirm with the skill that showing it on home needs no
   policy change.

### 8.2 MCP decision

**Read only.**

- `get_profile` (`src/lib/mcp/tools/profile.ts:22`) adds `homeLayout`: the resolved list of
  visible widget ids and sizes. It tells the coach what the user watches (for example body
  weight or readiness). One field, no new tool.
- **No write tool.** The layout is the user's own space. A coach that rearranges it would
  surprise the user, would need the revisions and undo machinery (A4) for a low-value change,
  and could only make the start path worse. If the coach thinks a widget would help, it says
  so in chat. If a coach feature must put something on home, it is a notice (like the AI
  check-in), not a layout change.

## 9. Open questions

| # | Question | Recommendation |
|---|---|---|
| 1 | Can the user hide Today? | No. Move and resize only. It is the only start for a planned workout. |
| 2 | Can the user hide the title row? | Yes. The `h1` stays for screen readers, and "Edit home" stays at the end of the list. |
| 3 | Can the user hide or move notices (policy, check-in, sick, "Did you do these?", missed, share)? | No. They keep their own dismiss paths. "Missed this week" keeps its existing setting. |
| 4 | Where is the layout stored? | `user.home_layout jsonb`; null means default. |
| 5 | May the home scroll? | Yes, it must once widgets can grow. The default still fits one screen. |
| 6 | Do new widgets appear on homes users already arranged? | No. They appear in the gallery with a "New" mark. Users with the default layout get a new widget only if we change the default. |
| 7 | Phase 1 new widgets: Recent PRs, Friends' activity, Garmin readiness. Visible by default? | No, hidden by default, so 1a and 1b change nobody's home. Owner may opt in for himself. |
| 8 | Move `weeklyGoal` from localStorage into the account? | Yes, in phase 2, as a setting of the Weekly goal widget, read from localStorage once as the start value. |
| 9 | Rest timer widget? | No. It belongs to an open workout. |
| 10 | Quick start (favourite programs) widget? | Phase 3, with its own e2e spec, since it is a second start entry. |
| 11 | Should the AI coach change the layout? | No. Read only through `get_profile`. |
| 12 | Long-press to enter edit mode? | Not in phase 1. Revisit after use. |
| 13 | One layout per account, or per device? | One per account. |
| 14 | Endurance users: endurance today above the strength card by default? | Not now. Keep today's order so nothing changes; revisit with the owner's own use. |
| 15 | Weekly leaderboard widget? | Only after `getFriendsLeaderboard` uses the user's week, not the server's (`src/lib/actions/friends.ts:752-756`). |

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
