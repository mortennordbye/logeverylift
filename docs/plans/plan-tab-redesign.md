# Plan tab redesign

Status: built on the local branch `feat/plan-redesign` (2026-11-14), all four packages merged. Not pushed: the owner tests it locally first.

## Why

The Cycles tab looked plain and was hard to use. A cycle's template lived on the cycle page, but
moving or skipping one dated session was only possible under More, then Calendar. The server can
already schedule a draft to start later and swap the program of one dated session, but the app had
no control for either. The standalone triathlon generator made one long cycle and knew nothing
about seasons.

## Decisions (made with the owner, do not re-ask)

- The tab is called **Plan**. Programs keeps its name: Plan is *when*, Programs is *what*.
  Routes stay as they are (`/cycles`, `/cycles/[id]`, `/seasons/...`); only labels change.
- One screen serves two users: a gym user with no season (often a rotation cycle) and an endurance
  user with a season. The season is an optional layer: with no season there is no season section,
  only one line that the user can hide.
- Endurance-only controls (triathlon plan, races, key session, brick link, use a workout,
  "Did you do it?", complete automatically) are **not rendered** when the endurance switch is off.
  Never show an "Endurance" badge.
- Look: monochrome with one accent (`--brand`). No colour per phase type. Full token list, shared
  parts and exact words: [`docs/design/plan-redesign/spec.md`](../design/plan-redesign/spec.md).
  Wrap each Plan screen in the `.home-ui` class so it gets the home screen's fonts and surfaces.
- The "Triathlon plan" entry leaves the + menu. New season gets "Make a triathlon plan", which
  makes the season's phases from the A race date, with the taper ending on race day.
- The Plan list is layout A (sections) with the hero from layout C (the week strip or the rotation
  order). A selected chip's tint comes from the accent, never a fixed blue.
- A missed key session moves only inside its own Monday to Sunday week (`suggestMoveDay`);
  otherwise it stays missed.

## Mockups

`docs/design/plan-redesign/J*.dc.html`, one file per screen, in user-journey order. They are
static HTML for a 390 px phone. The markup between `<x-dc>` tags is the screen; the data is in the
script at the bottom. The live canvas is the owner's private artifact; the files here are the
source of truth.

| Journey | Screens |
|---|---|
| 1 First open | `J1_EmptyPlan`, `J1_AddSheet` |
| 2 Gym user sets up a rotation cycle | `J2_CycleSetup`, `J2_RotationOrder`, `J2_ProgramPicker`, `J2_PlanGym` |
| 3 Gym user trains the block | `J3_RotationDetail`, `J3_SessionToday`, `J3_CycleDone` |
| 4 Endurance user plans a season | `J4_SeasonSetup`, `J4_SeasonDetail`, `J4_AddPhase`, `J4_WeekBuilder`, `J4_PlanSeason` |
| 5 Endurance user trains the week | `J5_CycleDetailWeek`, `J5_SessionFuture`, `J5_DidYouDoIt` |
| 6 Gym user with a goal season | `J6_PlanGoalSeason` |
| 7 Clean up | `J7_SelectMode`, `J7_RecentlyDeleted` |

## Work packages

Each package is one branch off `feat/plan-redesign`, built in its own worktree, committed but not
pushed. The hub merges them into `feat/plan-redesign`. Stay inside your package's files; if you
need a change in another package's file, say so in your report instead.

### P1 Plan list (journeys 1, 2.4, 4.5, 6, 7)
Files: `src/app/cycles/page.tsx`, `CyclesListClient`, `SeasonsSection`, `RecentlyDeleted`,
the bottom nav label, a new `src/app/cycles/deleted/page.tsx` (*new*).
- Bottom nav label "Plan".
- List per `J2_PlanGym` / `J4_PlanSeason` / `J6_PlanGoalSeason`; empty state per `J1_EmptyPlan`.
  The hero needs this week's dated sessions (weekday cycle) or the rotation position (rotation):
  read them on the server and pass them down.
- + menu per `J1_AddSheet`: New cycle, New season. No triathlon entry.
- Select mode per `J7_SelectMode`, with the season-phase warning. Remove the unreachable
  single-item delete confirm in `CyclesListClient` (it could never open).
- Recently deleted as its own screen per `J7_RecentlyDeleted`, linked from the list.

### P2 Cycle detail and sessions (journeys 3, 5)
Files: `src/app/cycles/[id]/page.tsx`, `CycleDetailClient`, `CycleCompletionBanner`,
`PlannedSessionActions`, `SessionAnswers`, a new `src/app/cycles/[id]/template/page.tsx` (*new*)
that renders the existing `CycleScheduleBuilder` unchanged.
- Detail per `J5_CycleDetailWeek` (weekday: week switcher and dated sessions) and
  `J3_RotationDetail` (rotation: order, next position). ⋯ menu: Edit details, Change history,
  Restart, Delete, each destructive one with a confirm sheet.
- "Start today instead" for a scheduled draft; Start keeps the out-of-order phase confirm.
- Session sheet per `J5_SessionFuture` and `J3_SessionToday`, using `updatePlannedSession`
  (`move`, `skip`, `unskip`, `reset`, `change`, `set_workout`). Rotation sessions: skip and change
  by position only.
- "Did you do it?" per `J5_DidYouDoIt`, as a sheet from a past unconfirmed row; reuse the existing
  confirm logic. Home keeps its notice cards.
- Completed state per `J3_CycleDone`.

### P3 Setup flow and builders (journeys 2.1 to 2.3, 4.4)
Files: `src/app/cycles/new/page.tsx`, `CreateCycleForm`, `CycleScheduleBuilder`.
- Two steps per `J2_CycleSetup`, then `J2_RotationOrder` or `J4_WeekBuilder`. Step 1 adds a start
  choice (Today, Next Monday, Pick a date, After current cycle; the last one only when a cycle is
  running). A future start schedules the draft; the MCP tool `manage_training_cycle` already does
  this, so reuse its library function behind a new app action input.
- Program picker as a `BottomSheet` per `J2_ProgramPicker`.
- Weekday slot sheet per `J4_WeekBuilder`: program, label and note, complete automatically, key
  session and brick link (the last three endurance only). The slot fields already exist in the
  cycle slot validator.

### P4 Season screens and the triathlon generator (journey 4)
Files: `src/app/seasons/**`, `SeasonForm`, `SeasonDetailClient`, `src/app/cycles/triathlon/page.tsx`,
`generateTriathlonPlan` and its util.
- New season per `J4_SeasonSetup`: optional race inline, end date from the A race, phase source
  (later, cycles I already have, make a triathlon plan).
- The generator writes a season with phases (general, base, build, peak, taper) sized from the
  race date, the taper ending on race day. `/cycles/triathlon` redirects to the new season form.
- Season detail per `J4_SeasonDetail`: drag to reorder phases, re-plan banner ("Fit the taper",
  "Keep as it is"), races.
- Add a phase per `J4_AddPhase`, then continue to `/cycles/[id]/template` for the week.

## Rules for every package

- Follow `CLAUDE.md` and `TESTING.md`: Server Action template, `callAction()`, Zod, `userId` from
  the session, tests at the right layer, bug fixes start with a failing test.
- Touch targets at least 44 px, real buttons and labels, `aria-label` on icon buttons.
- Date words as in the spec ("Mon 16 Nov"), in the user's time zone from the server.
- Update the e2e specs that look for the old "Cycles" label or old copy.
- Run `pnpm verify` (in a worktree set `TEST_DATABASE_URL` to the compose Postgres) before you
  report. Commit with no trailers. Never push.
- If you store or show new user data, run the `privacy-compliance` skill.

## Out of scope

Renaming routes; the home screen widgets; a deload generator for "Deload week".
