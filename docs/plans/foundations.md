# Foundations: bug fixes, time zone and units, endurance switch

Packages A1, A2 and A3 of [`triathlon-coach-plan.md`](triathlon-coach-plan.md), built as one
branch and one PR (`feat/foundations-a1-a3`), because the owner wants bigger PRs. Each package
has its own section below. Inputs: the audit (`docs/triathlon-coach-audit.md`, "Bugs found",
sections 8-11 and decisions D14, D15, D18, D23) and `CLAUDE.md`.

Status: built on `feat/foundations-a1-a3` to the owner's answers (see "Owner decisions" at the
end). The **Findings** sections describe the code before this PR (main at 0b48b23), and every
`file:line` in them was opened then; the code has moved since. The **Design** sections describe
what this PR built.

## Why

- **A1.** Four bugs from the audit. Two of them let the AI write the wrong thing without an
  error. One fills the training log with empty "completed" sessions that the weekly sync then
  counts. The plan's A4 (revisions) builds on the MCP set editor, so the editor must be correct
  first.
- **A2.** The server decides "today" in its own time zone. Every later package (seasons, dated
  sessions, the week view) uses dates and numbers, so the time zone and the display units must
  exist first (D14).
- **A3.** The "Triathlon plan" entry and the race field show to every user. D15 and D18 want
  one per-user switch that gates all endurance features, set by an admin for now.

---

## A1. Bug fixes and ghost-session cleanup

### Findings

**Bug 1: the MCP set editor drops fields with no error.**
- The `edit_program_exercise` description tells the model to set `repRangeMin`, `repRangeMax`
  and `targetRir` (`src/lib/mcp/tools/programs.ts:229`).
- `setShape` (`src/lib/mcp/tools/programs.ts:64`) has none of them, and also no
  `targetHeartRateZone`, `sessionRole` or `startDelaySeconds`. Zod strips unknown keys, so the
  write "succeeds" and the value is lost.
- The columns exist on `programSets` (`src/db/schema/programs.ts:156-188`).
- The UI validators already give the ranges to copy: rep range 1-1000, RIR 0-5, HR zone 1-5,
  start delay 0-60 s (`src/lib/validators/workout.ts:388-401`), and the rep-range check
  `repRangeIsWellFormed` (`src/lib/validators/workout.ts:342`).
- The set replace carries `sessionRole` and the peak anchors from the old row by set number
  (`src/lib/mcp/tools/programs.ts:461-474`). After the fix an explicit `sessionRole` in the
  input wins; without one, the old row's role is kept as today.

**Bug 2: MCP `update` does not check the exercise.** `add` checks that the exercise is a
system exercise or the user's own (`src/lib/mcp/tools/programs.ts:297`). `update` sets
`exerciseId` with no check (`src/lib/mcp/tools/programs.ts:388`), so a slot can point at
another user's custom exercise.

**Bug 3: comment drift in the triathlon generator.** The header says three strength sessions
"Lower / Upper-Push / Upper-Pull" (`src/lib/utils/triathlon-plan.ts:12`), but the code builds
two: Workout A on Monday and Workout B on Thursday (`src/lib/utils/triathlon-plan.ts:305-327`).
The comment on `buildTriathlonPlan` says "RIR-capped" (`src/lib/utils/triathlon-plan.ts:164`),
but no set gets a `targetRir` and the type comment says there is no RIR cap
(`src/lib/utils/triathlon-plan.ts:40-44`). The header also says the swim is folded onto an
"Upper-Push day", which no longer exists.

**Bug 4: sessions left open become false "completed" sessions.** Two sweeps close stale open
sessions, and both have the same fault:
- `closeStaleOpenSessions` (`src/lib/actions/workout-sessions.ts:193`), run on every home-screen
  load (`src/app/page.tsx:54`), closes sessions open for more than 10 hours.
- The sweep in `createWorkoutSession` (`src/lib/actions/workout-sessions.ts:38`) closes
  sessions open for more than 1 hour when a new one starts.
- Both set `endTime` to now, not to the last logged set, and both keep sessions with no sets.
  The workout screen creates a session as soon as it opens
  (`src/components/features/WorkoutSessionInitializer.tsx:95-104`), so opening a workout and
  leaving makes an empty session.
- The weekly sync counts these sessions: adherence is the number of completed sessions in the
  last 7 days (`src/lib/periodization-sync.ts:141`). An empty ghost raises adherence and so the
  cycle's volume nudge.
- Sessions with `source = 'auto'` have no sets by design (`src/db/schema/workout-sessions.ts:66-68`).
  The fix and the cleanup must never touch them.

### Design

- **Bug 1.** Add the six fields to `setShape` with the UI's ranges, `nullable().optional()`,
  and the rep-range refine. Make the set object strict, so an unknown key fails the call with
  the key's name instead of being stripped. Map the fields in `setValues`. Extend the tool
  description: one line on each new field, and that the weekly sync owns `targetHeartRateZone`
  and `restTimeSeconds` on sets with `sessionRole = "work"` and rewrites them each week (audit
  section 8). Who owns that field long term is B1's decision, not this one. Peak anchors stay
  derived (not accepted as input), as today.
- **Bug 2.** Run the same system-or-own check as `add` when `update` gets an `exerciseId`.
  Return `fail("Exercise not found")`, the same text as `add`.
- **Bug 3.** Rewrite the three comments to match the code. Comment only.
- **Bug 4.** One shared server helper, *new* `closeStaleSessions(userId, olderThan)`, in
  `src/lib/actions/workout-sessions.ts` as a non-exported function (an export of a
  `"use server"` file is a callable action). Both sweeps call it. In one transaction it:
  1. deletes stale open `app` sessions that have no `workout_sets` rows;
  2. closes the rest with `endTime` = the latest `workout_sets.created_at` of the session
     (never earlier than `startTime`);
  3. returns the closed ids, so `learnWeightStacks` still runs for them.
  A deleted session is safe for a client that still holds its id: `isSessionResumable` returns
  `false` and the client starts a new session.
- **Ghost cleanup script (D23).** *New* `scripts/cleanup-ghost-sessions.ts`, modelled on
  `scripts/cleanup-orphaned-cycle-programs.ts`.
  - A ghost is: `is_completed = true`, `source = 'app'`, no `workout_sets` rows, and no notes
    and no feeling (a user who finished an empty session on purpose and wrote something keeps
    it).
  - Dry run is the default: it prints the count per user and one line per session (id, user
    id, date, duration in hours). No names, no emails, no notes in the output.
  - It deletes only with an explicit `--delete` flag, and re-checks "no sets" inside the
    delete statement (`NOT EXISTS`), so a set logged between the dry run and the delete saves
    the session.
  - The rule lives in `src/lib/ghost-sessions.ts`, so the integration suite runs it against
    the test database; the script is a thin wrapper.
  - Package script `db:cleanup-ghosts`. It is on the esbuild line in the `Dockerfile`, so the
    production image has `/app/scripts/cleanup-ghost-sessions.js`.
  - Never run against prod by an agent. Never run in delete mode against the dev DB by an
    agent. The integration test runs both modes against the test DB. A dry run on the dev DB
    found 330 ghosts for one account, with durations of about 1, 10 and 720 hours.
  - **The owner runs it in prod** after the deploy (owner decision 3), in the app pod:

    ```bash
    # 1. Dry run: lists the ghosts, deletes nothing.
    kubectl exec -n <namespace> deploy/<app> -- node /app/scripts/cleanup-ghost-sessions.js
    # 2. Read the list. If it is right, delete them:
    kubectl exec -n <namespace> deploy/<app> -- node /app/scripts/cleanup-ghost-sessions.js --delete
    ```

    Locally against a database of your choice: `pnpm db:cleanup-ghosts` (dry run) and
    `pnpm db:cleanup-ghosts --delete`, with `DATABASE_URL` and `BETTER_AUTH_SECRET` set.

### Tests

Every bug test is written first and seen failing on the unfixed code.

| Bug | Layer | Test |
|---|---|---|
| 1 | Integration (*new* `src/__tests__/integration/mcp-programs.test.ts`) | `update` with `sets` holding each of the six fields stores each value; an unknown set key fails and changes nothing; `sessionRole` from input wins over the old row's |
| 2 | Integration (same file) | `update` with another user's custom exercise fails and the slot keeps its exercise; a system exercise and the user's own custom exercise both work |
| 3 | none | Comment only. The generator's behaviour is already covered by `src/__tests__/triathlon-plan.test.ts`. |
| 4 | Integration (`src/__tests__/integration/workout-sessions.test.ts`) | an empty session 11 h old is deleted by the home sweep; a session with sets gets `endTime` = its last set; an `auto` session is untouched; another user's open session is untouched; the same three cases for the 1 h sweep in `createWorkoutSession` |
| Script | Integration | dry run lists ghosts and deletes nothing; delete mode removes only ghosts, keeps sessions with sets, notes, feeling or `source = 'auto'` |

The MCP integration tests call the registered tool handler with a fake server, the way
`src/__tests__/integration/mcp-workouts.test.ts` does.

---

## A2. User time zone and display units

### Findings

**Today is computed in the server's time zone.** The production image sets no `TZ`
(`Dockerfile:62-67`), so the server runs in UTC. These places build "today" with
`new Date()` and `setHours(0, 0, 0, 0)` or `toDateStr(new Date())` on the server:
- the weekly sync: `syncDueCycle` (`src/lib/periodization-sync.ts:48-49`),
  `periodizationShare` (`src/lib/periodization-sync.ts:88-89`), `wearableSuggestion`
  (`src/lib/periodization-sync.ts:311-312`), and the adherence window, which also cuts the date
  in UTC with `toISOString` (`src/lib/periodization-sync.ts:124-126`);
- the cycle views: `getActiveCycleForUser` picks the week and today's slot
  (`src/lib/actions/training-cycles.ts:167-168`, `:218`), and a local start-of-today helper
  (`src/lib/actions/training-cycles.ts:137-141`);
- a cycle start date, in the app (`src/lib/actions/training-cycles.ts:781`, `:826`) and over
  MCP (`src/lib/mcp/tools/cycles.ts:188`);
- the home page week strip and "completed today" (`src/app/page.tsx:35-45`, `:84`).

**The workout date comes from the phone.** `WorkoutSessionInitializer` sends
`toDateString(startTime)` in the device's zone
(`src/components/features/WorkoutSessionInitializer.tsx:100`), and the finish page does the
same when no session exists (`src/app/programs/[id]/workout/finish/page.tsx:106`). So a set
logged at 00:30 in Oslo is dated Tuesday, while the server, at 23:30 UTC, still thinks it is
Monday: the home page shows Monday's slot and "not done today".

**Helpers to reuse.** `localDate(now, timeZone)` turns an instant into a `YYYY-MM-DD` date in
an IANA zone, with UTC for an unknown zone (`src/lib/garmin/dates.ts:30`). The cycle code works
on local-midnight `Date` objects: `parseDateStr` (`src/lib/utils/cycle-position.ts:46`) and
`cycleWeek` (`src/lib/utils/cycle-position.ts:57`).

**Units.** The app is metric only. Weight shows as kg, distance as km
(`formatDistanceKm`, `src/lib/utils/format.ts:131`), run pace per km (`formatPace`,
`src/lib/utils/format.ts:81`), swim pace per 100 m (`formatSwimPace`,
`src/lib/utils/format.ts:92`), speed in km/h (`formatSpeedKmh`, `src/lib/utils/format.ts:102`),
and logged sets as "reps × weight kg" (`loggedSetLabel`, `src/lib/utils/format.ts:143`). About
20 components outside Garmin print units directly.

**Settings pattern to copy.** `missedWorkoutsEnabled` is a column on `user`
(`src/db/schema/users.ts:46`), read on the settings page (`src/app/settings/page.tsx:17`) and
written by `setMissedWorkoutsEnabled` (`src/lib/actions/training-cycles.ts:502-505`).

### Design

**Time zone.**
- Column `user.time_zone`, an IANA name, null until set.
- Filled once from the browser: `UserSettingsHydrator` sends
  `Intl.DateTimeFormat().resolvedOptions().timeZone` to `setTimeZone` with `ifUnset`, which
  writes only while the column is null. A manual choice sticks. An admin viewing as the user
  never fills it.
- Settings ("Units and time", `UnitsAndTimeSettings`) has a picker from
  `Intl.supportedValuesOf("timeZone")`. When the phone's zone differs from the stored one, it
  shows "Your phone is in X." with a "Use it" button. No automatic change on travel.
- The validators (`src/lib/validators/user-settings.ts`) check the name with
  `Intl.DateTimeFormat`, so an unknown name fails, in the app and over MCP.

**One helper for today and weeks.** `src/lib/utils/user-date.ts`, pure:
- `localDateStr(now, timeZone)`: the `YYYY-MM-DD` date at `now` in the zone.
- `todayIn(timeZone, now)`: that date as a local-midnight `Date`, the shape `cycleWeek` and
  the slot logic already take.
- `weekDatesOf(dateStr)`: Monday to Sunday of the week, for the home strip.
- A null or unknown zone falls back to the zone of the running code (the server's on the
  server, the phone's in the browser), so a user who has no zone yet sees no change.
- Garmin's own `localDate` stays as it is: it falls back to UTC, and the Garmin pages keep
  `garminToday` for now (BACKLOG.md).

Server reads: `getUserSettings(userId)` and `userToday(userId, now)` in
`src/lib/user-settings.ts`, with React `cache` for one read per request. The weekly sync
(`syncDueCycle`, `periodizationShare`, `wearableSuggestion`, the adherence window), the
cycle views (`getActiveCycleForUser`, `getCyclePeriodization`, the duration guard in
`updateTrainingCycle`), the cycle start (`startTrainingCycle`, `restartTrainingCycle` and MCP
`manage_training_cycle`) and the home page use them. The home page asks for the week's
sessions from a day before the user's Monday, since that query filters by start time and the
user's Monday can begin on the server's Sunday; it then matches sessions by date as before.

**The workout date uses the same zone.** The workout layout reads the stored zone on the
server and passes it to `WorkoutSessionInitializer`, which dates a new session with
`localDateStr`. The finish page's fallback reads it from `useUserSettings`. Then the session
date and the server's "today" agree. With no stored zone, both keep the phone's day, as before.
The cycle calendar's "today" uses the same zone (`todayIn`).

**Client settings.** The root layout cannot wait for the session without losing its static
shell. So a small store (`src/contexts/user-settings-context.tsx`, read with
`useSyncExternalStore`) starts metric with no zone, and `UserSettingsLoader`, streamed in its
own Suspense next to the page, fills it through `UserSettingsHydrator`. Components read
`useUnits()` or `useUserSettings()`. It is a store and not a context on purpose: a context
provider around the page in the root layout made every page render twice in the DOM under
`cacheComponents`, which the e2e suite caught (strict-mode "resolved to 2 elements" in ten
specs). On a cold load a component can render once in metric before the settings
arrive; the set editor and the new-set view then re-show the distance field in the right unit.

**Units (endurance only, owner decision 2).**
- Two columns on `user`: `distance_unit` (`km` | `mi`, default `km`; run and ride distance,
  run pace per km or per mile, ride speed km/h or mph) and `swim_unit` (`m` | `yd`, default
  `m`; swim distance, swim pace per 100 m or per 100 yd). Weight stays kg only, and there is no
  `weight_unit` column: lb is a BACKLOG entry ("Pounds for weights"), since lb done well needs
  lb-native steps and plates, and an unused column would only be one more thing to migrate.
- Storage stays metric. Server Actions, MCP tools, export and the database take and return
  metric only. MCP stays metric whatever the setting, and the tool descriptions say so.
- `src/lib/utils/units.ts`, pure: the `Units` type, `fieldUnit` (the unit a discipline's
  distance field is in: m becomes yd, km becomes mi), `metersToField` and `fieldToMeters`.
  Metric stays exactly as before (meters, or meters / 1000). Miles show two decimals and yards
  whole numbers. `fieldToMeters` takes the stored meters too: a value saved back unchanged
  keeps them, so 5000 m shown as 3.11 mi does not become 5005 m.
- The endurance formatters in `src/lib/utils/format.ts` (`formatPace`, `formatSwimPace`,
  `formatSpeedKmh`, `formatEndurancePace`, `formatDistanceKm`, `formatEnduranceDistance`,
  `loggedSetLabel`, `buildRunSetSummary`, and the new `distancePresetLabel`) take an optional
  `units` argument with the metric default, so a caller that passes nothing is unchanged.
- Screens that convert: the run logger (`LogRunModal`), the set editor and the new-set view
  (input and pace), the set list and its record badge, the program and workout exercise lists,
  the cycle calendar, the records feed, session detail, exercise detail, and the cardio and
  triathlon sections of metrics. Distance presets stay metric distances, shown converted
  (3.1mi). What still shows metric is listed in BACKLOG.md ("Time zone and units: places still
  on the server zone or metric").

### Data model

| Column | Type | Default | Owner (writer) |
|---|---|---|---|
| `user.time_zone` | `text`, null | null | the user (Settings, the one-time browser fill, MCP `update_profile`) |
| `user.distance_unit` | `text` | `'km'` | the user (Settings, MCP `update_profile`) |
| `user.swim_unit` | `text` | `'m'` | the user (Settings, MCP `update_profile`) |

### MCP tools

- `get_profile` (read-only) returns `timeZone`, `distanceUnit` and `swimUnit`.
- `update_profile` accepts the same three, with the same validators as the Settings actions.
- `manage_training_cycle` uses the user's zone for a start date and for the duration guard.
- All MCP numbers stay metric, and both profile tool descriptions say so.

### Tests

| Layer | Test |
|---|---|
| Unit (`src/__tests__/user-date.test.ts`) | the date in Oslo, New York and UTC at 22:59, 23:00, 23:30 and 00:30 UTC, in summer time and across both clock changes, and the fallback for no zone or an unknown one; Monday to Sunday at week, month and year boundaries |
| Unit (`src/__tests__/units.test.ts`) | metric field values exactly as before; miles and yards both ways; typed values read back as typed; a value saved back unchanged keeps its meters; pace per mile and per 100 yd, mph, yards for swims; preset labels and run summaries |
| Component (`src/__tests__/components/session-date-midnight.test.tsx`) | `WorkoutSessionInitializer` at 23:30 UTC dates the session the next day for `Europe/Oslo`, the same day for `America/New_York`, and the phone's day with no zone. This is the midnight-boundary test the plan asks for; the New York case fails on the old code. |
| Component (`src/__tests__/components/set-edit-units.test.tsx`) | the set editor in miles shows 5 km as 3.11 mi, saves it back unchanged as 5000 m, saves a typed 6.2 mi as 9978 m; metric is unchanged |
| Integration (`src/__tests__/integration/user-time-zone.test.ts`) | `getActiveCycleForUser` at 23:30 UTC picks Tuesday's slot for an Oslo user and Monday's for a New York user; week 2 starts at the user's own Monday midnight; `startTrainingCycle` dates the start by the user's day; three of these fail on the old code. `setTimeZone` fills once and never over a stored zone; bad zones and units are refused; units change only the caller's row; MCP `update_profile` sets zone and units and cannot set the endurance switch |
| e2e | The full suite, once, at the end (the date is in the logging flow) |

---

## A3. Endurance switch

### Findings

- The "Triathlon plan" entry shows to every user (`src/components/features/CyclesListClient.tsx:394-401`).
- The race field on the cycle form shows to every user
  (`src/components/features/EditCycleForm.tsx:121-140`).
- The `/cycles/triathlon` page and `generateTriathlonPlan`
  (`src/lib/actions/triathlon-plan.ts:57`) are open to everyone. Hiding the entry alone leaves
  them reachable by URL.
- Only the Garmin code reads the race date besides the form (Garmin race views, admin-only).
- Garmin gates on the role (`garminAllowed`, `src/lib/garmin/access.ts:15-17`). That stays
  for licence reasons; the endurance switch must not copy that pattern.
- Admins manage users at `/more/admin/users` (`src/app/more/admin/users/page.tsx:6-23`) through
  Better Auth's admin client (`src/components/features/AdminUsersClient.tsx`).

### Design

- Column `user.endurance_enabled`, boolean, not null, default false.
- *New* `src/lib/endurance.ts`: `enduranceEnabledFor(userId)` for server code. All later
  endurance packages gate on this function and never on the role.
- *New* admin action `setUserEndurance({ userId, enabled })` in `src/lib/actions/admin.ts`,
  with `requireAdmin()` and the template's `ForbiddenError` handling. It takes the target
  user's id because it acts on another user; that is the admin exception in `CLAUDE.md`.
- The admin users list gets an "Endurance" toggle per user (client calls go through
  `callAction()`).
- Gated behind the switch:
  - the "Triathlon plan" entry on the cycles list;
  - `/cycles/triathlon` (it redirects to `/cycles` when off);
  - `generateTriathlonPlan` (it refuses when off, so the gate holds on the server);
  - the race field on the cycle form. A cycle that already has a race date still shows it, so
    no stored value is hidden from its owner.
- Not gated: running and other endurance sets in programs, the run logger, and existing
  triathlon cycles, which keep running and syncing. Lifters run too, and D18's "endurance"
  means the add-on features, not cardio logging.
- Settings shows a read-only line "Endurance features: on/off (an admin turns this on)", so
  a user can see the state.

### Data model

| Column | Type | Default | Owner (writer) |
|---|---|---|---|
| `user.endurance_enabled` | `boolean` not null | `false` | an admin (`setUserEndurance`); never the user, never MCP |

### MCP tools

- `get_profile` returns `enduranceEnabled` (read-only), so the AI knows which features the
  user has.
- No MCP tool can set it. Later endurance MCP tools check `enduranceEnabledFor`.

### Tests

| Layer | Test |
|---|---|
| Integration | `setUserEndurance` as an admin sets the flag; as a normal user it is refused and nothing changes |
| Integration | `generateTriathlonPlan` with the switch off fails and writes nothing; with it on, it works |
| Component | Cycles list: no "Triathlon plan" entry when off, entry when on. Cycle form: no race field when off and no race; field shown when on or when the cycle has a race |
| Integration | `get_profile` returns the flag, `update_profile` ignores an `enduranceEnabled` key |

---

## Migration and rollback

One migration for the PR, `drizzle/0081_user_settings_endurance.sql`, from `pnpm db:generate`
(only new columns, so no create-or-rename prompt), with the matching `drizzle/meta/` snapshot,
plus one hand-written data step (owner decision 1). It comes after main's
`drizzle/0080_mcp_scopes.sql` (B2), and was generated again on top of that snapshot when this
branch was rebased.

```sql
ALTER TABLE "user" ADD COLUMN "time_zone" text;
ALTER TABLE "user" ADD COLUMN "distance_unit" text DEFAULT 'km' NOT NULL;
ALTER TABLE "user" ADD COLUMN "swim_unit" text DEFAULT 'm' NOT NULL;
ALTER TABLE "user" ADD COLUMN "endurance_enabled" boolean DEFAULT false NOT NULL;
UPDATE "user" SET "endurance_enabled" = true
WHERE "role" = 'admin'
   OR "id" IN (SELECT "user_id" FROM "training_cycles" WHERE "athlete_level" IS NOT NULL);
```

`athlete_level` is written only by the triathlon generator (`generateTriathlonPlan`), so it
marks the users who already use it. The data step is tested in
`src/__tests__/integration/migrations.test.ts`.

All four are new columns with defaults, so existing rows and old code keep working.

**Rollback.** First deploy the previous image (the old code ignores the new columns, so the
image can roll back without touching the database). Then, only if the columns must go:

```sql
ALTER TABLE "user" DROP COLUMN "time_zone", DROP COLUMN "distance_unit",
  DROP COLUMN "swim_unit", DROP COLUMN "endurance_enabled";
```

and delete 0081's row (the newest) from `drizzle.__drizzle_migrations`. Leave 0080 (MCP
scopes) in place; it is independent of these columns. Data lost: only the
users' time zone, unit choices and endurance switches (the data step can be run again). No
training data. The ghost cleanup is
not part of the migration; sessions it deleted can only come back from a database backup, which
is why it runs as a dry run first and deletes only on the owner's approval.

## Privacy (privacy-compliance checklist)

1. **New columns with user data.** Time zone, units and the endurance switch, all on `user`.
   `collectUserData` already exports the whole `user` row
   (`src/lib/account-data.ts:63`), so the export covers them with no code change; the
   integration test in `src/__tests__/integration/account-data.test.ts` checks it. Account
   deletion removes the row. Inventory: a new "Settings" row (time zone, units, endurance
   switch, and the existing missed-workouts switch) with purpose "showing dates and numbers
   the user's way, and which features are on", basis Art. 6(1)(b), retention until account
   deletion. A time zone hints at where the user lives, so it is listed as personal data.
2. **Health data.** None. The endurance switch says the user trains for endurance; that is not
   health data. No `CONSENT_VERSION` raise.
3. **Data leaving the server.** The MCP row in the inventory
   (`docs/privacy/data-inventory.md:54`) adds the time zone, display units and whether the
   endurance add-on is on to what assistants can read. `LEGAL_VERSION`
   (`src/lib/constants/legal.ts:7`) is bumped to 2026-11-12.2 (the same day as the MCP access-levels change on main, which already
   shipped 2026-11-12, so users are told a second time), since what is collected changes,
   and the policy gets a "Settings" item and names the new MCP reads. `CONSENT_VERSION` is
   unchanged.
4. **Browser storage.** None new: units come from the server through context.
5. **Visible to others.** No. Friends do not see the time zone, units or the switch.
6. **Logs.** The cleanup script prints ids, dates and durations only.
7. **Retention.** Nothing grows.

## Field owners

The three settings columns: the user. `endurance_enabled`: an admin. No field in this PR is
written by the progression engine or the weekly sync. Bug 1 lets MCP write
`targetHeartRateZone` and `restTimeSeconds`, which the weekly sync owns on `work` sets; this
PR only says so in the tool description, and B1 settles the owner (audit section 8).

## Defaults chosen

- One branch, one migration for all three packages (the owner asked for one PR).
- Bug 1: accept the six fields and also fail loudly on any other unknown set key. Peak anchors
  stay derived.
- Bug 4: stale open sessions with no sets are deleted, not closed. The readiness answer of an
  abandoned session goes with it.
- Ghost script: dry run by default, `--delete` to delete; also keeps empty sessions that have
  notes or a feeling; bundled into the image so the owner can run it in the prod pod.
- Time zone: filled once from the browser, never changed automatically; Settings offers the
  device zone when it differs.
- The workout date follows the stored time zone, so the session date and the server's today
  agree.
- Pace follows the distance unit; swim has its own unit.
- MCP always speaks metric.
- The Garmin pages keep `garminToday` and stay metric in this PR (admin only, and the owner
  is metric). The metrics, friends and admin "this week" sums keep the server zone. Both are
  in `BACKLOG.md` as known gaps.
- Not gated by the endurance switch: run logging, endurance sets and existing triathlon cycles.

## Owner decisions (2026-11-12)

1. **Who gets the endurance switch at deploy:** admins, and every user who already has a cycle
   from the triathlon generator. The migration's data step does it.
2. **Units:** endurance units only in this PR (km/mi, pace per km/mi, swim per 100 m/100 yd).
   Weight stays kg, with no `weight_unit` column. lb display and input, with lb-native steps
   and plates, is one BACKLOG entry ("Pounds for weights").
3. **Ghost cleanup in prod:** the owner runs it, dry run first, then `--delete`, with the
   commands in the A1 design above. No agent runs it against prod. Tracked in BACKLOG ("Run
   the ghost-session cleanup in prod") until done.

## Files

A1: `src/lib/mcp/tools/programs.ts`, `src/lib/validators/workout.ts`,
`src/lib/utils/triathlon-plan.ts`, `src/lib/actions/workout-sessions.ts`,
`src/lib/ghost-sessions.ts`, `scripts/cleanup-ghost-sessions.ts`, `package.json`, `Dockerfile`.

A2: `src/lib/utils/user-date.ts`, `src/lib/utils/units.ts`, `src/lib/user-settings.ts`,
`src/lib/validators/user-settings.ts`, `src/lib/actions/user-settings.ts`,
`src/contexts/user-settings-context.tsx`, `src/components/features/UserSettingsLoader.tsx`,
`src/components/features/UserSettingsHydrator.tsx`,
`src/components/features/UnitsAndTimeSettings.tsx`, `src/lib/utils/format.ts`,
`src/lib/periodization-sync.ts`, `src/lib/actions/training-cycles.ts`,
`src/lib/mcp/tools/cycles.ts`, `src/lib/mcp/tools/profile.ts`, `src/app/layout.tsx`,
`src/app/page.tsx`, `src/app/settings/page.tsx`, `src/app/programs/[id]/workout/layout.tsx`,
`src/app/programs/[id]/workout/finish/page.tsx`, and the endurance screens listed under Units.

A3: `src/lib/endurance.ts`, `src/lib/actions/admin.ts`, `src/lib/actions/triathlon-plan.ts`,
`src/app/more/admin/users/page.tsx`, `src/components/features/AdminUsersClient.tsx`,
`src/app/cycles/page.tsx`, `src/app/cycles/triathlon/page.tsx`,
`src/app/cycles/[id]/edit/page.tsx`, `src/components/features/CyclesListClient.tsx`,
`src/components/features/EditCycleForm.tsx`.

Shared: `src/db/schema/users.ts`, `drizzle/0081_user_settings_endurance.sql`,
`docs/privacy/data-inventory.md`, `src/app/privacy/page.tsx`, `src/lib/constants/legal.ts`.
