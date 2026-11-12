# Foundations: bug fixes, time zone and units, endurance switch

Packages A1, A2 and A3 of [`triathlon-coach-plan.md`](triathlon-coach-plan.md), built as one
branch and one PR (`feat/foundations-a1-a3`), because the owner wants bigger PRs. Each package
has its own section below. Inputs: the audit (`docs/triathlon-coach-audit.md`, "Bugs found",
sections 8-11 and decisions D14, D15, D18, D23) and `CLAUDE.md`.

Names marked *new* do not exist yet. Every `file:line` below was opened when this brief was
written (2026-11-12).

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
  - Package script `db:cleanup-ghosts`. Add it to the esbuild line in the `Dockerfile`, so the
    owner can run `node /app/scripts/cleanup-ghost-sessions.js` (dry run) in the prod pod.
  - Never run against prod by an agent. Never run in delete mode against the dev DB by an
    agent. The integration test runs both modes against the test DB.

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
  (`src/lib/actions/training-cycles.ts:167-168`, `:218`), and `startOfToday`
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
- Filled once from the browser: a small client component in the root layout sends
  `Intl.DateTimeFormat().resolvedOptions().timeZone` to *new* `setTimeZone` when the stored
  value is null. It never overwrites a stored value, so a manual choice sticks.
- Settings shows the zone with a picker (the browser's `Intl.supportedValuesOf("timeZone")`
  list). When the device zone differs from the stored one, Settings shows "Your phone is in X.
  Use it?" with one button. No automatic change on travel.
- The action validates the name with `Intl.DateTimeFormat` (unknown name fails).

**One helper for today and weeks.** *New* `src/lib/utils/user-date.ts`, pure:
- `localDateStr(now, timeZone)`: the `YYYY-MM-DD` date at `now` in the zone. Moves the body of
  `localDate` here; `src/lib/garmin/dates.ts` re-exports it so Garmin code is unchanged.
- `todayIn(timeZone, now)`: that date as a local-midnight `Date` (`parseDateStr` of the
  string), which is the shape `cycleWeek` and the slot logic already take.
- `mondayOf(dateStr)` and the week's seven dates, for the home strip.
- A null zone falls back to the process's own zone on the server and the device zone in the
  browser, so a user who has no zone yet sees no change.

Server reads: *new* `getUserTimeZone(userId)`, wrapped in React `cache` for one read per
request. The sync, the cycle views, the cycle start, the MCP cycle tool and the home page use
it.

**The workout date uses the same zone.** The workout layout passes the stored zone to
`WorkoutSessionInitializer` and the finish page, which date the session with `localDateStr`
instead of the device's `toDateString`. Then the session date and the server's "today" always
agree. With no stored zone, both keep using the device zone, as today.

**Units.**
- Three columns on `user`: `weight_unit` (`kg` | `lb`, default `kg`), `distance_unit`
  (`km` | `mi`, default `km`; run pace follows it: per km or per mile; speed km/h or mph),
  `swim_unit` (`m` | `yd`, default `m`; swim pace per 100 m or per 100 yd).
- Storage stays metric. Server Actions, MCP tools, export and the database take and return
  metric only. MCP stays metric whatever the setting, and the tool descriptions say so.
- *New* `src/lib/utils/units.ts`, pure: kg↔lb, m↔mi, m↔yd, and the display formatters, which
  take the units. The existing `format.ts` helpers get an optional units argument with the
  metric default, so every current caller is unchanged until it passes the units.
- A *new* `UnitsProvider` context in the root layout gives Client Components the user's units.
- Input converts at the edge: a weight typed in lb is turned into kg before the Server Action
  call and rounded to the column's 2 decimals. The field shows 1 decimal in lb, so a stored
  value shows back as what was typed (225 lb → 102.06 kg → 225.0 lb).
- Which screens convert in this PR: see open question 2.

### Data model

| Column | Type | Default | Owner (writer) |
|---|---|---|---|
| `user.time_zone` | `text`, null | null | the user (Settings, the one-time browser fill, MCP `update_profile`) |
| `user.weight_unit` | `text` | `'kg'` | the user (Settings, MCP `update_profile`) |
| `user.distance_unit` | `text` | `'km'` | the user (Settings, MCP `update_profile`) |
| `user.swim_unit` | `text` | `'m'` | the user (Settings, MCP `update_profile`) |

### MCP tools

- `get_profile` returns `timeZone`, `weightUnit`, `distanceUnit`, `swimUnit`.
- `update_profile` accepts the same four (same validation as the Settings action).
- `manage_training_cycle` `start` uses the user's zone for the start date.
- All MCP numbers stay metric.

### Tests

| Layer | Test |
|---|---|
| Unit | `user-date`: the date in Oslo, New York and UTC at 22:59, 23:00, 23:30 and 00:30 UTC, across both DST changes, and the null fallback; Monday and week dates at a week boundary |
| Unit | `units`: each conversion both ways, rounding to the stored precision, the lb round trip for common plate weights, pace per mile and per 100 yd |
| Component | `WorkoutSessionInitializer` with fake time at 23:30 UTC and zone `Europe/Oslo` sends the next day's date; with zone `America/New_York` the same day; with no zone, the device date (as today). This is the midnight-boundary test the plan asks for. |
| Component | A set-edit view in lb shows lb and sends kg to the action |
| Integration | `getActiveCycleForUser` at 23:30 UTC for an Oslo user picks the next day's slot and the right cycle week on a week boundary; `syncDueCycle` runs the new week's sync at Oslo midnight, not UTC midnight; `setTimeZone` and the units action reject bad values; `update_profile` sets them; another user's call cannot change them |
| e2e | Run the full suite once at the end (the date is in the logging flow) |

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
| Integration | `generateTriathlonPlan` with the switch off fails and writes nothing; with it on, it works (existing tests turn the switch on first) |
| Component | Cycles list: no "Triathlon plan" entry when off, entry when on. Cycle form: no race field when off and no race; field shown when on or when the cycle has a race |
| Integration | `get_profile` returns the flag, `update_profile` ignores an `enduranceEnabled` key |

---

## Migration and rollback

One migration for the PR, `drizzle/0080_*.sql`, from `pnpm db:generate` (create, not rename),
with the matching `drizzle/meta/` snapshot.

```sql
ALTER TABLE "user" ADD COLUMN "time_zone" text;
ALTER TABLE "user" ADD COLUMN "weight_unit" text DEFAULT 'kg' NOT NULL;
ALTER TABLE "user" ADD COLUMN "distance_unit" text DEFAULT 'km' NOT NULL;
ALTER TABLE "user" ADD COLUMN "swim_unit" text DEFAULT 'm' NOT NULL;
ALTER TABLE "user" ADD COLUMN "endurance_enabled" boolean DEFAULT false NOT NULL;
```

Plus the data step from open question 3, if the owner says yes.

All five are new columns with defaults, so existing rows and old code keep working.

**Rollback.** First deploy the previous image (the old code ignores the new columns, so the
image can roll back without touching the database). Then, only if the columns must go:

```sql
ALTER TABLE "user" DROP COLUMN "time_zone", DROP COLUMN "weight_unit",
  DROP COLUMN "distance_unit", DROP COLUMN "swim_unit", DROP COLUMN "endurance_enabled";
```

and delete the migration's row from `drizzle.__drizzle_migrations`. Data lost: only the
users' time zone, unit choices and endurance switches. No training data. The ghost cleanup is
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
   (`docs/privacy/data-inventory.md:53`) adds "time zone, unit settings and which add-ons are
   on" to what assistants can read. Bump `LEGAL_VERSION` (`src/lib/constants/legal.ts:7`), since
   what is collected changes, and add one sentence to the policy.
4. **Browser storage.** None new: units come from the server through context.
5. **Visible to others.** No. Friends do not see the time zone, units or the switch.
6. **Logs.** The cleanup script prints ids, dates and durations only.
7. **Retention.** Nothing grows.

## Field owners

The four settings columns: the user. `endurance_enabled`: an admin. No field in this PR is
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
- Garmin pages keep their own `garminToday` and stay metric in this PR (admin only, the owner
  is metric). Metrics, friends and admin "this week" calculations keep the server zone. Both go
  to `BACKLOG.md` as known gaps.
- Not gated by the endurance switch: run logging, endurance sets and existing triathlon cycles.

## Open questions for the owner

1. **Who gets the endurance switch at deploy?** Recommended: the migration turns it on for
   admin accounts and for every user who already has a cycle made by the triathlon generator,
   so no one loses a feature they use. The alternative is off for all, and the owner turns
   their own on in the admin page.
2. **How far does lb and mile go in this PR?** Recommended: every screen a lifter or runner
   uses (set logging, set edit, program edit, history, session detail, metrics, records, the
   run logger, friends' feeds), with progression steps and the plate calculator shown converted
   (a 2.5 kg step shows as 5.5 lb). lb-native steps and plates (5 lb, 45 lb bar) go to
   `BACKLOG.md`. The smaller option is endurance units only (km/mi, pace, swim) and kg only.
3. **Run the ghost cleanup in prod?** The script is ready after merge. Recommended: the owner
   runs the dry run in the prod pod, reads the list, then runs `--delete`. An agent never runs
   it against prod.

## Files

`src/lib/mcp/tools/programs.ts`, `src/lib/mcp/tools/profile.ts`, `src/lib/mcp/tools/cycles.ts`,
`src/lib/utils/triathlon-plan.ts`, `src/lib/actions/workout-sessions.ts`,
`src/lib/actions/training-cycles.ts`, `src/lib/actions/admin.ts`,
`src/lib/actions/triathlon-plan.ts`, `src/lib/periodization-sync.ts`, `src/lib/utils/format.ts`,
`src/lib/garmin/dates.ts`, `src/db/schema/users.ts`, `src/app/page.tsx`,
`src/app/settings/page.tsx`, `src/app/cycles/triathlon/page.tsx`,
`src/components/features/WorkoutSessionInitializer.tsx`,
`src/components/features/CyclesListClient.tsx`, `src/components/features/EditCycleForm.tsx`,
`src/components/features/AdminUsersClient.tsx`, `src/components/features/SettingsClient.tsx`,
`scripts/cleanup-ghost-sessions.ts` (*new*), `package.json`, `Dockerfile`,
`docs/privacy/data-inventory.md`, `src/app/privacy/page.tsx`, `src/lib/constants/legal.ts`.
