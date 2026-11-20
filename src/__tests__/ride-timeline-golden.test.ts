import { describe, expect, it } from "vitest";
import { buildRidePlan, rideTimeline, type RideEventInput } from "@/lib/utils/ride-timeline";
import { parseWorkout, type ThresholdValues, type Workout } from "@/lib/utils/workout-steps";

/**
 * The golden bike test (docs/plans/run-logger.md, section 7, unit test 1).
 * The run logger changes the shared ride timeline; the bike must stay bit for
 * bit the same. Bike plans built from stored workout shapes, and seeded random
 * event lists, give a frozen copy of the plan and the timeline output. A
 * change to that output fails here. Never update the frozen file to make this
 * pass: find what changed the bike.
 */

const T0 = Date.UTC(2026, 10, 17, 17, 0, 0);
const MIN = 60;

function tree(w: unknown): Workout {
  const r = parseWorkout(w);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.workout;
}

const z = (zone: number) => ({ metric: "power", anchor: "ftp", zone });
const pct = (low: number, high: number) => ({ metric: "power", anchor: "ftp", low, high });

const WORKOUTS: Record<string, unknown> = {
  tempo: {
    v: 2,
    sport: "bike",
    name: "Tempo",
    steps: [
      { type: "warmup", end: { type: "time", seconds: 15 * MIN }, target: z(2) },
      { type: "repeat", count: 3, steps: [{ type: "work", end: { type: "time", seconds: 10 * MIN }, target: pct(88, 93) }, { type: "recovery", end: { type: "time", seconds: 5 * MIN }, target: z(1) }] },
      { type: "cooldown", end: { type: "time", seconds: 10 * MIN } },
    ],
  },
  mixed: {
    v: 2,
    sport: "bike",
    name: "Mixed ends",
    steps: [
      { type: "warmup", end: { type: "time", seconds: 10 * MIN }, ramp: { anchor: "ftp", from: 50, to: 75 } },
      { type: "work", end: { type: "distance", meters: 20000 }, target: { metric: "pace", anchor: "absolute", low: 8, high: 9 } },
      { type: "work", end: { type: "distance", meters: 5000 }, target: z(3), target2: { metric: "hr", anchor: "lthr", zone: 3 } },
      { type: "work", end: { type: "lap" }, free: true },
      { type: "rest", end: { type: "time", seconds: 120 } },
      { type: "cooldown", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "absolute", low: 100, high: 140 }, outdoor: { metric: "hr", anchor: "lthr", zone: 1 } },
    ],
  },
  ramp: {
    v: 2,
    sport: "bike",
    name: "Ramp test",
    test: "ramp",
    steps: [
      { type: "warmup", end: { type: "time", seconds: 5 * MIN }, target: pct(40, 50) },
      ...Array.from({ length: 12 }, (_, i) => ({ type: "work", end: { type: "time", seconds: 60 }, target: { metric: "power", anchor: "absolute", low: 100 + 20 * i, high: 100 + 20 * i } })),
      { type: "cooldown", end: { type: "time", seconds: 5 * MIN } },
    ],
  },
  twenty: {
    v: 2,
    sport: "bike",
    name: "20 min test",
    test: "20min",
    steps: [
      { type: "warmup", end: { type: "time", seconds: 20 * MIN }, target: z(2) },
      { type: "repeat", count: 3, steps: [{ type: "work", end: { type: "time", seconds: 60 }, target: pct(110, 120) }, { type: "recovery", end: { type: "time", seconds: 60 } }] },
      { type: "work", end: { type: "time", seconds: 20 * MIN } },
      { type: "cooldown", end: { type: "lap" } },
    ],
  },
};

const THRESHOLDS: ThresholdValues[] = [{ ftp: 250, lthr_bike: 165 }, {}];

/** A small seeded random source (mulberry32), so the event lists never change. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = ["pause", "resume", "skip", "unskip", "extend", "nudge", "lap", "end"] as const;

function randomEvents(seed: number, spanS: number): RideEventInput[] {
  const r = rng(seed);
  const events: RideEventInput[] = [{ seq: 1, kind: "start", at: T0 }];
  const count = Math.floor(r() * 14);
  let t = 0;
  for (let i = 0; i < count; i++) {
    t += Math.floor(r() * (spanS / Math.max(1, count)));
    const kind = KINDS[Math.floor(r() * (r() < 0.15 ? KINDS.length : KINDS.length - 1))];
    const value = kind === "extend" ? (r() < 0.75 ? 60 : -60) : kind === "nudge" ? (r() < 0.6 ? 5 : -5) : undefined;
    events.push({ seq: i + 2, kind, at: T0 + t * 1000, ...(value !== undefined && { value }) });
  }
  // Sometimes an event before the start, or a second start.
  if (r() < 0.1) events.push({ seq: events.length + 1, kind: "pause", at: T0 - 5000 });
  if (r() < 0.1) events.push({ seq: events.length + 1, kind: "start", at: T0 + 30_000 });
  return events;
}

describe("golden bike timeline", () => {
  it("builds every stored bike plan as before", async () => {
    const plans: Record<string, unknown> = {};
    for (const [name, w] of Object.entries(WORKOUTS)) {
      const workout = tree(w);
      const n = workout.steps.reduce((a, s) => a + (s.type === "repeat" ? s.count * s.steps.length : 1), 0);
      const ids = Array.from({ length: n }, (_, i) => 1000 + i);
      for (const [ti, th] of THRESHOLDS.entries()) {
        for (const mode of ["indoor", "outdoor"] as const) plans[`${name}/${ti}/${mode}`] = buildRidePlan(workout, ids, th, mode);
      }
    }
    await expect(JSON.stringify(plans, null, 1)).toMatchFileSnapshot("./golden/bike-ride-plans.json");
  });

  it("gives the same timeline for random event lists", async () => {
    const out: Record<string, unknown> = {};
    let seed = 1;
    for (const [name, w] of Object.entries(WORKOUTS)) {
      const workout = tree(w);
      const n = workout.steps.reduce((a, s) => a + (s.type === "repeat" ? s.count * s.steps.length : 1), 0);
      const ids = Array.from({ length: n }, (_, i) => 1000 + i);
      for (const mode of ["indoor", "outdoor"] as const) {
        const plan = buildRidePlan(workout, ids, THRESHOLDS[0], mode);
        for (let k = 0; k < 12; k++) {
          const events = randomEvents(seed++, 90 * MIN);
          const heartbeatAt = k % 4 === 0 ? T0 + 40 * MIN * 1000 : null;
          for (const nowS of [0, 7 * MIN, 31 * MIN, 95 * MIN, 5 * 3600]) {
            out[`${name}/${mode}/${k}/${nowS}`] = rideTimeline(plan, events, T0 + nowS * 1000, { heartbeatAt });
          }
        }
      }
    }
    await expect(JSON.stringify(out)).toMatchFileSnapshot("./golden/bike-ride-timeline.json");
  });
});
