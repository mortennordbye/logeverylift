import { outdoorTarget } from "@/lib/utils/bike-outdoor";
import { allOutStep, ftpTestResult, ftpTestThreshold, ftpTestView, ftpTestWorkout } from "@/lib/utils/ftp-tests";
import { workoutToRows } from "@/lib/utils/program-steps";
import type { StepLog } from "@/lib/utils/ride-results";
import { rideScreen } from "@/lib/utils/ride-screen";
import { bestRollingPower, rideStreamNumbers } from "@/lib/utils/ride-stream";
import { buildRidePlan, rideTimeline, type RideEventInput, type RidePlan } from "@/lib/utils/ride-timeline";
import { valueFromTest } from "@/lib/utils/thresholds";
import { estimateWorkout, parseWorkout, WORKOUT_LIMITS, type ThresholdValues, type WorkoutStep } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/** FTP test rides (docs/plans/bike-ride-logger.md, 4.9, step 8). */

const T0 = Date.UTC(2026, 10, 18, 17, 0, 0);
const at = (s: number) => T0 + s * 1000;
let seq = 0;
const ev = (kind: RideEventInput["kind"], s: number): RideEventInput => ({ seq: ++seq, kind, at: at(s) });

function plan(test: "ramp" | "20min", thresholds: ThresholdValues = { ftp: 200, lthr_bike: 170 }, mode: "indoor" | "outdoor" = "indoor"): RidePlan {
  const parsed = parseWorkout(ftpTestWorkout(test));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const ids = workoutToRows(parsed.workout).map((_, i) => i + 1);
  return buildRidePlan(parsed.workout, ids, thresholds, mode);
}

const log = (over: Partial<StepLog> = {}): Pick<StepLog, "status" | "avgPower"> => ({ status: "done", avgPower: null, ...over });

describe("ftpTestWorkout", () => {
  it("ramp: 10 min warm-up, then 1 min steps from 100 W up by 20 W to 500 W, within the step limits", () => {
    const w = ftpTestWorkout("ramp");
    const parsed = parseWorkout(w);
    expect(parsed.ok).toBe(true);
    expect(w.test).toBe("ramp");
    expect(w.steps[0]).toMatchObject({ type: "warmup", end: { type: "time", seconds: 600 } });
    const work = w.steps.slice(1) as WorkoutStep[];
    expect(work).toHaveLength(21);
    expect(work.map((s) => s.target?.low)).toEqual(Array.from({ length: 21 }, (_, i) => 100 + 20 * i));
    expect(work.every((s) => s.end.type === "time" && s.end.seconds === 60)).toBe(true);
    expect(w.steps.length).toBeLessThanOrEqual(WORKOUT_LIMITS.nodes);
  });

  it("20 min test: 20 min warm-up with two 1 min efforts, 5 min easy, 20 min all-out, 10 min cool-down", () => {
    const w = ftpTestWorkout("20min");
    const parsed = parseWorkout(w);
    expect(parsed.ok).toBe(true);
    const seconds = w.steps.map((s) => (s.type !== "repeat" && s.end.type === "time" ? s.end.seconds : 0));
    expect(seconds).toEqual([780, 60, 300, 60, 300, 1200, 600]);
    expect(seconds.slice(0, 4).reduce((a, b) => a + b, 0)).toBe(20 * 60);
    expect(w.steps.map((s) => s.type)).toEqual(["warmup", "work", "recovery", "work", "recovery", "work", "cooldown"]);
    expect(estimateWorkout(parsed.ok ? parsed.workout : w, {}).durationSeconds).toBe(55 * 60);
  });

  it("the plan freezes the test", () => {
    expect(plan("ramp").test).toBe("ramp");
    expect(allOutStep(plan("20min").steps)?.seconds).toBe(1200);
  });
});

describe("ramp test formula", () => {
  const p = plan("ramp");
  // Steps 2 and on are the 1 min steps: 100, 120, 140 ... W.
  const work = (w: number) => p.steps.find((s) => s.step.type === "work" && s.power?.from === w)!.programSetId;

  it("from the stream: 75% of the best rolling 60 s", () => {
    const logs = { 1: log(), [work(100)]: log(), [work(120)]: log() };
    expect(ftpTestResult(p, logs, { best60sPower: 248.4, stepPower: {} })).toEqual({ test: "ramp", power: 248, basis: "garmin", ftp: 186, estimated: false });
  });

  it("typed: the highest done step's average power, a partial last step left out", () => {
    const logs = { 1: log(), [work(100)]: log({ avgPower: 101 }), [work(120)]: log({ avgPower: 248 }), [work(140)]: log({ status: "partial", avgPower: 300 }) };
    expect(ftpTestResult(p, logs)).toEqual({ test: "ramp", power: 248, basis: "typed", ftp: 186, estimated: false });
  });

  it("no number on the highest done step: its target, as an estimate", () => {
    const logs = { 1: log(), [work(100)]: log(), [work(120)]: log(), [work(140)]: log(), [work(160)]: log({ status: "partial" }) };
    expect(ftpTestResult(p, logs)).toEqual({ test: "ramp", power: 140, basis: "target", ftp: 105, estimated: true });
  });

  it("every 1 min step ran out on the clock (no Lap, no End): no proposal from the targets", () => {
    const all = Object.fromEntries(p.steps.map((s) => [s.programSetId, log()]));
    expect(ftpTestResult(p, all)).toBeNull();
    // Numbers the rider typed or Garmin gave still count.
    const typed = { ...all, [work(500)]: log({ avgPower: 480 }) };
    expect(ftpTestResult(p, typed)).toMatchObject({ power: 480, basis: "typed", estimated: false });
  });

  it("no 1 min step done: no proposal, even with a stream", () => {
    const logs = { 1: log(), [work(100)]: log({ status: "partial", avgPower: 90 }) };
    expect(ftpTestResult(p, logs)).toBeNull();
    expect(ftpTestResult(p, logs, { best60sPower: 120, stepPower: {} })).toBeNull();
  });

  it("an FTP out of the threshold range gives no proposal", () => {
    // 100 W x 0.75 = 75 W is in range; a typed 40 W gives 30 W, under the 50 W floor.
    expect(ftpTestResult(p, { [work(100)]: log({ avgPower: 40 }) })).toBeNull();
  });
});

describe("20 min test formula", () => {
  const p = plan("20min");
  const allOut = allOutStep(p.steps)!.programSetId;

  it("from the stream: 95% of the all-out step's window average", () => {
    expect(ftpTestResult(p, { [allOut]: log({ avgPower: 250 }) }, { best60sPower: 400, stepPower: { [allOut]: 280.4 } })).toEqual({
      test: "20min",
      power: 280,
      basis: "garmin",
      ftp: 266,
      estimated: false,
    });
  });

  it("typed: 95% of the all-out step's average power", () => {
    expect(ftpTestResult(p, { [allOut]: log({ avgPower: 196 }) })).toEqual({ test: "20min", power: 196, basis: "typed", ftp: 186, estimated: false });
  });

  it("the all-out step not done, or with no power: no proposal", () => {
    expect(ftpTestResult(p, { [allOut]: log({ status: "partial", avgPower: 250 }) })).toBeNull();
    expect(ftpTestResult(p, { [allOut]: log() })).toBeNull();
    expect(ftpTestResult(p, {})).toBeNull();
  });

  it("not a test ride: nothing", () => {
    const { test: _t, ...noTest } = p;
    void _t;
    expect(ftpTestView(noTest, { [allOut]: log({ avgPower: 196 }) }, null, 180)).toBeNull();
  });

  it("the view is not saved by a current FTP that happens to match: only a stored test row says saved", () => {
    expect(ftpTestView(p, { [allOut]: log({ avgPower: 196 }) }, null, 180)).toMatchObject({ saved: false, currentFtp: 180, result: { ftp: 186 } });
    expect(ftpTestView(p, { [allOut]: log({ avgPower: 196 }) }, null, 186)).toMatchObject({ saved: false });
  });

  it("the threshold field test agrees with the formula", () => {
    const r20 = ftpTestResult(p, { [allOut]: log({ avgPower: 196 }) })!;
    const t20 = ftpTestThreshold(r20);
    expect(valueFromTest("ftp", t20.protocol, t20.testData)).toEqual({ value: r20.ftp });
    const rRamp = { test: "ramp" as const, power: 248, basis: "typed" as const, ftp: 186, estimated: false };
    const tRamp = ftpTestThreshold(rRamp);
    expect(valueFromTest("ftp", tRamp.protocol, tRamp.testData)).toEqual({ value: 186 });
  });
});

describe("the ramp's best minute from the stream", () => {
  it("counts only the windows of the ridden 1 min steps: a sprint in the warm-up is left out", () => {
    const p = plan("ramp");
    const t = Array.from({ length: 780 }, (_, i) => i);
    // A 60 s sprint at 600 W in the warm-up, then 100, 120 and 140 W steps.
    const power = t.map((s) => (s >= 100 && s < 160 ? 600 : s < 600 ? 90 : s < 660 ? 100 : s < 720 ? 120 : 140));
    const windows = [
      { programSetId: p.steps[0].programSetId, from: 0, to: 600 },
      { programSetId: p.steps[1].programSetId, from: 600, to: 660 },
      { programSetId: p.steps[2].programSetId, from: 660, to: 720 },
      { programSetId: p.steps[3].programSetId, from: 720, to: 780 },
    ];
    const n = rideStreamNumbers({ t, power }, p.steps, windows, { ftp: 200, lthr: null, mode: "indoor" });
    expect(n.best60sPower).toBe(140);
  });
});

describe("bestRollingPower", () => {
  it("holds each sample for its duration and finds the best minute", () => {
    const t = Array.from({ length: 180 }, (_, i) => i);
    const power = t.map((s) => (s >= 60 && s < 120 ? 250 : 100));
    expect(bestRollingPower(t, power)).toBe(250);
    expect(bestRollingPower(t.slice(0, 30), power.slice(0, 30))).toBeNull();
  });
});

describe("ramp test ride", () => {
  const p = plan("ramp");

  it("Lap on a 1 min step finishes the ride, that step partial", () => {
    const t = rideTimeline(p, [ev("start", 0), ev("lap", 600 + 3 * 60 + 20)], at(2000));
    expect(t.status).toBe("finished");
    expect(t.steps.map((s) => s.status)).toEqual(["done", "done", "done", "done", "partial"]);
    expect(t.steps.at(-1)!.activeSeconds).toBe(20);
  });

  it("Lap or End ride before any 1 min step is done ends the test early", () => {
    expect(rideTimeline(p, [ev("start", 0), ev("lap", 630)], at(700)).status).toBe("ended_early");
    expect(rideTimeline(p, [ev("start", 0), ev("pause", 640), ev("end", 650)], at(700)).status).toBe("ended_early");
  });

  it("End ride on a 1 min step finishes the ride too; on the warm-up it ends early", () => {
    expect(rideTimeline(p, [ev("start", 0), ev("pause", 700), ev("end", 710)], at(800)).status).toBe("finished");
    expect(rideTimeline(p, [ev("start", 0), ev("pause", 100), ev("end", 110)], at(200)).status).toBe("ended_early");
  });

  it("Lap on the warm-up does not end the test", () => {
    const t = rideTimeline(p, [ev("start", 0), ev("lap", 300)], at(310));
    expect(t.status).toBe("running");
    expect(t.current?.index).toBe(1);
  });

  it("a plain ride's Lap on a time step does not end it", () => {
    const { test: _t, ...plain } = p;
    void _t;
    expect(rideTimeline(plain, [ev("start", 0), ev("lap", 620)], at(630)).status).toBe("running");
  });

  it("ride mode shows Lap indoors on a 1 min step, with the line that it ends the test", () => {
    const s = rideScreen(p, rideTimeline(p, [ev("start", 0)], at(610)))!;
    expect(s.lap).toBe(true);
    expect(s.lapHint).toBe("Tap Lap when you cannot hold the watts");
    const warm = rideScreen(p, rideTimeline(p, [ev("start", 0)], at(10)))!;
    expect(warm.lap).toBe(false);
    expect(warm.lapHint).toBeNull();
  });
});

describe("outdoor targets of a test ride (4.2 overridden)", () => {
  it("effort, never a heart rate cap or range", () => {
    const ramp = plan("ramp", { ftp: 200, lthr_bike: 170 }, "outdoor");
    expect(ramp.steps[0].outdoor?.text).toBe("Effort 2");
    expect(ramp.steps.every((s) => s.outdoor === null || s.outdoor.unit === "RPE")).toBe(true);
    const twenty = plan("20min", { ftp: 200, lthr_bike: 170 }, "outdoor");
    expect(twenty.steps.map((s) => s.outdoor?.text)).toEqual(["Effort 2", "Effort 9", "Effort 2", "Effort 9", "Effort 2", "Effort 9-10", "Effort 2"]);
  });

  it("a work ramp in a test takes the effort of its top end; outside a test it keeps the heart rate cap", () => {
    const step = { type: "work" as const, end: { type: "time" as const, seconds: 600 }, ramp: { anchor: "ftp" as const, from: 60, to: 130 } };
    expect(outdoorTarget(step, 600, { ftp: 200, lthr_bike: 170 }, undefined, "ramp")?.main.text).toBe("Effort 9");
    expect(outdoorTarget(step, 600, { ftp: 200, lthr_bike: 170 })?.main.text).toBe("HR under 138");
  });

  it("outdoors with no FTP the 1 min steps rise in effort, 5 up to 10", () => {
    const ramp = plan("ramp", {}, "outdoor");
    const efforts = ramp.steps.filter((s) => s.step.type === "work").map((s) => s.outdoor?.low);
    expect(efforts[0]).toBe(5);
    expect(efforts.at(-1)).toBe(10);
    expect(efforts.every((e, i) => i === 0 || e! >= efforts[i - 1]!)).toBe(true);
    expect(ramp.steps[1].outdoor?.text).toBe("Effort 5");
  });

  it("a written outdoor target still wins", () => {
    const step = { type: "work" as const, end: { type: "time" as const, seconds: 600 }, target: { metric: "power" as const, anchor: "ftp" as const, low: 90, high: 95 }, outdoor: { metric: "hr" as const, anchor: "absolute" as const, low: 150, high: 160 } };
    expect(outdoorTarget(step, 600, { ftp: 200 }, undefined, "20min")?.main.text).toBe("HR 150-160");
  });
});
