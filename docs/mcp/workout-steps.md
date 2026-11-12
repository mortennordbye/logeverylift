# Workout step syntax

Version: 2026-11-13

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
| `type` | yes | `warmup`, `work`, `recovery`, `cooldown` or `rest` |
| `end` | yes | `{ "type": "time", "seconds": 5-43200 }`, `{ "type": "distance", "meters": 10-300000 }` or `{ "type": "lap" }` (the athlete presses lap) |
| `target` | no | See Targets |
| `cadence` | no | Bike and run: `{ "low": rpm, "high": rpm }`, 20-200 |
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

`low` is at most `high`. All values are metric. Pace is speed: never send minutes per km.

Zones, from the research reference: Coggan power Z1 under 55% FTP, Z2 55-74, Z3 75-89, Z4 90-104,
Z5 105-120. Friel run heart rate Z1 under 85% LTHR, Z2 85-89, Z3 90-94, Z4 95-99, Z5 100 and
up; bike Z1 under 81, Z2 81-89, Z3 90-93, Z4 94-99, Z5 100 and up.

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
