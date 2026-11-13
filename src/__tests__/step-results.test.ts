import {
  checkResults,
  compareStep,
  loadAnchors,
  plannedRows,
  resultTotals,
  resultsAsPlanned,
  resultsFromRun,
  workoutPlannedLoad,
} from "@/lib/utils/step-results";
import { flattenWorkout, finish, initialState, skip, start, tick } from "@/lib/utils/workout-player";
import { parseWorkout, type Workout } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

function workout(json: unknown): Workout {
  const r = parseWorkout(json);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.workout;
}

const bike = workout({
  v: 1,
  sport: "bike",
  name: "3 × 10 min sweet spot",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 50, high: 70 } },
    {
      type: "repeat",
      count: 3,
      steps: [
        { type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", low: 88, high: 93 } },
        { type: "rest", end: { type: "time", seconds: 300 } },
      ],
    },
    { type: "cooldown", end: { type: "lap" } },
  ],
});
const swim = workout({
  v: 1,
  sport: "swim",
  name: "10 × 100",
  poolLengthM: 25,
  steps: [
    { type: "warmup", end: { type: "distance", meters: 400 } },
    { type: "repeat", count: 2, steps: [{ type: "work", end: { type: "distance", meters: 100 }, sendOffSeconds: 120, target: { metric: "pace", anchor: "css", offsetLow: 2, offsetHigh: 5 } }] },
  ],
});
const anchors = { ftp: 250, swim_css: 100 / 105 };

describe("plannedRows", () => {
  it("gives each play step its key, text, time and resolved target", () => {
    const rows = plannedRows(bike, anchors);
    expect(rows.map((r) => r.key)).toEqual(["s1", "s3#1", "s4#1", "s3#2", "s4#2", "s3#3", "s4#3", "s5"]);
    expect(rows[1]).toMatchObject({ type: "work", plannedSeconds: 600, round: { index: 1, of: 3 }, text: "10 min 88-93% FTP" });
    expect(rows[1].target).toMatchObject({ low: 220, high: 232.5, unit: "W", text: "220-233 W" });
    expect(rows[7]).toMatchObject({ plannedSeconds: null, target: null });
  });

  it("swim: distance steps have meters, send-off reps have the send-off as time", () => {
    const rows = plannedRows(swim, anchors);
    expect(rows[0]).toMatchObject({ plannedMeters: 400, plannedSeconds: null });
    expect(rows[1]).toMatchObject({ key: "s3#1", plannedMeters: 100, plannedSeconds: 120 });
  });

  it("keys match the player's", () => {
    expect(plannedRows(bike, anchors).map((r) => r.key)).toEqual(flattenWorkout(bike).map((p) => p.key));
  });
});

describe("checkResults", () => {
  it("accepts known keys", () => {
    expect(checkResults(bike, [{ key: "s1", status: "done", activeSeconds: 900 }]).ok).toBe(true);
  });
  it("refuses unknown and repeated keys, unknown fields and ranges, with paths", () => {
    const r = checkResults(bike, [
      { key: "s9", status: "done" },
      { key: "s1", status: "done" },
      { key: "s1", status: "skipped" },
    ]);
    expect(r).toEqual({ ok: false, errors: [{ path: "0.key", message: 'no step "s9" in this workout' }, { path: "2.key", message: 'step "s1" is given twice' }] });
    expect(checkResults(bike, [{ key: "s1", status: "done", watts: 200 }]).ok).toBe(false);
    expect(checkResults(bike, [{ key: "s1", status: "done", rpe: 11 }]).ok).toBe(false);
    expect(checkResults(bike, []).ok).toBe(false);
  });
  it("refuses more than 64 KB", () => {
    const note = "x".repeat(280);
    const many = Array.from({ length: 300 }, (_, i) => ({ key: `s1`, status: "done" as const, notes: `${i}${note}`.slice(0, 280) }));
    const r = checkResults(bike, many);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.some((e) => e.message.includes("64 KB"))).toBe(true);
  });
});

describe("compareStep", () => {
  const rows = plannedRows(bike, anchors);
  it("bands a step by time with C5's colours", () => {
    expect(compareStep(rows[1], { key: "s3#1", status: "done", activeSeconds: 600 }).band).toBe("green");
    expect(compareStep(rows[1], { key: "s3#1", status: "partial", activeSeconds: 400 }).band).toBe("yellow");
    expect(compareStep(rows[1], { key: "s3#1", status: "skipped", activeSeconds: 10 }).band).toBe("red");
    expect(compareStep(rows[7], { key: "s5", status: "done", activeSeconds: 300 }).band).toBe("done");
    expect(compareStep(rows[1], undefined).band).toBeNull();
  });
  it("says whether a measured value is in the target", () => {
    expect(compareStep(rows[1], { key: "s3#1", status: "done", value: 225 }).hit).toBe("in");
    expect(compareStep(rows[1], { key: "s3#1", status: "done", value: 200 }).hit).toBe("below");
    expect(compareStep(rows[1], { key: "s3#1", status: "done", value: 240 }).hit).toBe("above");
    expect(compareStep(rows[2], { key: "s4#1", status: "done", value: 100 }).hit).toBeNull();
  });
});

describe("results from a run, as planned, and totals", () => {
  const steps = flattenWorkout(bike);
  it("a finished run gives every step, unreached ones as not done", () => {
    let s = start(initialState({ plannedSessionId: 1, workoutHash: "h", clientKey: "k" }), steps, 0);
    s = tick(s, steps, 900_000).state;
    s = skip(s, steps, 960_000);
    s = finish(s, steps, 1_000_000);
    const r = resultsFromRun(s, steps);
    expect(r.slice(0, 4)).toEqual([
      { key: "s1", status: "done", activeSeconds: 900 },
      { key: "s3#1", status: "skipped", activeSeconds: 60 },
      { key: "s4#1", status: "partial", activeSeconds: 40 },
      { key: "s3#2", status: "not_done" },
    ]);
    expect(r).toHaveLength(8);
    expect(checkResults(bike, r).ok).toBe(true);
  });

  it("as planned: planned time and distance, rounded", () => {
    const r = resultsAsPlanned(plannedRows(swim, anchors));
    expect(r[0]).toEqual({ key: "s1", status: "done", distanceMeters: 400 });
    expect(r[1]).toEqual({ key: "s3#1", status: "done", activeSeconds: 120, distanceMeters: 100 });
  });

  it("totals leave rest steps out of the moving time", () => {
    const rows = plannedRows(bike, anchors);
    const t = resultTotals(rows, resultsAsPlanned(rows));
    expect(t.activeSeconds).toBe(900 + 3 * 900);
    expect(t.movingSeconds).toBe(900 + 3 * 600);
    expect(t.distanceMeters).toBeNull();
  });
});

describe("workoutPlannedLoad", () => {
  it("adds each step's estimate and marks a lap step partial", () => {
    const p = workoutPlannedLoad(bike, anchors);
    const expected = (900 / 3600) * 0.6 ** 2 * 100 + 3 * (600 / 3600) * 0.905 ** 2 * 100;
    expect(p.load).toBeCloseTo(expected, 6);
    expect(p.partial).toBe(true);
  });
  it("maps thresholds to load anchors", () => {
    expect(loadAnchors({ ftp: 250, run_threshold_pace: 4, swim_css: 1 })).toEqual({ ftp: 250, runThresholdSpeed: 4, swimCss: 1 });
  });
});
