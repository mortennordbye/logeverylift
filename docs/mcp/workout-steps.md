# Workout step syntax

Version: 2026-11-15

This document is served to connected AI assistants as an MCP resource
(`logeverylift://docs/workout-steps`). It describes the JSON shape of a structured endurance
workout and every rule the app checks. It holds no personal data. The schema is
`src/lib/utils/workout-steps.ts`; a unit test parses every JSON block below that is not marked
as a wrong example, so this document and the code cannot drift apart. The design is in
`docs/plans/workouts-and-compliance.md`, section 3.

The check is always on. A workout that breaks a rule is not saved, and no override exists. The
error lists every problem with its path, for example
`steps[1].steps[0].target.low: must be at most high`. Fix each one and send the workout again.

## Shape

A workout is one JSON object:

| Key | Required | Meaning |
|---|---|---|
| `v` | yes | Always `1` |
| `sport` | yes | `swim`, `bike` or `run` |
| `name` | yes | 1-80 characters |
| `description` | no | At most 1,000 characters |
| `poolLengthM` | swim only | Pool length in meters, 10-100 (25 yd is 22.86). Leave it out for open water |
| `steps` | yes | 1-100 nodes, in order |

A node is a **step** or a **repeat**.

A **step**:

| Key | Required | Meaning |
|---|---|---|
| `type` | yes | `warmup`, `work`, `recovery`, `steady`, `cooldown` or `rest`. `steady` is long even work below threshold, such as the body of a long ride |
| `end` | yes | `{ "type": "time", "seconds": 5-43200 }`, `{ "type": "distance", "meters": 10-300000 }` or `{ "type": "lap" }` (the athlete presses lap) |
| `target` | no | See Targets |
| `secondary` | no | A second target on another metric, in the same shape as `target`: for example HR under 140 on a power step. Needs a `target`. Not cadence: use `cadence` |
| `cadence` | no | Bike and run: `{ "low": rpm, "high": rpm }`, 20-200 |
| `gradePercent` | no | Bike only: the gradient in percent, -20 to 20, for a sim trainer or an outdoor climb |
| `sendOffSeconds` | no | Swim only: leave every N seconds (20-600). Only on a `work` step inside a repeat with no `rest` step, because the send-off includes the rest |
| `stroke` | no | Swim only: `free`, `back`, `breast`, `fly`, `im`, `choice`, `kick`, `pull`, `drill` |
| `equipment` | no | Swim only, a list: `pull_buoy`, `paddles`, `fins`, `kickboard`, `snorkel` |
| `note` | no | At most 140 characters |
| `id` | no | Letters, digits, `-` or `_`, at most 24. The app fills missing ids (`s1`, `s2`, ...) and keeps given ones. Keep ids when you edit a workout |

A **repeat**: `{ "type": "repeat", "count": 2-50, "steps": [1-10 steps] }`. A repeat holds steps
only, never another repeat. At most 400 steps once every repeat is expanded.

Any key not listed here is an error.

## Targets

A target has a `metric`, an `anchor` and one of three forms: `low` and `high`, a `zone`, or (CSS
only) `offsetLow` and `offsetHigh`. Store targets relative to the athlete's thresholds when you
can: a new threshold then updates every future workout.

| Metric | Anchor | Sports | Values |
|---|---|---|---|
| `power` | `ftp` | bike | `low`/`high` 30-200 (% of FTP), or `zone` 1-5 (Coggan) |
| `power` | `absolute` | bike | watts, 20-2000 |
| `hr` | `lthr` | bike, run | `low`/`high` 50-110 (% of threshold heart rate for that sport), or `zone` 1-5 (Friel) |
| `hr` | `max_hr` | all | 40-100 (% of max heart rate) |
| `hr` | `absolute` | all | bpm, 60-230 |
| `pace` | `threshold_pace` | run | 50-130 (% of threshold **speed**: 90 is slower than threshold) |
| `pace` | `css` | swim | 50-130 (% of CSS speed), or `offsetLow`/`offsetHigh` -20 to 60 (seconds per 100 m added to CSS pace; the lower number is the faster end) |
| `pace` | `absolute` | all | speed in m/s, 0.3-12 |
| `cadence` | `absolute` | bike, run | rpm, 20-200 |

`low` is at most `high`. One side alone is allowed, except for pace: `{ "high": 140 }` is "under
140", `{ "low": 110 }` is "110 or more". All values are metric. Pace is speed: never send minutes
per km.

Zones, from the research reference: Coggan power Z1 under 55% FTP, Z2 55-74, Z3 75-89, Z4 90-104,
Z5 105-120. Friel run heart rate Z1 under 85% LTHR, Z2 85-89, Z3 90-94, Z4 95-99, Z5 100 and
up; bike Z1 under 81, Z2 81-89, Z3 90-93, Z4 94-99, Z5 100 and up.

How a bike heart rate zone resolves: a `hr` target with anchor `lthr` and a `zone` uses the
athlete's own bike zones in bpm when they exist. The order is custom zones the athlete set, then
the Garmin CYCLING zones of the last sync, then the Friel table above with the bike LTHR. The
resolved step says which one it used (`hrZoneSource`: `custom`, `garmin` or `estimate`). So
`"zone": 2` follows the watch: with Garmin Z2 at 121-140 bpm, the step is 121-140 bpm. Run heart
rate zones always use the Friel table.

Each resolved target also has every other form of the number (`forms`): watts and % FTP (also for
an absolute watt target when FTP is set), the Coggan power zone of the range middle, bpm, and the
heart rate zone with its source. A form that does not apply is null.

## Swims

In a pool, every distance must be a whole number of lengths. A send-off workout sets
`sendOffSeconds` on the work step and has no rest step in that repeat.

## Examples

A bike interval session. With FTP 250 W, the work steps are 220-233 W.

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

A tempo ride with a heart rate cap on every step. With FTP 180 W and Garmin Z3 at 141-160 bpm,
the work steps are 135-144 W and 141-160 bpm, and the easy steps stay under 140 bpm.

```json
{
  "v": 1,
  "sport": "bike",
  "name": "Tempo 2 x 15 min",
  "steps": [
    { "type": "warmup", "end": { "type": "time", "seconds": 900 },
      "target": { "metric": "power", "anchor": "ftp", "low": 60, "high": 72 },
      "secondary": { "metric": "hr", "anchor": "absolute", "high": 140 } },
    { "type": "work", "end": { "type": "time", "seconds": 900 },
      "target": { "metric": "power", "anchor": "ftp", "low": 75, "high": 80 },
      "secondary": { "metric": "hr", "anchor": "lthr", "zone": 3 },
      "cadence": { "low": 85, "high": 95 }, "note": "Talk in short sentences" },
    { "type": "recovery", "end": { "type": "time", "seconds": 300 },
      "target": { "metric": "power", "anchor": "ftp", "low": 50, "high": 60 },
      "secondary": { "metric": "hr", "anchor": "absolute", "high": 140 } },
    { "type": "work", "end": { "type": "time", "seconds": 900 },
      "target": { "metric": "power", "anchor": "ftp", "low": 75, "high": 80 },
      "secondary": { "metric": "hr", "anchor": "lthr", "zone": 3 },
      "cadence": { "low": 85, "high": 95 } },
    { "type": "cooldown", "end": { "type": "time", "seconds": 900 },
      "target": { "metric": "power", "anchor": "ftp", "low": 60, "high": 72 },
      "secondary": { "metric": "hr", "anchor": "absolute", "high": 140 } }
  ]
}
```

A steady climb on a sim trainer: the gradient is set, power has a ceiling only.

```json
{ "v": 1, "sport": "bike", "name": "Steady climb",
  "steps": [
    { "type": "steady", "end": { "type": "time", "seconds": 1800 }, "gradePercent": 4,
      "target": { "metric": "power", "anchor": "ftp", "high": 75 },
      "secondary": { "metric": "hr", "anchor": "lthr", "zone": 2 } }
  ] }
```

A swim set with send-offs in a 25 m pool. With CSS 1:45 per 100 m, the main set is 1:47-1:50 per
100 m, leaving every 2:00.

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

A brick is two sessions on one day: the ride, then the run, which names the ride as its brick
parent. The two workouts:

```json
{ "v": 1, "sport": "bike", "name": "2 h endurance, last 20 min race pace",
  "steps": [
    { "type": "work", "end": { "type": "time", "seconds": 6000 },
      "target": { "metric": "power", "anchor": "ftp", "zone": 2 } },
    { "type": "work", "end": { "type": "time", "seconds": 1200 },
      "target": { "metric": "power", "anchor": "ftp", "low": 75, "high": 80 } }
  ] }
```

```json
{ "v": 1, "sport": "run", "name": "20 min off the bike",
  "steps": [
    { "type": "work", "end": { "type": "time", "seconds": 1200 },
      "target": { "metric": "pace", "anchor": "threshold_pace", "low": 85, "high": 90 } }
  ] }
```

With threshold pace 4:00 per km, the run target is 4:27-4:42 per km.

## Where a workout goes

A workout runs only as part of a dated session or a weekday slot. A session runs a program or a
workout, never both, and holds its own copy of the workout.

- **A dated session:** `manage_planned_session` `set_workout` with `workout` (the JSON) or
  `workoutId` (a library workout), or `add` with `workout` or `workoutId` instead of `programId`.
- **A weekday slot:** `edit_cycle_slot` with `workoutId`. Each dated session of that slot gets
  its own copy. Rotation cycles take no workouts.
- **A brick:** two sessions on one day, the run after the ride. `manage_planned_session`
  `link_brick` with `brickParentId` (the ride), or `add` with `brickParentId`. On a slot,
  `brickWithNext` links the next slot of the day.
- **A library edit** (`manage_workout` `update` or `delete`) reaches only the untouched sessions
  from this week's Monday on. Done sessions, sessions with their own changes and earlier weeks
  keep their copy. `update_from_library` copies the library workout again onto one session.

## Common errors

Each block below is a wrong example (marked `json wrong`). The test checks that the app refuses
it.

A repeat inside a repeat. Write the inner set out, or use two repeats in a row.

```json wrong
{ "v": 1, "sport": "run", "name": "Nested",
  "steps": [ { "type": "repeat", "count": 2, "steps": [
    { "type": "repeat", "count": 3, "steps": [ { "type": "work", "end": { "type": "time", "seconds": 60 } } ] } ] } ] }
```

Power on a run, and a pace as minutes per km. Use heart rate or `threshold_pace` on a run, and a
percent of threshold speed.

```json wrong
{ "v": 1, "sport": "run", "name": "Wrong targets",
  "steps": [ { "type": "work", "end": { "type": "time", "seconds": 600 },
    "target": { "metric": "power", "anchor": "ftp", "low": 90, "high": 95 } } ] }
```

A distance that is not a whole number of lengths, and a send-off next to a rest step.

```json wrong
{ "v": 1, "sport": "swim", "name": "Odd lengths", "poolLengthM": 25,
  "steps": [ { "type": "repeat", "count": 4, "steps": [
    { "type": "work", "end": { "type": "distance", "meters": 110 }, "sendOffSeconds": 120 },
    { "type": "rest", "end": { "type": "time", "seconds": 20 } } ] } ] }
```

A second target on the same metric as the main target, and one-sided pace. Put heart rate in
`secondary` when the main target is power, and give pace both ends.

```json wrong
{ "v": 1, "sport": "bike", "name": "Two power targets",
  "steps": [ { "type": "work", "end": { "type": "time", "seconds": 600 },
    "target": { "metric": "power", "anchor": "ftp", "low": 75, "high": 80 },
    "secondary": { "metric": "power", "anchor": "absolute", "high": 150 } },
  { "type": "work", "end": { "type": "time", "seconds": 600 },
    "target": { "metric": "pace", "anchor": "absolute", "low": 8 } } ] }
```
