import type { StepLog } from "@/lib/utils/ride-results";
import { buildRidePlan } from "@/lib/utils/ride-timeline";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { checkSteps } from "@/lib/utils/session-check";
import { clockText, lastDaySessions, metricRows, timeRow } from "@/lib/utils/last-session";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/** The "Last session" widget's rules (docs/plans/session-check.md, decision 9). */

function tree(w: unknown): Workout {
  const r = parseWorkout(w);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.workout;
}

const log = (over: Partial<StepLog> = {}): StepLog => ({
  status: "done",
  durationSeconds: 900,
  targetOffsetW: 0,
  extendedSeconds: 0,
  avgPower: null,
  avgHr: null,
  maxHr: null,
  avgCadence: null,
  avgSpeed: null,
  distanceMeters: null,
  climbM: null,
  rpe: null,
  sources: null,
  ...over,
});

/** Warm-up, 2 x 15 min at 140-149 W with HR 135-148 (no cadence target), cool-down. */
const bike = buildRidePlan(
  tree({
    v: 2,
    sport: "bike",
    name: "Bike tempo",
    steps: [
      { type: "warmup", end: { type: "time", seconds: 600 } },
      {
        type: "work",
        end: { type: "time", seconds: 900 },
        target: { metric: "power", anchor: "absolute", low: 140, high: 149 },
        target2: { metric: "hr", anchor: "absolute", low: 135, high: 148 },
      },
      {
        type: "work",
        end: { type: "time", seconds: 900 },
        target: { metric: "power", anchor: "absolute", low: 140, high: 149 },
        target2: { metric: "hr", anchor: "absolute", low: 135, high: 148 },
      },
      { type: "cooldown", end: { type: "time", seconds: 300 } },
    ],
  }),
  [1, 2, 3, 4],
  { ftp: 200 },
  "indoor",
);

describe("metricRows", () => {
  it("bike: power, heart rate and cadence over the work steps, time weighted; cadence with no target", () => {
    const steps = checkSteps(bike, {
      1: log({ durationSeconds: 600, avgPower: 60, avgHr: 100, avgCadence: 70 }),
      2: log({ avgPower: 156, avgHr: 140, avgCadence: 84 }),
      3: log({ avgPower: 160, avgHr: 146, avgCadence: 88 }),
      4: log({ durationSeconds: 300, avgPower: 50 }),
    });
    expect(metricRows("bike", steps)).toEqual([
      { label: "Power", value: "158 W", plan: "plan 140-149", mark: "over" },
      { label: "Heart rate", value: "143", plan: "plan 135-148", mark: "in" },
      { label: "Cadence", value: "86 rpm", plan: "no target", mark: "none" },
    ]);
  });

  it("leaves out a metric with no target and no number; a target with no number shows a dash", () => {
    const steps = checkSteps(bike, { 2: log({ avgHr: 140 }), 3: log({ avgHr: 141 }) });
    expect(metricRows("bike", steps)).toEqual([
      { label: "Power", value: "–", plan: "plan 140-149", mark: "none" },
      { label: "Heart rate", value: "141", plan: "plan 135-148", mark: "in" },
    ]);
  });

  it("run outdoors: pace is shown as info, not judged", () => {
    const run = buildRunPlan(
      tree({ v: 2, sport: "run", name: "Tempo", steps: [{ type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "pace", anchor: "absolute", low: 3, high: 3.2 } }] }),
      [1],
      {},
      "outdoor",
      { surface: "road" },
    );
    const steps = checkSteps(run, { 1: log({ durationSeconds: 1200, distanceMeters: 4000, avgHr: 150, avgCadence: 160 }) });
    const pace = metricRows("run", steps).find((r) => r.label === "Pace");
    expect(pace).toEqual({ label: "Pace", value: "5:00 /km", plan: "info", mark: "none" });
  });
});

describe("timeRow", () => {
  it("the whole session against its plan, warm-up and cool-down included", () => {
    const steps = checkSteps(bike, { 1: log({ durationSeconds: 600 }), 2: log({ durationSeconds: 900 }), 3: log({ durationSeconds: 900 }), 4: log({ durationSeconds: 300 }) });
    expect(timeRow(steps, { done: null, planned: null })).toEqual({ label: "Time", value: "45:00", plan: "plan 45:00", mark: "in" });
    // No cool-down: 40 of 45 min is more than 10 % short.
    const short = checkSteps(bike, { 1: log({ durationSeconds: 600 }), 2: log({ durationSeconds: 900 }), 3: log({ durationSeconds: 900 }) });
    expect(timeRow(short, { done: null, planned: null })).toEqual({ label: "Time", value: "40:00", plan: "plan 45:00", mark: "under" });
  });

  it("falls back to the session's done and planned time with no steps", () => {
    expect(timeRow([], { done: 8160, planned: 8100 })).toEqual({ label: "Time", value: "2:16", plan: "plan 2:15", mark: "in" });
    expect(timeRow([], { done: 1200, planned: null })).toEqual({ label: "Time", value: "20:00", plan: "no target", mark: "none" });
    expect(timeRow([], { done: null, planned: 1200 })).toBeNull();
  });

  it("clockText: m:ss under an hour, h:mm from an hour on", () => {
    expect(clockText(1200)).toBe("20:00");
    expect(clockText(3600)).toBe("1:00");
    expect(clockText(8160)).toBe("2:16");
  });
});

describe("lastDaySessions", () => {
  const s = (id: number, date: string, position: number, sport: string | null, state = "done") => ({ id, date, position, sport, state });

  it("the done bike and run sessions of the last day that has any, in day order", () => {
    const all = [
      s(1, "2026-11-20", 1, "bike"),
      s(2, "2026-11-22", 2, "run"),
      s(3, "2026-11-22", 1, "bike"),
      s(4, "2026-11-22", 3, "swim"),
      s(5, "2026-11-23", 1, "bike", "planned"),
      s(6, "2026-11-23", 2, null),
    ];
    expect(lastDaySessions(all).map((x) => x.id)).toEqual([3, 2]);
  });

  it("none is empty", () => {
    expect(lastDaySessions([s(1, "2026-11-20", 1, "bike", "missed")])).toEqual([]);
  });
});
