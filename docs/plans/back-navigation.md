# Back navigation: Back goes where you came from

Status: built on `fix/back-navigation` (2026-11-14). Section 2 is the audit of `main` before the
change; sections 3 to 6 describe what was built.

## 1. The problem

Every back control was a hand-drawn `<Link href={parent}>` with a fixed label. A page reachable from
more than one place always went "back" to one fixed parent. The owner's case: home > Body weight
widget > Progress (`/more/metrics`) showed "< More" and went to `/more`.

Back was also a push, not a pop. After home > Progress > "< More", the iOS edge swipe (a real
history pop) went to Progress, not to home, so Back and the swipe disagreed.

## 2. Audit of main before the change

<!-- doc-claims: skip -->

"Multi" = reachable from more than its back target. Branch = only on `feat/home-redesign`.

| Route | Back control | Target / label before | Inbound in-app links | Multi |
|---|---|---|---|---|
| `/more/metrics` (Progress) | `MetricsClient` | `/more` "More" | More list; home Recent PRs (`?tab=records`); `/more/prs` redirect; Branch: Body weight, Streak, Weekly sets | Yes |
| `/more/calendar` | page | `/more` "More" | More list; home Week widget | Yes |
| `/more/friends` | page | `/more` "More" | More list; home Friends' activity; `GymMapClient` | Yes |
| `/more/friends/[userId]` | page | `/more/friends` "Friends" | `FriendsClient` | no |
| `/more/friends/[userId]/sessions/[sessionId]` | page | profile, owner name | `PublicProfileClient`; `FriendsClient` feed | Yes |
| `/more/friends/search`, `/shared-programs` | pages | `/more/friends` "Friends" | `FriendsClient` | no |
| `/more/garmin` | `GarminShell` | `/more` "More" | More list; `GarminSettingsRow`; home Garmin readiness | Yes |
| `/more/garmin/activity/[id]` | `GarminActivityView` link + swipe (`history.length` guess) | Activities tab | Activities, Overview, Trends tabs; `Volume`; `GarminRaceView` | Yes |
| `/more/garmin/race` | `GarminRaceView` link + swipe (`history.length` guess) | Overview tab "Garmin" | `GarminLoadTab` | no |
| `/history` | `HistoryClient` | `/more` "Back" | More list | no |
| `/history/[sessionId]` | `SessionDetailClient` | `/history` "Back" | History list; exercise detail rows; Friends reactions; Garmin matched session | Yes |
| `/exercises` | `ExercisesClient` button | in-page views, then `/more` "Back" | More list | no |
| `/exercises/[id]` | `ExerciseDetailClient` button, `history.length` guess | "Back" | library; workout exercise heading | Yes |
| `/more/thresholds` | page | `/more` "More" | More list; planned session page; athlete profile | Yes |
| `/more/athlete` | page | `/more` "More" | More list; interview | Yes |
| `/more/ai-setup` | page | `/more` "More" | More list; home AI check-in notice; onboarding | Yes |
| `/more/install` | page | `/more` "Back" | Settings; onboarding | Yes |
| `/settings` | `SettingsClient` | `/more` "More" | More list | no |
| `/more/account` | page | `/more` "More" | More list; consent form; gym picker | Yes |
| `/more/account/gym` | page | `/more/account` "Account" | Account; gym map | Yes |
| `/more/gyms` | page | `/more` "More" | More list; gym picker | Yes |
| `/more/assistants` | page | `/more` "More" | More list | no |
| `/more/assistants/changes` | page | `/more/assistants` | Connected assistants | no |
| `/more/coach-memory` | page | `/more` "More" | More list; Connected assistants | Yes |
| `/more/nutrition`, `/more/workouts`, `/more/feedback`, `/more/admin` | pages | `/more` "More" | More list | no |
| `/more/admin/*` | `Admin*Client` | `/more/admin` "Admin" | Admin panel | no |
| `/privacy`, `/terms` | `LegalPage` | `/` "LogEveryLift" | More; Account; policy notice; login, welcome, consent | Yes |
| `/planned/[id]` | page | `/week` "Week" | Week; home endurance card; pool view; player | Yes |
| `/planned/[id]/results` | page | `/planned/[id]` "Session" | planned page; home endurance card; player | Yes |
| `/cycles/[id]` | page | `/cycles` "Back" | cycle list; season phases; interview; after create | Yes |
| `/cycles/[id]/edit` | page | cycle "Back" | cycle page; Garmin race view | Yes |
| `/cycles/new`, `/cycles/triathlon` | page, `TriathlonPlanForm` | `/cycles` | cycle list; cycle page banner; interview | Yes |
| `/cycles/[id]/history`, `/programs/[id]/history`, `/seasons/[id]/history` | `PlanHistoryPage` | parent, plan name | parent | no |
| `/seasons/[id]` | page | `/cycles` "Cycles" | seasons section; cycle page; race plan; Branch: Race countdown | Yes |
| `/seasons/new`, `/seasons/[id]/edit` | pages | `/cycles`, season | seasons section, season page | no |
| `/races/[id]/plan` | page | season "Season" | season page; nutrition | Yes |
| `/programs/[id]` | `ProgramDetailClient` | `/programs` "Back" | program list; AI setup; add exercise | Yes |
| `/programs/[id]/(workout/)exercises/[peId]` | `WorkoutSetsClient` | program or workout "Back" | program, workout | no |
| set editor pages (4) | pages | exercise "Sets"/"Back"; save `router.back()` (leaves the app on a cold start) | exercise page | no |
| `/programs/[id]/workout/add-exercise` | `WorkoutAddExerciseClient` | `router.back()` (leaves the app on a cold start); after adding, a push to the workout | workout | no |

Deep entry points: PWA cold start (`/`), the manifest shortcut, the login redirect (a full page
load), a reload, a pasted URL. There were no push notifications with URLs and no app links from the
MCP server.

Not changed: the pool view's text "Back", the interview's Cancel, `/week` arrows.

## 3. Decisions

1. Owner: the label for `/` is "Home".
2. Owner: the label names where Back goes ("< Home", "< More", "< History"). When Back goes to the
   fallback parent, it keeps the parent's own label (a friend's name, a plan name).
3. Hub: `/more/install` falls back to Settings, `/more/coach-memory` to Connected assistants,
   `/privacy` and `/terms` to `/`.
4. Hub: the privacy-compliance skill was run for the path kept in `history.state`; the data
   inventory lists it (browser storage). Nothing leaves the device and nothing new is collected, so
   the policy and `LEGAL_VERSION` are unchanged.
5. Hub: separate history per tab, and Records rows opening exercise detail, are out of scope.
6. Hub: programmatic back always slides back; after a save or a delete the form does not stay in
   history; the Progress tab is kept in the URL.
7. Hub, after review of the first build: the fallback link replaces; leaving a form for the page it
   came from pops; the fallback label needs the exact URL; a fuller label table; an accessible name
   "Back to <page>"; skeletons take the page's fallback; the exercise picker and the set editor use
   the same helpers; "Admin Tools" reads "Admin".

## 4. How it works

- `HISTORY_TAG_SCRIPT` in `src/lib/utils/nav-history.ts`, a pre-hydration script in the root
  layout, wraps `history.pushState` and `history.replaceState`. A push stores the URL being left in
  the new entry's `history.state.__lelPrev`; a replace keeps the entry's value. A full page load
  makes an entry with no tag. The tag survives a reload.
- `resolveBack()` in `src/lib/utils/back-nav.ts` decides: pop to the tagged page, or link to the
  fallback when there is no tag, the tag is a sign-in screen, a form (`/new`, `/edit`, `/finish`,
  `/add-exercise`, set editors, `/interview`, `/play`, `/cycles/triathlon`) or the current page.
  The label is the fallback's own only when the tag is the fallback's exact URL (path and query);
  otherwise `backLabelFor()` names the page from a route table, exact routes before patterns.
- `BackLink` in `src/components/ui/BackLink.tsx` renders a real link to the fallback (so the server
  HTML is stable) and reads the decision once, on mount, in a layout effect. On a pop it calls
  `markProgrammaticBack()` and `router.back()`. The fallback link replaces: a push would tag the
  parent with the child, and the parent's Back would loop back down. Its accessible name is
  "Back to <page>". `useBack()` serves buttons and swipes; its `go()` pops or replaces with the
  fallback. `BackLabel` gives the loading skeletons the same text; each `loading.tsx` passes its
  page's fallback (an empty `href` for a dynamic parent, as a loading file has no params).
- `resolveDirection()` in `src/lib/utils/page-transition.ts`: a programmatic back slides back
  whatever the depths.
- After saving a form (`CreateCycleForm`, `TriathlonPlanForm`, `SeasonForm`, `StepResultsForm`,
  `GymPickerClient`, `WorkoutAddExerciseClient`) or deleting the page's own record
  (`SessionDetailClient`, `CycleDetailClient`), `useReturnTo()` pops when the page before is the
  target and replaces otherwise, so neither the form nor a duplicate of the target stays in history.
  The pop needs no refresh: the action's `revalidatePath` brings the page back with the change. A
  refresh on the popstate raced the router and refetched the deleted page.
- The exercise picker's Back and the set editor's Save use `useBack().go()`, so a cold start at
  those URLs goes to the workout or the exercise instead of out of the app.
- Progress writes its tab to `?tab=` with `history.replaceState`, which Next syncs with its router.
  `router.replace` would refetch the whole page from the server on each tap.

## 5. Spike: does a page keep its state on return?

Measured on the production build, WebKit and Chromium: on a history pop (`goBack()`), Progress
came back with the Records tab still selected; on a return by a push (a link to the page), it came
back on its default tab. So a pop keeps the previous page's React state, and only the URL survives a
push. Back now pops, and the Progress tab is also in the URL for reloads and links.

## 6. Tests

- Unit: `src/__tests__/back-nav.test.ts` (labels; every rule of the decision; `returnsByPop`),
  `src/__tests__/page-transition.test.ts` (programmatic back slides back),
  `src/__tests__/home-labels.test.ts`.
- Component: `src/__tests__/components/nav-history.test.ts` (the script in jsdom),
  `src/__tests__/components/back-link.test.tsx` (server render, pop or link on click, accessible
  name, `useBack`, `useReturnTo`), `src/__tests__/components/page-skeletons.test.tsx` (skeleton
  labels), `src/__tests__/components/step-results.test.tsx` (no push after save).
- e2e, WebKit and Chromium: `e2e/back-nav.spec.ts` (home widget > Progress > Back lands on home as a
  pop and is never painted "More"; More > Progress > More; deep link; reload; two levels from More and
  from the home; the Progress tab through Back, a reload and the bottom nav; a saved season form not
  left in history; a deep link to a child, Back, Back reaches the grandparent; season edit and
  session delete leave no duplicate; adding an exercise does not leave the picker; cold starts on the
  picker and the set editor), a new case in `e2e/page-transition.spec.ts` (Back to a tab root slides), and the
  updated `e2e/exercise-detail.spec.ts`, `e2e/weight-stack.spec.ts`, `e2e/friends.spec.ts`.
- e2e specs find the control with `backLink()` in `e2e/helpers.ts`: Next keeps recent pages mounted
  but hidden, so a plain test id can match more than one.

## 7. Re-check on a Next upgrade

The tag relies on Next writing history through `window.history.pushState` and `replaceState` with a
plain object, and on its router's history write happening in the same commit as the new page's
first layout effect. `e2e/back-nav.spec.ts` fails if either changes.
