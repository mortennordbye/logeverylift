# Workout step syntax

Version: 2026-11-18

This document is served to connected AI assistants as an MCP resource
(`logeverylift://docs/workout-steps`). It describes the steps of a structured endurance session
and every rule the app checks. It holds no personal data. The schema is
`src/lib/utils/workout-steps.ts`; a unit test parses every JSON block below that is not marked
as a wrong example, so this document and the code cannot drift apart. The design is in
`docs/plans/workouts-and-compliance.md`, section 3, and `docs/plans/one-program-model.md`.

A structured session is a program whose swim, bike or run exercise holds steps. Write the steps
with `edit_program_exercise`: either `sets[]`, one set per step (see "Steps as sets"), or
`workout`, a step tree in the JSON shape below, which becomes the set list. Both go through the
same check.

The check is always on. Steps that break a rule are not saved, and no override exists. A tree
is refused with every problem and its path, for example
`steps[1].steps[0].target.low: must be at most high`; a set list with the set numbers. Fix each
one and send the steps again.

## Shape

A step tree is one JSON object:

| Key | Required | Meaning |
|---|---|---|
| `v` | yes | `1` or `2` (2 since the bike fields below; both read the same) |
| `sport` | yes | `swim`, `bike` or `run` |
| `name` | yes | 1-80 characters. Not stored: the program has its own name |
| `description` | no | At most 1,000 characters. Not stored: use the exercise's `notes` |
| `poolLengthM` | swim only | Pool length in meters, 10-100 (25 yd is 22.86). Leave it out for open water. Send it as `poolLengthM` on the `edit_program_exercise` call too: the exercise keeps it |
| `test` | bike only | `ramp` or `20min`: the ride is an FTP test (see Bikes). Stored on the exercise; a tree without it clears it |
| `steps` | yes | 1-100 nodes, in order |

A node is a **step** or a **repeat**.

A **step**:

| Key | Required | Meaning |
|---|---|---|
| `type` | yes | `warmup`, `work`, `recovery`, `cooldown` or `rest` |
| `end` | yes | `{ "type": "time", "seconds": 5-43200 }`, `{ "type": "distance", "meters": 10-300000 }` or `{ "type": "lap" }` (the athlete presses lap) |
| `target` | no | See Targets |
| `target2` | no | A second target with another metric, which caps the first (for example power with a heart rate ceiling) |
| `cadence` | no | Bike and run: `{ "low": rpm, "high": rpm }`, 20-200 |
| `sendOffSeconds` | no | Swim only: leave every N seconds (20-600). Only on a `work` step inside a repeat with no `rest` step, because the send-off includes the rest |
| `stroke` | no | Swim only: `free`, `back`, `breast`, `fly`, `im`, `choice`, `kick`, `pull`, `drill` |
| `equipment` | no | Swim only, a list: `pull_buoy`, `paddles`, `fins`, `kickboard`, `snorkel` |
| `note` | no | At most 140 characters. A climb, a gradient or the terrain goes here, never in a target |
| `ramp` | bike only | `{ "anchor": "ftp" or "absolute", "from": n, "to": n }`: power that moves evenly from `from` to `to` over the step, in % FTP (30-200) or watts (20-2000). In place of `target`; a ramp takes no `target2` |
| `free` | bike only | `true`: a free spin with no target. No `target`, `target2` or `ramp` with it |
| `outdoor` | bike only | A target in the shape of Targets, used on an outdoor ride in place of `target`. See Bikes |
| `id` | no | Letters, digits, `-` or `_`, at most 24. Not stored: the app numbers the steps `s1`, `s2`, ... in order (a repeat takes one number, its steps the next ones). Step results use these keys, plus `#n` for round n of a repeat |

A **repeat**: `{ "type": "repeat", "count": 2-50, "steps": [1-10 steps] }`. A repeat holds steps
only, never another repeat. At most 400 steps once every repeat is expanded.

Any key not listed here is an error.

## Targets

A target has a `metric`, an `anchor` and one of three forms: `low` and `high`, a `zone`, or (CSS
only) `offsetLow` and `offsetHigh`. Store targets relative to the athlete's thresholds when you
can: a new threshold then updates every future session.

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
| `rpe` | `absolute` | all | 1-10 |

`low` is at most `high`. All values are metric. Pace is speed: never send minutes per km.

Zones, from the research reference: Coggan power Z1 under 55% FTP, Z2 55-74, Z3 75-89, Z4 90-104,
Z5 105-120. Friel run heart rate Z1 under 85% LTHR, Z2 85-89, Z3 90-94, Z4 95-99, Z5 100 and
up; bike Z1 under 81, Z2 81-89, Z3 90-93, Z4 94-99, Z5 100 and up.

## Bikes

A ride has two modes, Indoor (trainer) and Outdoor, chosen when the athlete starts it. Write the
indoor target as `target` (power in % FTP, a power zone, or a `ramp`). The app makes the outdoor
target from the power zone of the indoor target's low end: heart rate on longer steps, effort on
short hard ones and easy spins. To set your own, add `outdoor` to the step. A step with no
`outdoor` is never refused. An outdoor target changes only the target, never how the step ends:
both modes ride the same steps.

- **Ramp:** a warm-up, cool-down or build that rises (or falls) evenly. `ramp` replaces `target`.
- **Free spin:** `"free": true`, with no target, for a spin where only the time counts.
- **Climbs:** write the climb in `note` ("Climb at 6-8%, seated"). Gradient is never a target,
  and speed is never a target either: it is a result.
- **Cadence:** `cadence` on the step, as for any bike step.
- **FTP test rides:** `"test": "ramp"` (warm-up, then 1 min steps up to failure, ending on a lap)
  or `"test": "20min"` (warm-up, 20 min all-out, cool-down) on the tree. It marks the ride as a
  test for the app; write its steps as usual. Or send `ftpTest: "ramp"` or `ftpTest: "20min"` to
  `edit_program_exercise` in place of `sets` or `workout`: the app writes its own template
  (ramp: 10 min warm-up, then 1 min steps from 100 W up by 20 W to 500 W; 20 min: 20 min warm-up
  with two 1 min hard efforts, 5 min easy, 20 min all-out, 10 min cool-down). In a ramp test, Lap
  or End ride on a 1 min step ends the ride as finished. Outdoors a test ride is ridden by effort,
  never by a heart rate cap or range. After the ride, `get_ride` gives `ftpTest`: ramp FTP is 75%
  of the best 1 min power, 20 min FTP is 95% of the all-out step's average power (from the Garmin
  stream when it filled the ride, else the step averages; a ramp step with no number counts its
  target). The rider saves it on the summary, or you add it with `manage_thresholds`.
- **A running ride is frozen:** a ride keeps the plan it started with. A program edit applies
  from the next ride, never to one in progress.

A 65 minute ride, the shape the ride logger was designed with. With FTP 180 W the warm-up ramps
from 99 to 135 W and the work steps are 135-144 W. Outdoors the work steps ride at heart rate
83-89% of bike LTHR, as written; the other steps get the derived outdoor target. In a repeat, the
recovery after the last round is not ridden.

```json
{ "v": 2, "sport": "bike", "name": "Tempo 2 x 15",
  "steps": [
    { "type": "warmup", "end": { "type": "time", "seconds": 900 },
      "ramp": { "anchor": "ftp", "from": 55, "to": 75 } },
    { "type": "repeat", "count": 2, "steps": [
      { "type": "work", "end": { "type": "time", "seconds": 900 },
        "target": { "metric": "power", "anchor": "ftp", "low": 75, "high": 80 },
        "cadence": { "low": 85, "high": 95 },
        "outdoor": { "metric": "hr", "anchor": "lthr", "low": 83, "high": 89 },
        "note": "Talk in short sentences" },
      { "type": "recovery", "end": { "type": "time", "seconds": 300 },
        "target": { "metric": "power", "anchor": "ftp", "zone": 1 } } ] },
    { "type": "work", "end": { "type": "time", "seconds": 900 },
      "target": { "metric": "power", "anchor": "ftp", "zone": 2 } },
    { "type": "cooldown", "end": { "type": "lap" }, "free": true }
  ] }
```

Hill repeats outdoors: the climb is in the note, the target is power with an effort outdoors.

```json
{ "v": 2, "sport": "bike", "name": "5 x 4 min climbs",
  "steps": [
    { "type": "warmup", "end": { "type": "time", "seconds": 1200 },
      "ramp": { "anchor": "ftp", "from": 50, "to": 70 } },
    { "type": "repeat", "count": 5, "steps": [
      { "type": "work", "end": { "type": "time", "seconds": 240 },
        "target": { "metric": "power", "anchor": "ftp", "low": 105, "high": 115 },
        "outdoor": { "metric": "rpe", "anchor": "absolute", "low": 8, "high": 8 },
        "note": "Climb at 6-8%, seated" },
      { "type": "recovery", "end": { "type": "time", "seconds": 240 }, "free": true,
        "note": "Roll back down" } ] },
    { "type": "cooldown", "end": { "type": "time", "seconds": 600 },
      "target": { "metric": "power", "anchor": "ftp", "zone": 1 } }
  ] }
```

A 20 minute FTP test.

```json
{ "v": 2, "sport": "bike", "name": "20 min FTP test", "test": "20min",
  "steps": [
    { "type": "warmup", "end": { "type": "time", "seconds": 1200 },
      "target": { "metric": "power", "anchor": "ftp", "zone": 2 },
      "note": "Two 1 min hard efforts in the last 10 min" },
    { "type": "recovery", "end": { "type": "time", "seconds": 300 }, "free": true },
    { "type": "work", "end": { "type": "time", "seconds": 1200 },
      "target": { "metric": "rpe", "anchor": "absolute", "low": 10, "high": 10 },
      "note": "All out, even pacing" },
    { "type": "cooldown", "end": { "type": "time", "seconds": 600 }, "free": true }
  ] }
```

Results of a ride: `get_ride` reads the ride (plan, mode, status, each step planned against done
and the ride's numbers). `log_step_results` writes per step `avgPower`, `avgHr`, `maxHr`,
`avgCadence`, `avgSpeed` (m/s) and `climbM` besides time, distance and RPE. Your values are
marked as written by the assistant; a value the athlete typed or Garmin filled is never replaced,
and the result lists it under `kept`.

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
parent. The two step trees:

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

## Steps as sets

In `sets[]`, a set with `stepKind` (`warmup`, `work`, `recovery`, `cooldown`, `rest`) is one
step. It ends on exactly one of `durationSeconds`, `distanceMeters` or `endsOnLap: true`. A
target goes in `targets`, a list of one or two entries in the target shape above. Cadence is
`cadenceLow` and `cadenceHigh`; a swim step takes `stroke`, `equipment` and `sendOffSeconds`;
`note` is the step's cue. A bike step takes `ramp` (no `targets` with it), `free: true` and
`outdoorTarget` (the tree's `outdoor`). The FTP test is only in the tree: a set list leaves the
exercise's test as it is, and `get_program` shows it as `rideTest` on the exercise. A repeat is one set per round: the sets of round 1, then round 2, and
so on, each with the same `blockId` and its `blockRound`, every round the same. Either every set
of an exercise is a step or none is. The `workout` argument writes exactly this list for you.

## Where the steps go

- **A dated session:** a session runs a program. Put a program with steps on a day with
  `manage_planned_session` `change` (`programId`), or `add` with `programId`.
- **A weekday slot:** `edit_cycle_slot` with `programId`. Every dated session of that slot runs
  the program, so a program edit reaches them all.
- **One day only:** the user taps "Change this day only" on the session in the app. That day then
  runs its own copy of the program, which you can edit like any program. There is no tool for it.
- **A brick:** two sessions on one day, the run after the ride. `manage_planned_session`
  `link_brick` with `brickParentId` (the ride), or `add` with `brickParentId`. On a slot,
  `brickWithNext` links the next slot of the day. A brick in one program is a ride exercise and
  then a run exercise; the guided player plays them in order.

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

A ramp with a cap, a gradient as a target, and a free spin on a run. Write a ramp alone, put the
climb in the note, and use `free` only on a bike.

```json wrong
{ "v": 2, "sport": "bike", "name": "Ramp with a cap",
  "steps": [ { "type": "warmup", "end": { "type": "time", "seconds": 600 },
    "ramp": { "anchor": "ftp", "from": 50, "to": 70 },
    "target2": { "metric": "hr", "anchor": "lthr", "low": 70, "high": 80 } } ] }
```

```json wrong
{ "v": 2, "sport": "bike", "name": "Gradient target",
  "steps": [ { "type": "work", "end": { "type": "time", "seconds": 600 },
    "target": { "metric": "gradient", "anchor": "absolute", "low": 6, "high": 8 } } ] }
```

```json wrong
{ "v": 2, "sport": "run", "name": "Free run",
  "steps": [ { "type": "work", "end": { "type": "time", "seconds": 600 }, "free": true } ] }
```
