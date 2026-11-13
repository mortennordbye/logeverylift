# Structured workouts, planned vs done, missed sessions and sick periods

Packages C4 and C5 of [`triathlon-coach-plan.md`](triathlon-coach-plan.md), in one branch and one
PR (`feat/workouts-c4-c5`). Inputs: the audit (`docs/triathlon-coach-audit.md`, sections 3, 3b, 4
and 9, decisions D3, D9, D11, D13, D18, D19, D20, T5, T6, T7), the research
(`docs/research/endurance-training-reference.md`: "Every workout format reduces to the same
tree", "Store anchors, derive zones", "Illness follows the IOC severity grades", "Missed sessions
are skipped, not stacked"), `CLAUDE.md`, `TESTING.md`, and the merged briefs
[`foundations.md`](foundations.md), [`revisions.md`](revisions.md), [`ai-coach.md`](ai-coach.md),
[`mcp-access.md`](mcp-access.md), [`seasons.md`](seasons.md) and
[`athlete-profile.md`](athlete-profile.md). Package C2 (dated planned sessions) is built in
parallel on `feat/sessions-c2`; its brief is `docs/plans/sessions.md` on that branch. This brief
builds on C2's model. Section 12 lists what depends on C2's final code.

Status: building, 2026-11-13. The hub decided the open questions on 2026-11-13 (section 18,
"Decisions"). C2 merged in PR #229 and this branch is rebased on it; section 19 says where the
build differs from this brief. The findings describe `main` at 7ca6da4 (after PR #227); every
`file:line` in them was opened then.

## 0. Goal

After this PR, for a user with the endurance switch on:

1. An endurance session can be a **structured workout**: a tree of steps (warm-up, work,
   recovery, cool-down, rest), repeat blocks, an end per step (time, distance or lap button) and
   a target (power, heart rate, pace or cadence) as a share of the user's own threshold or as an
   absolute range (D9). One Zod schema checks it everywhere: Server Actions, MCP, export and
   every read of a stored workout. The check is never overridable (D3).
2. Swim workouts know the pool length, send-off times and CSS-based targets. A brick is two
   linked sessions on one day.
3. A **workout library** holds reusable workouts. A workout attaches to one dated planned session,
   or to a weekday slot of the cycle template, which copies it into each generated session.
4. Each dated session is **matched** to what was done: a session logged in the app, or (for
   admins) a Garmin activity. If nothing matches when the day has passed, the app asks "Did you
   do it?" (D11).
5. A confirmed miss of an easy session is skipped. A confirmed miss of a key session gets a
   suggested free day in the same week, never next to a hard day, and the user taps to move it
   (D19).
6. A **sick period** is one entry. Sessions inside it read as missed by illness, with no prompt.
   The assistant gets the IOC 2022 return rule (D20).
7. Each session has a **compliance** band, and the user has a **consistency** number (the share
   of weeks with at least 80% of the planned sessions done).
8. The weekly sync's adherence reads dated sessions. **A lifter sees no change** (section 6.10).
9. The assistant can do all of it over MCP, and reads the step syntax as an MCP resource.

Out of scope: the today and week views, the step editor, the guided player, the pool view and
per-step results (C6); session-RPE load and TSS (D1); delivery to a watch (E3, D13 open); the
D2 rules after part 1.

## 1. Findings in the code

### 1.1 Endurance plans today are flat program sets

- An endurance segment is one `program_sets` row: `durationSeconds`, `distanceMeters`,
  `inclinePercent`, `targetHeartRateZone` (1-5) and `restTimeSeconds`
  (`src/db/schema/programs.ts:170-188`). The weekly sync scales sets that carry
  `peakDistanceMeters` or `peakDurationSeconds` (`src/db/schema/programs.ts:176-182`). A set with
  `sessionRole` "work" is a hard interval rep whose zone and rest the sync swaps by phase
  (`src/db/schema/programs.ts:195-198`).
- There are no columns for power, pace or cadence targets, and no repeat blocks. A swim of
  10 × 100 is ten rows.
- An exercise has a `discipline` (swim, bike or run), null for everything else
  (`src/db/schema/exercises.ts:79`, column at `src/db/schema/exercises.ts:106`).
- The triathlon generator marks swim, bike and run days as `autoComplete`, "usually recorded on
  a watch", so the day counts as done by itself (`src/lib/utils/triathlon-plan.ts:102-106`).

### 1.2 Logging

- A logged set holds `durationSeconds` and `distanceMeters` (`src/db/schema/workout-sets.ts:94-95`)
  and an RPE (`src/db/schema/workout-sets.ts:106`), and points at the planned set it came from
  (`src/db/schema/workout-sets.ts:71`).
- A session's `source` is `app`, `auto` or `assistant` (`src/db/schema/workout-sessions.ts:70`).
  An `auto` session has no sets.
- MCP `log_session` writes a session with sets inside the tool: a per-day advisory lock, a
  duplicate check, the delete of an auto row for the same program and day, and a PR rebuild
  (`src/lib/mcp/tools/sessions.ts:155-212`). No module outside the tool does this, so an app
  "Yes, I did it" would have to copy it.
- MCP `confirm_session` marks a day done with an `auto` row and no numbers
  (`src/lib/mcp/tools/sessions.ts:224`, insert at `src/lib/mcp/tools/sessions.ts:264`).

### 1.3 Weekly sync adherence (PZ-26)

- `cycleAdaptationSignals` counts completed sessions of the cycle's programs in the last 7 days
  that have sets or are `auto` (`src/lib/periodization-sync.ts:130-147`), over the number of
  program slots, capped at 1 (`src/lib/periodization-sync.ts:150`). The slot list comes from
  `liveSlotProgramIds` (`src/lib/periodization-sync.ts:186`).
- The percent only scales sets with a peak anchor (`src/lib/periodization-sync.ts:280-287`). It is
  stored on the cycle for every cycle (`src/lib/periodization-sync.ts:297`), but the only
  screen that shows it, `getCyclePeriodization`, returns null when no set has a peak anchor
  (`src/lib/actions/training-cycles.ts:512`, `src/lib/actions/training-cycles.ts:542`). So a
  lifter never sees adherence today.
- `wearableSuggestion` reads the same signals (`src/lib/periodization-sync.ts:367`).

### 1.4 Training limits read intensity from program sets

- `isHardSession` calls a session hard when an endurance set is a `work` rep or targets zone 4-5
  (`src/lib/utils/training-limits.ts:155`). The limit is 3 a week
  (`src/lib/utils/training-limits.ts:145`).
- `cycleWeekSessions` builds the week from slots (`src/lib/training-limits.ts:152`), and
  `programRuns` reads run durations from program sets (`src/lib/training-limits.ts:111`). C2
  moves the week onto dated sessions. Neither knows a workout without program sets.

### 1.5 Garmin

- Garmin is on only for admins with the key (`garminAllowedFor`, `src/lib/garmin/access.ts:20`).
- An activity row has `startTimeLocal`, `activityType` and the raw `data`
  (`src/db/schema/garmin.ts:82-93`). `sportOf` maps the type to swim, bike, run, strength or
  other (`src/lib/garmin/analytics/sport.ts:8`).
- `matchStrength` matches a logged strength session to one activity by time overlap, one to one
  (`src/lib/garmin/analytics/daily.ts:82`). Nothing matches endurance activities to a plan.
- `findBricks` finds a run that starts within `BRICK_GAP_MIN` (15) minutes of a ride
  (`src/lib/garmin/analytics/demands.ts:68`, `src/lib/garmin/analytics/demands.ts:72`).

### 1.6 Thresholds and units

- Threshold kinds are `ftp`, `lthr_bike`, `lthr_run`, `run_threshold_pace`, `swim_css` and
  `max_hr` (`src/db/schema/athlete-profile.ts:27`). Pace and CSS are stored as speed in m/s.
  `currentThresholds` picks the current value per kind (`src/lib/utils/thresholds.ts:336`);
  `paceToSpeed` and `speedToPace` convert (`src/lib/utils/thresholds.ts:78`,
  `src/lib/utils/thresholds.ts:83`).
- The athlete profile has `availableDays` (`src/db/schema/athlete-profile.ts:73`).
- Display units are on the user (`src/db/schema/users.ts:55-56`); storage stays metric. The
  endurance switch is `enduranceEnabled` (`src/db/schema/users.ts:60`), read with
  `enduranceEnabledFor` (`src/lib/endurance.ts:18`).

### 1.7 Revisions and MCP plumbing

- Object types are a text enum (`src/db/schema/plan-revisions.ts:21`), so a new type needs no
  SQL. One-row objects (memory, athlete, threshold, injury) share one code path
  (`src/lib/plan-revisions.ts:141`, `tableOf` at `src/lib/plan-revisions.ts:151`). Every plan
  write runs in `planWrite` (`src/lib/plan-revisions.ts:462`).
- MCP resources are the docs in `MCP_RESOURCE_DOCS` (`src/lib/mcp/resource-docs.ts:9`), read
  from disk with a version (`registerResources`, `src/lib/mcp/resources.ts:65`).
- The MCP route registers the athlete tools with the endurance flag
  (`src/app/api/[transport]/route.ts:107`, `src/app/api/[transport]/route.ts:121`).

### 1.8 Privacy

- The export is `collectUserData` (`src/lib/account-data.ts:69`); injuries are in it
  (`src/lib/account-data.ts:148`).
- `CONSENT_VERSION` was raised for injuries (`src/lib/constants/legal.ts:17`); `LEGAL_VERSION`
  is at `src/lib/constants/legal.ts:7`. The sign-up health consent names "injuries and notes"
  (`src/components/features/ConsentChecks.tsx:38-39`). The MCP consent page lists thresholds,
  the athlete profile and injuries (`src/app/oauth/consent/page.tsx:50`,
  `src/app/oauth/consent/page.tsx:57`).
- Friends see completed workouts through `getFriendSessionDetail`
  (`src/lib/actions/friends.ts:1096`), never notes, heart rate zones, thresholds or injuries.

### 1.9 What C2 brings (written from its brief; merged in PR #229)

- A table of dated planned sessions, one row per session, with date, position in the day,
  program, label, notes, auto flag, a status (planned or skipped), a "touched" time, a version
  and soft delete. Rows are made for the whole block of a weekday cycle. Rotation cycles get a
  projection with stored overrides.
- Done and missed are derived on read by a pure matcher: linked session first, then the same
  program on the date, then any completed session on the date.
- A template edit regenerates only untouched future rows (T7).
- Logged sessions get a link to their planned session.
- MCP `list_planned_sessions` and `manage_planned_session` (move, skip, unskip, change, add,
  remove, reset), and the limits read the week from the dated rows.
- C2 left the weekly sync adherence to this package (its decision 11).

## 2. Design overview

- **A workout is JSON, checked by one Zod schema** in a pure module. It is the only shape for
  steps in the app, MCP, export and the resource doc. Targets are stored relative to an anchor
  (FTP, threshold heart rate, threshold pace, CSS) and resolved to watts, bpm or pace only when
  shown, as the research says. A new threshold then updates every future workout at once.
- **The library is a table of workouts.** A planned session gets its **own copy** of a workout,
  never a reference, so a past session keeps what was planned, and compliance compares against
  it (T7: past sessions never change).
- **A planned session runs a program or a workout, not both.** Strength and the existing
  program-based endurance sessions keep working as they are.
- **Done stays derived** (C2). This package adds steps to the matcher (Garmin, a stricter rule for
  endurance) and two stored answers: a confirmed miss and a pinned Garmin activity.
- **Illness is derived per session** from the sick periods, so a change to the period's dates
  is always right. Nothing is stored on the sessions.
- **The plan never changes by itself.** The app suggests a day for a missed key session; the user
  taps. The assistant moves it over MCP (D1, D19).

## 3. The workout schema (C4)

Pure module `src/lib/utils/workout-steps.ts` (*new*): the Zod schema, the extra rules, the
resolver, the estimate, the text summary and the hard-session rule. Unit tested. The research
model ("Plans become data") is the source; where this schema differs, the reason is given.

### 3.1 Shape

```text
Workout   = { v: 1, sport: "swim" | "bike" | "run", name, description?, poolLengthM?, steps: Node[] }
Node      = Step | Repeat
Repeat    = { id?, type: "repeat", count: 2-50, steps: Step[] }        // one level, no nesting
Step      = { id?, type: "warmup" | "work" | "recovery" | "cooldown" | "rest",
              end: End, target?: Target, cadence?: { low, high },
              sendOffSeconds?, stroke?, equipment?, note? }
End       = { type: "time", seconds } | { type: "distance", meters } | { type: "lap" }
Target    = { metric: "power", anchor: "ftp", low, high }               // % of FTP
          | { metric: "power", anchor: "ftp", zone: 1-5 }                // Coggan zone, research table
          | { metric: "hr", anchor: "lthr" | "max_hr", low, high }       // % of the anchor
          | { metric: "hr", anchor: "lthr", zone: 1-5 }                  // Friel zone
          | { metric: "pace", anchor: "threshold_pace" | "css", low, high }  // % of threshold speed
          | { metric: "pace", anchor: "css", offsetLow, offsetHigh }    // CSS + seconds per 100 m
          | { metric: "power" | "hr" | "pace" | "cadence", anchor: "absolute", low, high }
```

- Absolute values are metric: watts, bpm, m/s for pace, rpm for cadence. Percent targets for pace
  are a percent of threshold **speed**, so 90% is slower than threshold. Pace is never stored as
  time per km, because pace ranges invert (research, "Plans become data").
- `lthr` resolves to `lthr_bike` on a bike and `lthr_run` on a run. A swim has no heart rate
  anchor; it uses `max_hr` or absolute values.
- `id` is optional on input. The server fills each missing id (`s1`, `s2`, ...) and keeps given
  ones. Ids are unique in the workout and stay stable on edit, so C6 can store per-step results.
- `cadence` is a second target, as in FIT. Bike and run only.
- No RPE targets and no ramps in version 1 (open question 15).

### 3.2 Rules (the schema check, never overridable)

Zod plus `superRefine`, so every rule runs in one parse and returns every problem with its path
(`steps[1].steps[0].target.low: must be at most high`). There is no override argument anywhere
(D3). The rules:

1. Sizes: 1-100 nodes; a repeat holds 1-10 steps; at most 400 steps once repeats are expanded;
   `name` 1-80 chars; `description` at most 1,000; `note` at most 140; the JSON at most 32 KB.
2. Ranges: time 5 s to 12 h; distance 10 m to 300 km; power 30-200% of FTP or 20-2,000 W; heart
   rate 50-110% of LTHR, 40-100% of max HR or 60-230 bpm; pace 50-130% of threshold speed, CSS
   offset -20 to +60 s per 100 m, or 0.3-12 m/s; cadence 20-200 rpm; `low` at most `high`.
3. Sport fits anchor: power and cadence on bike (cadence also on run); `threshold_pace` on run;
   `css` on swim; `lthr` on bike and run.
4. One level of repeats (research: one level, flatten on export).
5. Swim: `poolLengthM` is 10-100 (25 yd is 22.86) or absent for open water. In a pool every
   distance is a whole number of lengths (1 cm tolerance). `sendOffSeconds` (20-600) only on a
   swim `work` step inside a repeat, and that repeat then holds no `rest` step, because the
   send-off includes the rest. `stroke` (`free`, `back`, `breast`, `fly`, `im`, `choice`,
   `kick`, `pull`, `drill`) and `equipment` (`pull_buoy`, `paddles`, `fins`, `kickboard`,
   `snorkel`) only on swim.
6. Unknown keys fail (`.strict()`), so a typo is an error, not a lost field (the lesson of audit
   bug 1).

Stored JSON is parsed with the same schema on every read. A row that fails (it should never
happen) is logged as `[workouts] invalid_stored` with its id, and the screen says "This workout
cannot be shown" instead of failing. `v` lets a later version add a migration function in code.

### 3.3 Resolving targets

`resolveWorkout(workout, thresholds, units)` gives each step its target in the user's numbers:
watts, bpm, pace per km or mile, swim pace per 100 m or 100 yd. Zones use the research table
("Store anchors, derive zones"): Coggan for power, Friel for heart rate. A missing anchor leaves
the target as text ("88-93% FTP, no FTP set") and lists the anchor under `missingAnchors`. The
resolver is used by the MCP reads and the text summary now, and by C6 and any export later.

### 3.4 Derived values

- **Estimate.** Total time and distance. A time step adds its time; a distance step adds its
  distance, and its time when the target gives a speed (or, for a send-off, exactly the
  send-off). A lap step adds nothing and marks the estimate `partial`.
- **Text summary.** One line, in the user's units: "15 min warm-up 50-70% FTP · 3 × (10 min
  88-93% FTP, 5 min easy) · cool-down to lap". Used by MCP results, the library list and the
  planned session rows.
- **Hard workout** (*new* rule next to `isHardSession`): a repeat that holds a `work` step, or any
  `work` step whose target's slow end is in zone 4 or above (power at least 90% FTP; heart rate at
  least 94% LTHR on a bike or 95% on a run; pace at least 97% of threshold speed, or CSS + 3 s
  per 100 m or faster). This matches today's rule for sets (a `work` rep, or zone 4-5). The pace
  bounds are inference: the research table has no pace zones.
- **Priority.** Stored as `key`, `support` or `optional`, or null. Null reads as `key` when the
  session is hard, or when it is the longest bike or run of its week and at least 90 minutes
  (D11: "long ride, long run, race-specific session"; the 90 minutes is inference); otherwise
  `support`. Strength sessions read as `support`.

### 3.5 Examples

These three are also in the MCP resource doc, and a unit test parses every JSON block of that doc
with the schema (section 11), so the doc and the code cannot drift.

**A bike interval session.** With FTP 250 W, the work steps resolve to 220-233 W.

```json
{
  "v": 1,
  "sport": "bike",
  "name": "3 × 10 min sweet spot",
  "steps": [
    { "type": "warmup", "end": { "type": "time", "seconds": 900 },
      "target": { "metric": "power", "anchor": "ftp", "low": 50, "high": 70 } },
    { "type": "repeat", "count": 3, "steps": [
      { "type": "work", "end": { "type": "time", "seconds": 600 },
        "target": { "metric": "power", "anchor": "ftp", "low": 88, "high": 93 },
        "cadence": { "low": 85, "high": 95 } },
      { "type": "recovery", "end": { "type": "time", "seconds": 300 },
        "target": { "metric": "power", "anchor": "ftp", "zone": 1 } }
    ] },
    { "type": "cooldown", "end": { "type": "lap" },
      "target": { "metric": "hr", "anchor": "lthr", "zone": 1 } }
  ]
}
```

**A swim set with send-offs.** 25 m pool. With CSS 1:45 per 100 m, the main set is 1:47-1:50 per
100 m, leaving each 100 m every 2:00.

```json
{
  "v": 1,
  "sport": "swim",
  "name": "10 × 100 on 2:00",
  "poolLengthM": 25,
  "steps": [
    { "type": "warmup", "end": { "type": "distance", "meters": 400 }, "stroke": "choice" },
    { "type": "repeat", "count": 4, "steps": [
      { "type": "work", "end": { "type": "distance", "meters": 50 }, "stroke": "drill", "note": "Catch-up" },
      { "type": "rest", "end": { "type": "time", "seconds": 15 } }
    ] },
    { "type": "repeat", "count": 10, "steps": [
      { "type": "work", "end": { "type": "distance", "meters": 100 }, "sendOffSeconds": 120,
        "stroke": "free", "target": { "metric": "pace", "anchor": "css", "offsetLow": 2, "offsetHigh": 5 } }
    ] },
    { "type": "cooldown", "end": { "type": "distance", "meters": 200 }, "stroke": "choice" }
  ]
}
```

**A brick.** Two planned sessions on one day; the run names the ride as its brick parent. Over
MCP:

```json
{ "operation": "add", "date": "2027-05-15", "priority": "key",
  "reason": "First race-pace brick of the build",
  "workout": { "v": 1, "sport": "bike", "name": "2 h endurance, last 20 min race pace",
    "steps": [
      { "type": "work", "end": { "type": "time", "seconds": 6000 },
        "target": { "metric": "power", "anchor": "ftp", "zone": 2 } },
      { "type": "work", "end": { "type": "time", "seconds": 1200 },
        "target": { "metric": "power", "anchor": "ftp", "low": 75, "high": 80 } }
    ] } }
```

The result returns the new session's id, for example 812. Then:

```json
{ "operation": "add", "date": "2027-05-15", "brickParentId": 812,
  "reason": "Run off the bike",
  "workout": { "v": 1, "sport": "run", "name": "20 min off the bike",
    "steps": [
      { "type": "work", "end": { "type": "time", "seconds": 1200 },
        "target": { "metric": "pace", "anchor": "threshold_pace", "low": 85, "high": 90 } }
    ] } }
```

With threshold pace 4:00 per km, the run target resolves to 4:27-4:42 per km.

### 3.6 FIT export later (D13 open)

No export code in this PR. The model maps onto FIT `workout_step` messages without loss, which is
what the plan asks:

| Schema | FIT |
|---|---|
| `type` warmup, work, recovery, cooldown, rest | `intensity` warmup, active (interval), recovery, cooldown, rest |
| `end` time, distance, lap | `duration_type` time, distance, open |
| `repeat` | a `repeat_until_steps_cmplt` step after its children, pointing back to the first |
| `target` power, hr, pace | `target_type` power, heart_rate, speed, resolved to absolute values with the FIT offsets (watts + 1000, bpm + 100), so a device cannot read watts as percent (research, the kaiord bug) |
| `cadence` | the secondary target |
| `poolLengthM`, `stroke`, `equipment` | `pool_length`, `swim_stroke`, `equipment` |
| `sendOffSeconds` | the step plus a rest step ending at the send-off, from the resolved pace |

The resolver (3.3) is the part an export would reuse.

## 4. Data model

### 4.1 Library: `workouts` (*new*)

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `user_id` | text, FK `user`, cascade | Owner |
| `name` | text, not null | Copied from the JSON for lists and search |
| `sport` | text enum `swim`, `bike`, `run` | Copied from the JSON |
| `workout` | jsonb, not null | The workout, valid by section 3 |
| `priority` | text enum `key`, `support`, `optional`, null | Default for sessions made from it |
| `version`, `deleted_at`, `created_at`, `updated_at` | | As `coach_memory` (T6, T9) |

Index `(user_id, sport)`. Cap: 300 live workouts per user.

### 4.2 New columns on C2's planned sessions

| Column | Type | Meaning |
|---|---|---|
| `workout` | jsonb, null | This session's own copy of a workout. Null for a program session |
| `workout_id` | integer, null, FK `workouts`, set null | The library workout it was copied from, for "Update from library" and for regeneration. Not read for content |
| `priority` | text enum, null | 3.4. Null = derived |
| `brick_parent_id` | integer, null, FK self, set null | The session this one follows in a brick |
| `garmin_activity_id` | integer, null, FK `garmin_activities`, set null | A Garmin activity the user or the assistant picked for this session (6.4). Deleting Garmin data clears it, and the session reads by the other rules again |
| `missed_reason` | text, null, at most 200 | Free text with a confirmed miss |
| `status_on` | date, null | The user's date when the status last changed to `skipped` or `missed`. Tells a plan change (skipped before the day) from a miss (6.8) |

C2's `status` gets one more value: `missed` (the user confirmed a miss). C2's brief said C5 would
add `missed_illness`; it is not stored, because illness is derived (6.7).

A check constraint: `program_id` and `workout` are not both set. A session with `workout` and no
program is valid; C2's generation only skipped slots with no program, which section 5 changes.

### 4.3 New columns on `training_cycle_slots`

| Column | Type | Meaning |
|---|---|---|
| `workout_id` | integer, null, FK `workouts`, set null | A library workout instead of a program |
| `priority` | text enum, null | Copied to generated sessions |
| `brick_with_next` | boolean, not null, default false | The next slot of the day is the run of a brick |

A slot holds a program or a workout, or nothing (rest). Weekday cycles only.

### 4.4 Sick periods: `illness_periods` (*new*)

| Column | Type | Meaning |
|---|---|---|
| `id` | serial | |
| `user_id` | text, FK `user`, cascade | Owner |
| `started_on` | date, not null | First sick day, user's zone |
| `ended_on` | date, null | Last sick day. Null = still sick |
| `severity` | text enum `mild`, `moderate`, `severe`, null | IOC 2022 grades, shown with their plain meaning (6.7) |
| `notes` | text, null, at most 500 | In the user's words |
| `version`, `deleted_at`, `created_at`, `updated_at` | | As `athlete_injuries` |

Index `(user_id, started_on)`. Periods of one user may not overlap (checked in the write, under
the user's lock). Cap: 200 live rows. `started_on` at most today; `ended_on` on or after
`started_on`, and at most 14 days after today (a planned end, "sick until Sunday").

### 4.5 Revisions

- Two new one-row object types: `workout` and `illness`, with table lookup, snapshot
  (`{ v: 1, workout: row }`, `{ v: 1, illness: row }`), restore by the same id, history text
  ("Steps changed: 3 × 10 min → 3 × 12 min", "Sick period 3-7 Mar → 3-9 Mar"), change-set undo,
  Recently deleted and the 90-day purge. Lock order: after `injury`.
- `illness` needs the endurance switch for restore and list, as `injury` does.
- The C2 `planned_session` snapshot carries the new columns. Its history text adds: workout set,
  changed or cleared; priority changed; brick linked or unlinked; confirmed missed; activity
  picked.
- A library edit regenerates the untouched future sessions of the cycles whose live slots use
  that workout, in the same write (section 5). The write touches those cycles first, in A4's lock
  order (cycles before one-row objects).

### 4.6 Field owners

| Field | Owner (writers) | On restore |
|---|---|---|
| Library `workout`, `name`, `sport`, `priority` | user, assistant | Restored |
| Session `workout`, `workout_id`, `priority`, `brick_parent_id` | user, assistant; regeneration while untouched | Restored. Refused on a done session, as C2 |
| Session `status` `missed`, `missed_reason`, `garmin_activity_id` | user, assistant (answers) | Restored |
| Session `status_on` | set by the write that changes the status | Restored with the row |
| Slot `workout_id`, `priority`, `brick_with_next` | user, assistant | Restored with the cycle |
| Illness rows | user, assistant | Restored |

The weekly sync never writes a workout. It still owns only the program set fields in audit
section 8. To change a structured session's volume, the assistant edits the session.

## 5. Attaching workouts

- **Library to session.** "Use this workout" on a planned session copies the library JSON into
  the session's `workout`, sets `workout_id`, and clears `program_id`. The session is touched (C2),
  so regeneration leaves it alone.
- **Inline.** The assistant can set a session's workout from JSON with no library entry. Most
  week-by-week plans work this way: each date gets its own session.
- **Slot.** A weekday slot can point at a library workout. Generation then makes one session per
  date with a copy of it (C2's generation, with "a slot with a program" read as "a slot with a
  program or a workout"). Bricks: when `brick_with_next` is set, the next slot's session gets the
  first one's id as `brick_parent_id`.
- **Library edits.** Editing a library workout counts as a template change for every live active
  or scheduled cycle whose slots use it: its untouched future sessions get the new copy (T7). Past,
  done and touched sessions keep theirs. The result says how many sessions changed.
- **"Update from library"** on a touched session copies the library's current JSON again (a user
  or assistant write, a revision).
- **Bricks.** Both sessions are on one date, the run after the ride in `position`. Moving the
  first moves both; the second cannot move alone (refused with "Move the brick by its first
  session, or unlink it"). Skipping one does not skip the other. A deleted parent leaves the run as
  a normal session (FK set null). Each leg is matched and scored on its own.
- **Rotation cycles** get no workouts and no bricks (open question 4).

## 6. Planned vs done (C5)

All rules in this section are pure functions in `src/lib/utils/session-compliance.ts` (*new*),
unit tested. Each training rule cites the research section and its evidence label in a comment.

### 6.1 The sport of a session

A session with a workout has the workout's sport. A program session has a sport when its live
endurance exercises all share one discipline. Otherwise it has no sport, and C2's rules apply
unchanged (strength, mixed).

### 6.2 The state of a session

One function gives every planned session one state, in this order (first match wins):

1. **done (linked):** a completed workout session links to it (C2 step 1).
2. **done (picked):** `garmin_activity_id` is set (admins only).
3. **skipped:** status `skipped` (C2).
4. **missed (confirmed):** status `missed`.
5. **done (app):** C2 steps 2 and 3. For a session with a sport and the switch on, step 3 accepts
   only a completed session with a set of an exercise of that discipline, so a strength session no
   longer clears a planned run (C2 left this to C5, its decision 8). A completed session with sets
   of two disciplines can clear one session of each, so a brick logged as one session clears
   both legs.
6. **done (Garmin):** 6.4 (admins only).
7. **illness:** the date is inside a sick period. Past: missed by illness. Today or later: "sick".
8. **unconfirmed:** a session with a sport, the switch on, the date before today and within the
   last 7 days. The app asks "Did you do it?" (6.5).
9. **missed:** any other session dated before today (C2's meaning).
10. **planned:** the rest.

Lifters (switch off) get steps 1, 3, 5 (C2's rules), 9 and 10 only: exactly C2's result.

**Auto days.** With the switch on, a session with a sport writes no auto row, even when its slot
has `autoComplete`; it goes through Garmin or the prompt instead (D11: confirm first). Old auto
rows stay. Strength auto days and every lifter auto day are unchanged (open question 7).

### 6.3 Matching what was logged in the app

C2's matcher, with the stricter step 3 above. A confirmed "Yes, I did it" writes a linked
session, so it is step 1.

### 6.4 Matching Garmin activities (admins)

D11: sport, day, time or distance.

- Candidates: the user's activities whose `sportOf` is the session's sport and whose local start
  date is the session's date. "Other" and strength activities never match an endurance session.
- An activity already matched to a logged app session of the same sport (by time overlap, as
  `matchStrength` does) is that session's data, not a second "done".
- Several sessions and activities of one sport on one day: pair them so that the planned and done
  durations (or distances, when the plan has no duration) are as close as possible, in order of
  position. Each activity is used once.
- No minimum size: a short activity still matches, and its compliance band shows the gap.
- A picked activity (`garmin_activity_id`) is never used for another session.
- Derived on read, so a late Garmin sync turns a session done without a write. Done wins over a
  confirmed miss only through a pick or a link (6.2 order): if the user said "missed", a later
  activity does not overrule them; the prompt sheet offers to pick it.

### 6.5 "Did you do it?"

For each **unconfirmed** session, the home screen shows a card (section 7) with three answers:

- **Yes.** A sheet asks time (required), distance (optional) and RPE 1-10 (optional), and notes.
  For an admin, unmatched activities of the same sport from that day and the day before or after
  are listed first; picking one sets `garmin_activity_id` and writes nothing else. Otherwise the
  app writes a completed session (`source` `app`) dated on the planned date, linked to the
  planned session, with one set on the sport's system exercise (the lowest id with that
  discipline that is not custom) holding the time, distance and RPE. The write uses a module
  *new* in this PR, `src/lib/logged-sessions.ts`, moved out of MCP `log_session` (1.2), so the
  lock, the duplicate check, the auto-row delete and the PR rebuild are the same in both.
- **No, I missed it.** Status `missed`, `status_on` today, optional reason. Then 6.6.
- **I was sick.** The sick-period sheet opens with the session's date as the first day (6.7).

Sessions that passed more than 7 days ago are not prompted; they read as missed. The calendar day
sheet (C2) offers the same three answers for any past session of the block.

### 6.6 A missed session: skip or suggest a day (D11, D19)

- **Easy session** (priority `support` or `optional`): nothing more. The plan goes on (research:
  "Missed sessions are skipped, not stacked", coach convention).
- **Key session:** the app suggests one day. `suggestMoveDay` (*new*, pure) picks the earliest
  date that is:
  1. after the missed date, today or later, and on or before the Sunday of the missed session's
     week (D11: "in the same week");
  2. an available day, when the athlete profile has `availableDays`;
  3. not inside a sick period;
  4. free of key or hard sessions (planned or done, not skipped);
  5. not next to a day with a key or hard session, the day before or after (D19: never next to a
     hard day; research: no hard session within 24 h either side). Key sessions count as hard
     here, because a long ride next to a long run is the stacking the research warns against.
  A day with no session at all comes before a day with only easy ones.
- The card then shows "Move to Thu 14 Nov" as one button. The tap runs C2's move (writer `user`,
  a revision), which sets the status back to `planned` on the new date. With no such day: "No free
  day this week. Skip it and go on." and nothing else.
- The assistant sees the suggestion in `list_planned_sessions` and may move the session directly
  (D19), through C2's move with its limits.

### 6.7 Sick periods and the return rule (D20)

- **One entry.** "Sick from X to Y", or from X with no end yet. Sessions in those days read as
  "illness" (6.2): no prompt, no suggestion. A session done anyway stays done.
- **Severity** is optional, shown with the IOC meaning: mild (nose and throat only, no fever),
  moderate (cough or short of breath), severe (fever over 38 °C, chills, aches, chest pain or a
  racing heart).
- **The return rule** (research, "Illness follows the IOC severity grades", consensus): before
  moderate or hard training, a 10-20 minute test at 60-70% of normal intensity; stop and see a
  doctor if fatigue, breathlessness, chest pain, dizziness, palpitations or an unusually high heart
  rate come during it or within 24 hours. Then 2-3 easy days (inference). Severe, or longer than 7
  days: see a doctor before training (consensus).
- `returnInfo` (*new*, pure) gives the phase (`sick`, `returning`, none), the days since the
  end, the severity, the endurance sessions done since the end, and the rule text with its
  evidence labels. `returning` lasts from the day after the end until the first done endurance
  session after it, at most 7 days.
- The app shows the rule; it does not change the plan. The assistant reads the same info and
  adapts only when the user asks (plan section 1).
- Users with the switch off have no sick periods (D18).

### 6.8 Compliance per session

- **Planned:** a workout's estimate (3.4), or for a program session the sum of its endurance
  sets' durations and distances.
- **Done:** for an app session, the sum of the matched discipline's sets; for a Garmin activity,
  its duration and distance from `data`.
- **Ratio:** done over planned by duration, else by distance (research: TSS first, then duration,
  then distance; planned TSS waits for D1).
- **Band** (research, TrainingPeaks colours, coach convention): `green` 0.80-1.20; `yellow`
  0.50-0.79 or 1.21-1.50; `orange` under 0.50 or over 1.50; `red` missed. A done session with no
  numbers to compare (strength, no plan numbers, an auto row) is `done`. Illness is `illness`.
  Skipped sessions have no band.

### 6.9 Consistency

- A week is Monday to Sunday in the user's zone.
- **Counted sessions** of a week: its planned sessions, minus sessions skipped before their day
  (`status` `skipped` and `status_on` before the date: a plan change), minus today's and future
  sessions that are not done. Missed, confirmed missed and illness all count as not done: the IOC
  study counts modified weeks against the athlete.
- **A week is complete** when at least 80% of its counted sessions are done. Weeks with no
  counted sessions are left out.
- **Consistency** = complete weeks / weeks counted, over the last 12 full weeks, with this week's
  "4 of 6 done" next to it. Evidence: IOC 2022 (study) for the 80% predictor; computing it per
  week from sessions is inference. Both labels go in the code comment and the MCP result.

### 6.10 Weekly sync adherence moves to dated sessions

- **Switch on, weekday cycle with generated sessions:** adherence = done / counted sessions of the
  cycle dated in the 7 days before today, plus today's done ones, capped at 1. "Done" and
  "counted" are 6.2 and 6.9, so Garmin matches, picks and confirmed sessions count, plan skips
  leave the count, and illness counts as not done (research: 5-10 days of illness, 3-5 days at
  50-70% volume; the sync eases 10% under 60% adherence). Readiness and RPE come from the
  matched app sessions. No counted session gives the neutral case (100), as week 1 does today.
- **Switch off, or a rotation cycle:** `cycleAdaptationSignals` runs as it is today (PZ-26),
  unchanged code.
- **Why a lifter sees no change, three ways.** (1) The new count runs only with the switch on;
  with it off the old function runs byte for byte, and C2's characterization test C9 (the same
  percent for a fixed week) must stay green. (2) Even if it ran, the percent only scales sets with
  a peak anchor (1.3), which lifter cycles do not have, and the only screen that shows it returns
  null for them. (3) An integration test seeds a lifter cycle, logs a week, and asserts the stored
  `adaptationPct`, the cycle summary and every lifter set are the same before and after this PR's
  code.
- `wearableSuggestion` uses the same signals, so it moves with them.

## 7. UI (data and flows only; views and the player are C6)

Everything here needs the endurance switch. A lifter's screens do not change. All client calls
go through `callAction()`. 44 px targets, `:active` feedback, primary actions in a pinned bottom
bar, destructive actions at the bottom (`CLAUDE.md`).

- **Home: "Did you do these?"** One row per unconfirmed session (newest first): name, date, the
  planned summary, and Yes, Missed. The card sits where "Missed this week" is; strength sessions
  of an endurance user keep "Missed this week" with Make up and Decline (C2). After "Missed" on a
  key session, the row shows the suggestion button or the "No free day" line.
- **Confirm sheet** (6.5) and the **sick-period sheet** (first day, last day or "still sick",
  severity with its meaning, notes; delete at the bottom with a confirm).
- **Home banners.** While sick: "Sick since Mon. Sessions are paused." with "I'm better" (sets
  the last day to yesterday, or today if chosen). While returning: the return rule in two lines,
  with "More" for the full text.
- **Calendar day sheet** (C2): each session shows its band as a coloured dot with a text label
  (not colour alone), its summary, and for a past session the three answers. "Use a workout" picks
  from the library; "Update from library" on a touched copy; "Link as brick" on the second
  session of a day.
- **Workouts library** at `/more/workouts` (*new*), in More under Training: list by sport with the
  text summary; Duplicate, Rename, Delete, Recently deleted. **No step editor** in this PR: the
  assistant creates and edits workouts until C6 adds one (open question 2, BACKLOG entry).
- **Athlete profile** (`/more/athlete`): a "Sick periods" section (list, add, end) and the
  consistency line ("Consistency: 9 of the last 12 weeks at 80% or more").

## 8. MCP tools and the resource

Conventions from ai-coach.md: `readOnlyHint` on reads; every write takes `reason`, and
`expectedVersion` on an existing object; results return the new version and the `changeSetId`.
All values metric. The endurance tools register only with the switch on (route, 1.7). Schema
errors return every problem with its path and are never overridable; the limit override (D2 part
1) does not apply to them.

| Tool | Hint | What |
|---|---|---|
| `list_workouts` (*new*) | read | The library: id, name, sport, priority, summary, estimate, version. Filter by sport, search by name |
| `get_workout` (*new*) | read | By `workoutId` or `plannedSessionId`: the JSON, the summary, the resolved steps (3.3), the estimate, `missingAnchors` |
| `manage_workout` (*new*) | write | `create` (`workout`, optional `priority`), `update` (id, any of them), `duplicate`, `delete`. An update says how many future sessions were regenerated, and runs the limits on the weeks they are in |
| `list_planned_sessions` (C2) | read | Each entry adds: sport, priority (stored and read), workout summary and estimate, brick parent, state (6.2) and how it was matched (`link`, `pick`, `app`, `garmin`), done duration and distance, ratio and band, `missedReason`, `suggestedMoveTo` for a missed key session, and the sick period id when in one |
| `manage_planned_session` (C2) | write | New operations: `set_workout` (`workout` JSON, or `workoutId` to copy from the library), `clear_workout`, `update_from_library`, `set_priority`, `link_brick` (`brickParentId`), `unlink_brick`. `add` accepts `workout`, `workoutId`, `priority`, `brickParentId`. `set_workout` and `add` run C2's limits (hard sessions a week, long-run cap) |
| `edit_cycle_slot` (C2) | write | Adds `workoutId`, `priority`, `brickWithNext` on weekday cycles |
| `confirm_planned_session` (*new*) | write | `plannedSessionId` and one of: `done` with `durationSeconds`, optional `distanceMeters`, `rpe`, `notes` (writes an `assistant` session through `src/lib/logged-sessions.ts`); `done` with `garminActivityId` (admins; a pick); `missed` with optional `reason`; `unmiss` (back to planned). The result has the state, the band and, for a missed key session, `suggestedMoveTo` |
| `get_compliance` (*new*) | read | `weeks` (1-52, default 12): per week the counted and done sessions by sport, complete or not; the consistency number; counts by band; the evidence labels. Registered for every user (open question 13) |
| `manage_illness` (*new*) | write | `add` (`startedOn`, optional `endedOn`, `severity`, `notes`), `update`, `end` (`endedOn`, default yesterday), `delete`. The result lists the sessions now read as illness and the return info |
| `get_athlete_profile` (C3) | read | Adds sick periods (the open one and the last 90 days) and `returnInfo` |
| `confirm_session` (existing) | write | Unchanged for lifters. With the switch on, for a session with a sport, it refuses and names `confirm_planned_session`, so no new auto row hides a miss |

**Resource.** `docs/mcp/workout-steps.md` (*new*), added to `MCP_RESOURCE_DOCS` as
`logeverylift://docs/workout-steps`: the shape (3.1), every rule (3.2) with its limits, how
targets resolve, the three examples (3.5), common errors and their fixes, and how a workout
attaches to a session or a slot. Dated near its top for the version.

**Instructions and `docs/mcp/app-rules.md`:** structured workouts and the library; a session runs
a program or a workout; the sync never edits workouts; the state list (6.2) and the missed rules
(D11, D19); sick periods and the return rule ("do not plan intensity until the athlete reports a
normal test; the app does not change the plan by itself"); compliance bands and consistency; read
`workout-steps` before the first workout write. The tool-group tests get the new tools.

## 9. Migration and rollback

One migration from `pnpm db:generate` (create, not rename), numbered after C2's (the hub
renumbers), SQL and `drizzle/meta/` in one commit. No `CREATE TYPE` (text enums).

- `CREATE TABLE workouts` and `illness_periods`, FKs cascade on the user, indexes (4.1, 4.4).
- `ALTER TABLE planned_sessions ADD COLUMN` `workout`, `workout_id` (FK set null), `priority`,
  `brick_parent_id` (FK set null), `garmin_activity_id` (FK set null), `missed_reason`,
  `status_on`; the check that `program_id` and `workout` are not both set.
- `ALTER TABLE training_cycle_slots ADD COLUMN` `workout_id` (FK set null), `priority`,
  `brick_with_next boolean NOT NULL DEFAULT false`.
- Every new column is null or has a default. No data step. `status` is text, so `missed` needs no
  SQL.

**Rollback.** Data lost: the library, workouts on sessions and slots, priorities, bricks, Garmin
picks, confirmed misses and their reasons, and the sick periods (health data: deleting it is the
safe direction). Sessions confirmed with "Yes" stay as logged workouts.

1. While the new code runs:
   ```sql
   DELETE FROM plan_revisions WHERE object_type IN ('workout', 'illness');
   UPDATE planned_sessions SET status = 'planned' WHERE status = 'missed';
   UPDATE planned_sessions SET workout = NULL WHERE workout IS NOT NULL;
   ```
   The old image's history reader fails on an unknown snapshot type (as for C1 and C3), and
   C2's code knows only `planned` and `skipped`. Sessions that had only a workout read as
   sessions with no program in C2, which C2 shows by label.
2. Deploy the previous image. It ignores the new tables and columns.
3. Then, optionally:
   ```sql
   ALTER TABLE planned_sessions DROP CONSTRAINT <the check>, DROP COLUMN workout,
     DROP COLUMN workout_id, DROP COLUMN priority, DROP COLUMN brick_parent_id,
     DROP COLUMN garmin_activity_id, DROP COLUMN missed_reason, DROP COLUMN status_on;
   ALTER TABLE training_cycle_slots DROP COLUMN workout_id, DROP COLUMN priority,
     DROP COLUMN brick_with_next;
   DELETE FROM training_cycle_slots WHERE program_id IS NULL AND <it was a workout slot>;
   DROP TABLE illness_periods;
   DROP TABLE workouts;
   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<hash of this migration>';
   ```
   Run the slot delete before the column drop (`WHERE workout_id IS NOT NULL`), so workout slots
   do not turn into rest days.
4. `CONSENT_VERSION` goes back with the old image. Users who accepted the newer text count as
   consented (`legalVersionBefore`), so nobody is asked twice.

## 10. Privacy steps (`privacy-compliance` skill)

1. **Inventory first** (`docs/privacy/data-inventory.md`).
   - Plans row: `workouts` (the library) and the new planned-session columns (workout, priority,
     brick, the picked Garmin activity, a confirmed miss with its reason). A miss reason is free
     text that can mention health, like program notes. Object type `workout` follows the Plans
     revision rule.
   - A new **Sick periods** row: `illness_periods` (dates, IOC severity, the user's notes).
     Purpose: plan training around illness with the user and their assistant. Basis Art. 6(1)(b)
     plus 9(2)(a). Retention: until the user deletes it or the account; a deleted period can be
     restored for 90 days, then it is deleted for good with its revisions; revisions follow the
     Plans rule (object type `illness`).
   - Health data line: add sick periods ("named in the sign-up consent from `CONSENT_VERSION`
     <new>").
   - Garmin: compliance reads activity duration, distance and sport for the user's own view and
     assistant; no new Garmin data is stored (the pick is an id).
2. **Recipients.** MCP row: workouts, compliance, confirm and miss answers, sick periods and the
   return info, read and (with read and change) written. Friends row: add "sick periods, missed
   sessions and compliance" to the "Never" list. The in-app AI (AI Setup, check-in) never gets
   sick periods.
3. **Policy** (`src/app/privacy/page.tsx`): sick periods as health data; structured workouts and
   compliance in the plans section; assistants can read and write them.
4. **Consent texts.** Sign-up health consent: add "sick periods" next to injuries. MCP consent
   page: workouts, compliance and sick periods in the read and the change lists.
5. **Versions.** Bump `LEGAL_VERSION`. Raise `CONSENT_VERSION` to it (a new kind of health data;
   rule in `src/lib/constants/legal.ts`). Every user sees the consent screen once; run the
   consent e2e check from C3.
6. **Export:** `workouts` and `illness_periods` in `collectUserData`, soft-deleted rows too; the
   coverage test fails until then. The new planned-session columns come with C2's table.
7. **Delete:** `user_id` cascades on both tables.
8. **Friends:** no friend reader touches the new tables or columns. A session confirmed with "Yes"
   is a normal logged workout and shows as one, as any logged run does today; its `missed_reason`
   and the planned session never do. A test asserts the friend session detail has no planned or
   illness fields.
9. **Logs:** ids and tags only (`[workouts]`, `[illness]`, `[compliance]`); never notes,
   severity, reasons or workout names.
10. **Browser storage:** none new.

## 11. Tests per layer

| Layer | What | File |
|---|---|---|
| Unit | Schema: the three examples parse; every rule in 3.2 refuses with the right path (nested repeat, low over high, anchor on the wrong sport, pool multiple, send-off with a rest step, unknown key, size limits); ids filled and kept | `src/__tests__/workout-steps.test.ts` (*new*) |
| Unit | Every JSON block in `docs/mcp/workout-steps.md` parses (or is marked as a wrong example and fails) | same |
| Unit | Resolver: FTP, LTHR per sport, threshold pace as speed, CSS percent and offset, zones, units (mi, yd), missing anchors | same |
| Unit | Estimate (time, distance, send-off, lap gives partial), summary text, hard workout, derived priority | same |
| Unit | State order (6.2) for every case, lifter path equals C2's matcher; strict step 3; a two-sport session clears one of each; Garmin pairing by closest duration; pick wins; confirmed miss beats a later activity | `src/__tests__/session-compliance.test.ts` (*new*) |
| Unit | Bands at 0.49, 0.50, 0.79, 0.80, 1.20, 1.21, 1.50, 1.51; ratio by duration then distance | same |
| Unit | Consistency: plan skips leave the count, illness counts against, empty weeks left out, the 80% boundary, today's sessions | same |
| Unit | `suggestMoveDay`: same week only, available days, illness, no key or hard day, no neighbour, empty day first, none found | same |
| Unit | `returnInfo` phases, severe or over 7 days, ends at the first done session or 7 days | same |
| Unit | Adherence from dated sessions (6.10) | `src/__tests__/periodization.test.ts` |
| Unit | Hard-session limit and long-run cap see workout sessions | `src/__tests__/training-limits.test.ts` |
| Unit | Revision diff text for `workout`, `illness` and the new planned-session fields; guard tests list both tables | `src/__tests__/plan-revisions.test.ts`, `src/__tests__/plan-write-guard.test.ts` |
| Component | "Did you do these?" card: Yes opens the sheet, Missed on a key session shows the suggestion, the move and the answers go through `callAction()`, a failed action leaves the row | `src/__tests__/components/did-you-do-it.test.tsx` (*new*) |
| Integration | Library create, update, duplicate, delete, restore; invalid JSON refused with paths and nothing written; cap; another user's id refused | `src/__tests__/integration/workouts.test.ts` (*new*) |
| Integration | Attach: copy on session, clears the program, touched; slot generation copies; library edit regenerates untouched future only (past, done, touched kept); bricks move together and refuse a lone move | same |
| Integration | Confirm Yes writes one linked session through the shared module (lock, duplicate, PR rebuild), equal to `log_session`; pick; missed; unmiss; auto rows not written for sport sessions with the switch on, still written for lifters | `src/__tests__/integration/session-compliance.test.ts` (*new*) |
| Integration | Sick periods: overlap refused, sessions read as illness, no prompt, done wins, end, return info; switch off refused | same |
| Integration | Weekly sync: switch off gives the same `adaptationPct` as before (C2's C9 unchanged); a lifter cycle's sets and summary unchanged; switch on counts Garmin, picks and confirms, leaves plan skips out | `src/__tests__/integration/training-cycles.test.ts` |
| Integration | MCP: every tool in section 8, happy path, stale `expectedVersion`, other user's ids, read-only scope refuses writes, switch off hides the tools, `confirm_session` refuses a sport session with the switch on, limits on `set_workout` into a full week, schema errors never overridable | `src/__tests__/integration/mcp-workouts-compliance.test.ts` (*new*), `src/__tests__/integration/mcp-scopes.test.ts` |
| Integration | Resource `workout-steps` reads with a version from a production build (B3's test) | `src/__tests__/integration/mcp-resources.test.ts` |
| Integration | Migration: columns, defaults, the check, FKs set null | `src/__tests__/integration/migrations.test.ts` |
| Integration | Export has `workouts` and `illness_periods`; delete removes them; purge; friend detail has no new fields | `src/__tests__/integration/account-data.test.ts` |
| e2e | Endurance user with a run yesterday: the card shows; Yes with 45 min; `testDb()` has a session linked to the planned session; the band shows in the calendar | `e2e/did-you-do-it.spec.ts` (*new*) |
| e2e | Missed key session: the suggestion shows, tap moves it, `testDb()` has the new date and a revision; missed easy session: no suggestion | same |
| e2e | Sick period from yesterday: no prompt for yesterday, the banner shows; "I'm better" ends it | same |
| e2e | A lifter's home with a missed day still shows "Missed this week" with Make up (C2's spec stays green, unchanged) | `e2e/cycle-day.spec.ts` |

Then `pnpm verify`, `make e2e` and the 9-step smoke pass in `CLAUDE.md` (the home card and the
session logging path change).

## 12. What depends on C2's final code, and how this PR adapts

This brief uses C2's brief as the API. Before any code, after C2 merges:

1. Rebase on `main`. Read C2's merged schema, `src/lib/utils/planned-sessions.ts`, the actions and
   the MCP tools, and its "Where the build differs from the brief" section.
2. Check each assumption below, and fix this brief in the same PR where the code differs:
   - the table and column names (`planned_sessions`, `status`, `touched_at`, `position`,
     `template_date`, `slot_id`, `version`, `deleted_at`) and `workout_sessions.planned_session_id`;
   - the matcher's input and output, so the state function (6.2) wraps it instead of copying it;
   - the generation and regeneration functions and the `planWrite` hook, for workout slots and
     library edits;
   - the move, skip and unskip actions and their rules (move from today to the block end; a
     missed session moves forward), so the suggestion tap calls them and the skip paths set
     `status_on`;
   - the MCP tool shapes (`list_planned_sessions`, `manage_planned_session`, `confirm_session`,
     `log_session`, `edit_cycle_slot`), so the new fields and operations extend them;
   - the limits' week builder, so workout sessions count as hard and long runs;
   - the home read (`todaySessions`, the missed list), so the "Did you do these?" card takes the
     endurance sessions out of "Missed this week";
   - C2's characterization tests, which must pass unchanged.
3. Regenerate this package's migration after C2's.
4. If C2 ships something this brief assumes differently (for example a stored "done"), follow the
   code and record it here.

## 13. Order of work

0. Before C2 merges (done): the pure modules `src/lib/utils/workout-steps.ts` and
   `src/lib/utils/session-compliance.ts` (schema, resolver, estimate, summary, hard rule; ratio,
   bands, consistency, `suggestMoveDay`, `returnInfo`), `docs/mcp/workout-steps.md` and their
   unit tests. The resource is not registered yet: it names tools that come with step 8. The
   derived priority (3.4) waits for C2, since it reads a session's week.
1. After C2 merges: rebase, check section 12, fix this brief. Run C2's characterization tests.
2. The weekly sync lifter test (6.10, point 3) on `main`, green, own commit, before any change.
3. Migration and schema.
4. Pure modules: `workout-steps.ts`, `session-compliance.ts`, the limits additions; unit tests.
5. Layer: object types `workout` and `illness`, snapshots, restore, purge, guards; library
   regeneration.
6. `src/lib/logged-sessions.ts` out of `log_session`, with its test first.
7. Server Actions: library, attach, bricks, confirm, missed, pick, sick periods; the state
   function in the home and calendar reads; auto rows; the sync adherence.
8. MCP tools, the resource doc, instructions, `app-rules.md`.
9. UI: home card and banners, sheets, calendar additions, the library page, the athlete section.
10. Privacy steps, e2e specs, `pnpm verify`, `make e2e`, smoke pass.

## 14. Defaults chosen

- A session holds its own copy of a workout; the library id is only its origin.
- A session runs a program or a workout, not both.
- The weekly sync never edits workouts.
- Step ids are filled by the server when missing and kept on edit.
- Done and illness are derived; only a confirmed miss and a Garmin pick are stored.
- A confirmed "Yes" is a normal logged session with one set, through the module `log_session`
  uses.
- The prompt covers the last 7 days, like C2's missed list.
- "At least 80%" for a complete week; 12 full weeks for consistency.
- Pace targets are a percent of threshold speed; CSS also takes seconds per 100 m.
- Schema limits as in 3.2; library cap 300; sick periods cap 200.

## 15. Risks

- **Home screen.** The card changes for endurance users only. C2's lifter e2e spec and
  characterization tests guard the rest; the smoke pass runs before push.
- **Logging path.** Moving `log_session`'s write into a module touches PR rebuilds. The test for
  the module is written first against the current tool, then the tool calls the module.
- **Regeneration from library edits** could overwrite a user's change if "touched" is wrong. The
  integration tests cover past, done, touched and added sessions for every path.
- **Consent screen.** Every user sees it once after deploy. C3's consent e2e check covers the page.
- **Garmin pairing** can pick the wrong activity on a day with two runs. The band shows it, and the
  user or the assistant can pick the right one.
- **Migration clash** with C2: renumber on rebase.

## 16. Plan corrections (in the build PR)

- C4 and C5 status `brief`, then `done` when merged.
- C4: "how a structured workout attaches to a dated session or a program slot": the slot is the
  cycle template's weekday slot (section 5), not a program exercise.
- C2's brief says C5 adds a `missed_illness` status. Illness is derived from the sick periods
  instead (6.7); C5 adds only `missed`.
- C5: the "did you do it?" flow and the strict matching apply with the endurance switch on; lifters
  keep C2's behaviour.
- BACKLOG: add "Step editor for structured workouts" (C6); update "Retire the triathlon plan
  generator after C4" (unblocked once this merges, still needs the owner's yes); update
  "Sport-specific endurance fields" (pool length and stroke now exist on planned workouts, not on
  logged sets).

## 17. Files

New: `src/db/schema/workouts.ts`, `src/db/schema/illness.ts`, `src/lib/utils/workout-steps.ts`,
`src/lib/utils/session-compliance.ts`, `src/lib/workouts.ts`, `src/lib/illness.ts`,
`src/lib/logged-sessions.ts`, `src/lib/actions/workouts.ts`, `src/lib/actions/illness.ts`,
`src/lib/validators/workouts.ts`, `src/lib/mcp/tools/workouts-library.ts`,
`src/lib/mcp/tools/compliance.ts`, `docs/mcp/workout-steps.md`, `src/app/more/workouts/page.tsx`
with its `loading.tsx`, the home card and sheets, the tests in section 11, the migration.

Changed: C2's planned-session schema, module, actions and MCP tools;
`src/db/schema/training-cycles.ts`, `src/db/schema/plan-revisions.ts`, `src/lib/plan-revisions.ts`,
`src/lib/utils/plan-revisions.ts`, `src/lib/periodization-sync.ts`, `src/lib/training-limits.ts`,
`src/lib/utils/training-limits.ts`, `src/lib/mcp/tools/sessions.ts`,
`src/lib/mcp/tools/athlete-profile.ts`, `src/lib/mcp/resource-docs.ts`,
`src/lib/mcp/instructions.ts`, `docs/mcp/app-rules.md`, `src/app/api/[transport]/route.ts`,
`src/app/page.tsx`, the calendar day sheet, `src/app/more/athlete/page.tsx`,
`src/components/features/MoreClient.tsx`, `src/components/features/ConsentChecks.tsx`,
`src/app/oauth/consent/page.tsx`, `src/app/privacy/page.tsx`, `src/lib/constants/legal.ts`,
`src/lib/account-data.ts`, `docs/privacy/data-inventory.md`, `docs/specs/cycle-periodization.md`
(PZ-26 for endurance users), `docs/data-model.md`, `BACKLOG.md`.

## 18. Open questions, with recommendations

The owner is away; the hub decides. Each recommendation is the safe choice: lifters see no
change, and nothing changes a plan by itself.

1. **Copy or reference a library workout on a session?** Recommend: copy. A past session keeps
   what was planned, compliance stays honest, and T7 holds. Library edits reach only untouched
   future sessions.
2. **A step editor in the app in this PR?** Recommend: no. The assistant creates and edits
   workouts; the app lists, duplicates, deletes and attaches them and shows the summary. C6 adds
   the editor with the views (BACKLOG entry).
3. **Program and workout on one session?** Recommend: one or the other, enforced by a check
   constraint.
4. **Workouts and bricks on rotation cycles?** Recommend: no, weekday cycles and added sessions
   only, as C2 keeps rotation simple.
5. **Does the weekly sync scale workouts?** Recommend: no. It keeps owning only program sets;
   the assistant edits structured sessions.
6. **Store the Garmin match or derive it?** Recommend: derive on read, with a stored pick for the
   user's or the assistant's choice.
7. **`autoComplete` on endurance slots with the switch on?** Recommend: ignored for sessions with a
   sport, so they go through Garmin or the prompt (D11); old auto rows stay; lifters unchanged.
8. **Illness stored on sessions or derived?** Recommend: derived from the sick periods; only
   `missed` is a new stored status.
9. **What makes a session key when no priority is set?** Recommend: hard (3.4), or the longest
   bike or run of its week at 90 minutes or more. The assistant sets `priority` explicitly for a
   race-specific session.
10. **"Above 80%": at least or over?** Recommend: at least 80%, so 4 of 5 counts.
11. **Consistency window?** Recommend: the last 12 full weeks, with this week shown apart.
12. **Compliance metric?** Recommend: duration, then distance. TSS waits for D1.
13. **Compliance for lifters?** Recommend: no app change; `get_compliance` and the new
    `list_planned_sessions` fields over MCP for everyone (read only, done or missed only).
14. **Sick periods for users without the switch?** Recommend: no (D18). The consent text still
    changes for everyone, since sign-up consent covers all users.
15. **RPE targets and ramps in the schema?** Recommend: not in version 1; `v` allows them later.
16. **FIT export code now?** Recommend: no code; the mapping in 3.6 and the shared resolver.
17. **Starter workouts shipped with the app?** Recommend: no; the assistant builds the library.
18. **How long does the return rule show?** Recommend: from the day after the sick period until the
    first done endurance session, at most 7 days; the assistant gets it for 14 days.
19. **A missed key session with no free day?** Recommend: no suggestion, "Skip it and go on"
    (research: skip, do not stack).
20. **Prompt window?** Recommend: the last 7 days; older sessions read as missed, and the calendar
    day sheet can still answer them.
21. **`confirm_session` for sport sessions with the switch on?** Recommend: refuse and point to
    `confirm_planned_session`, so the assistant cannot hide a miss behind an auto row.

### Decisions

Decided by the hub on 2026-11-13, owner may change. The hub took every recommendation above.

1. A session holds a copy of a library workout, not a reference.
2. No step editor in this PR; C6 adds it (BACKLOG entry).
3. A session runs a program or a workout, never both (check constraint).
4. No workouts or bricks on rotation cycles.
5. The weekly sync never scales workouts.
6. Garmin matches are derived on read, with a stored pick.
7. `autoComplete` is ignored for sessions with a sport when the switch is on; lifters unchanged.
8. Illness is derived from sick periods; only `missed` is a new stored status.
9. With no priority set, a session is key when hard or the longest bike or run of its week at 90 minutes or more.
10. A week is complete at 80% or more of its counted sessions.
11. Consistency covers the last 12 full weeks, with this week shown apart.
12. Compliance uses duration, then distance; TSS waits for D1.
13. Lifters get no app change; `get_compliance` and the new MCP fields are for everyone.
14. No sick periods without the endurance switch.
15. No RPE targets or ramps in version 1.
16. No FIT export code now.
17. No starter workouts shipped with the app.
18. The return rule shows until the first done session, at most 7 days; the assistant gets it for 14 days.
19. A missed key session with no free day gets no suggestion: skip it.
20. "Did you do it?" covers the last 7 days.
21. `confirm_session` refuses sessions with a sport when the switch is on.

## 19. Where the build differs from the brief

Checked against C2 as merged (PR #229, migration 0086). This package's migration is 0087.

- **C2's API held.** Table and column names, `matchPlanned`, `regenerationPlan`, the
  `planWrite` hook, the session operations and the MCP tools were as section 12 assumed. Two C2
  rules changed what this package does:
  - Regeneration edits untouched sessions from this week's **Monday** (C2 decision 19), not from
    today. A library edit follows the same rule, so this week's untouched past days take the new
    copy too.
  - The cap of three counts sessions with status `planned` only. A confirmed miss does not hold a
    place. It is always on a past day, so no new day can be filled by it.
- **The strict match wraps C2's matcher, it does not replace it.** With the switch off,
  `sessionCompliance` calls `matchPlanned` exactly. With it on, `matchEndurance` adds the
  discipline rule. The home card's "done today" chip still uses C2's matcher. The strict rule
  applies to past sessions, the prompt, compliance and the weekly sync.
- **Workout sessions do not show on today's home card or the week strip.** C2's home read skips
  sessions with no program. They show in the calendar, over MCP and on the "Did you do these?"
  card once the day has passed. BACKLOG: "Today's card for workout sessions".
- **Garmin activities that a logged workout already covers:** the build marks the first activity
  of the same sport and day as taken. It does not compare start and end times.
- **Picked activity ids** reference `garmin_activities.id`, the app's row id, not Garmin's own id.
- **Restore of a deleted workout or sick period** reuses `restoreDeletedAthleteRow`, which C3
  wrote for thresholds and injuries. It now takes `workout` and `illness` and needs the endurance
  switch for both.
- **A library edit by the assistant runs the training limits** on the dated weeks of the cycles
  that use it, and the long-run cap on the workout's run (review fix 3). A user's edit is not
  checked (D4).
- **App UI left out:** "Update from library" and "Link as brick" in the calendar, the Garmin pick
  list in the "Yes" sheet, and Recently deleted for sick periods. The server and MCP have them.
  BACKLOG: "Brick, library and Garmin controls in the app".
- **e2e reset** (`e2e/fixtures/reset.ts`) also clears `illness_periods` and `workouts`.

## 20. Review fixes (2026-11-13)

Two independent reviews of the build. Each code fix came with a test that failed first, in
`src/__tests__/integration/workouts-compliance-review.test.ts` unless named otherwise.

1. **A run cleared the day's strength session.** `matchEndurance` now matches sessions with a
   sport first, and a workout used by a session with a sport, or with a discipline that an open
   session of that sport needs, never clears a session without one. Unit tests "review 1" in
   `src/__tests__/session-compliance.test.ts`; integration "linked or not, the run clears the run".
2. **An added workout skipped the long-run cap.** The added session's run is in the facts after
   the write.
3. **Workout slots and library edits skipped the limits.** The facts read each cycle's library
   workout slots (long-run cap) and the template week counts a hard workout slot. An assistant's
   library edit runs the limits on the rewritten weeks, with the usual override.
4. **A brick move moved a logged second leg.** Refused, with the reason.
5. **Logs held user content.** The new Server Actions and the home read log a tag and ids only.
6. **`list_revisions` showed workouts and sick periods with the switch off.** Gated, as athlete and
   injury.
7. **A restore of a library workout did not reach its sessions.** It now regenerates them, after
   locking the cycles that use it.
8. **A cycle restore could point a slot at a purged workout.** The slot then has no workout.
9. **`log_session` refuses a second log for the same planned session.** This changed when its write
   moved to `src/lib/logged-sessions.ts`. Kept, because it is safer, and the tool description says so.
10. **Unused app code removed.** The Server Actions with no app caller are gone, and the app
    validator accepts only the session operations the app sends (`set_workout`, `miss`).
11. **A CSS offset target read its fast end for "hard".** It reads the slow end, as percent targets
    do. Unit test in `src/__tests__/workout-steps.test.ts`.
12. **The 32 KB limit counted characters.** It counts bytes. Unit test in the same file.
13. **The suggested day could be full or next to an unanswered hard session.** Both are excluded.
    Unit test "review 13" in `src/__tests__/session-compliance.test.ts`.
14. **A pick put a skipped session back to planned.** Refused.
15. **A template change could relink the brick of a done session.** Done and started sessions keep
    their link.
16. **Bricks could chain.** One level only: a session that leads a brick cannot become a second leg.
17. The comment at the top of `src/lib/workouts.ts` now matches C2 decision 19.
18. A permanent test refuses another user's ids for workouts, bricks, picks and sick periods.

Re-review (2026-11-13):

- **A library edit locked and checked every cycle using the workout.** It now takes only live
  weekday cycles that are active or scheduled, the same cycles whose sessions follow it. Test
  "an unscheduled draft or a completed cycle using the workout does not block the edit".
- **A strength program with a warm-up run lost its workout to the day's run session.** In the
  second pass a session without a sport goes first and takes a workout of its own program. Unit
  test "a workout of the strength session's own program clears it, warm-up run or not
  (re-review 2)".
- **One lock order:** the per-user cap lock, then the cycles in id order, then the workout row. A
  workout restore now locks its cycles in `lockForRestore`, with the other cycles of the restore.
