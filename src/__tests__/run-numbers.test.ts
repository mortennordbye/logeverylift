import { describe, expect, it } from "vitest";
import { rideTimeline, type RideEventInput } from "@/lib/utils/ride-timeline";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { adjustedGrade, gapSpeed } from "@/lib/utils/run-gap";
import { doneRunNumbers, paceText } from "@/lib/utils/run-numbers";
import { beltResults } from "@/lib/utils/run-screen";
import { runPaceLoad } from "@/lib/utils/training-load";
import { parseWorkout, type ThresholdValues, type Workout } from "@/lib/utils/workout-steps";

/** The numbers of a run without a stream (docs/plans/run-logger.md, 4.9, section 7 unit test 13). */

const T0 = Date.UTC(2026, 10, 20, 17, 0, 0);
/** The owner: threshold pace 5:39 /km, run LTHR 180. */
const OWNER: ThresholdValues = { run_threshold_pace: 1000 / 339, lthr_run: 180 };
const kmh = (ms: number) => ms * 3.6;

function tree(w: unknown): Workout {
  const r = parseWorkout(w);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.workout;
}

/** The mockup run of 4.9: warm-up 10 min at 7.5 km/h, steady 50 min at 8.0, strides 6 × (20 s at 13, 100 s at 7), cool-down 3 min at 5.5. */
const MOCKUP = tree({
  v: 2,
  sport: "run",
  name: "2 Base · Run",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, belt: 7.5 },
    { type: "work", end: { type: "time", seconds: 3000 }, belt: 8 },
    {
      type: "repeat",
      count: 6,
      steps: [
        { type: "work", end: { type: "time", seconds: 20 }, belt: 13 },
        { type: "recovery", end: { type: "time", seconds: 100 }, belt: 7 },
      ],
    },
    { type: "cooldown", end: { type: "time", seconds: 180 }, belt: 5.5 },
  ],
});

/** The mockup run, run on a treadmill from start to end with no belt taps: each step as run mode saves it. */
function mockupSteps() {
  const plan = buildRunPlan(MOCKUP, Array.from({ length: 15 }, (_, i) => 100 + i), OWNER, "indoor");
  const events: RideEventInput[] = [{ seq: 1, kind: "start", at: T0 }];
  const t = rideTimeline(plan, events, T0 + 4600 * 1000);
  return t.steps.map((r) => {
    const b = beltResults(r);
    return { seconds: r.activeSeconds, meters: b.distanceMeters ?? null, inclinePct: b.inclinePercent ?? null, avgHr: null };
  });
}

describe("the mockup run (section 7, unit test 13)", () => {
  it("gives 9.8 km and 7:39 /km over 75 min", () => {
    const n = doneRunNumbers(mockupSteps(), { thresholdSpeed: OWNER.run_threshold_pace, lthr: OWNER.lthr_run, rpe: null, treadmill: true });
    expect(n.seconds).toBe(4500);
    expect((n.meters! / 1000).toFixed(1)).toBe("9.8");
    expect(paceText(n.paceSPerKm!)).toBe("7:39 /km");
    // Flat: GAP is the pace.
    expect(paceText(n.gapSPerKm!)).toBe("7:39 /km");
  });

  it("gives a pace load, summed per step, as an estimate", () => {
    const n = doneRunNumbers(mockupSteps(), { thresholdSpeed: OWNER.run_threshold_pace, lthr: null, rpe: 6, treadmill: true });
    expect(n.load).toEqual({ value: expect.any(Number), method: "pace", estimated: true });
    // Each step's hours x (speed / threshold speed)^2 x 100.
    const thr = 3.6 * OWNER.run_threshold_pace!;
    const walk = (5.5 / thr) ** 2 * (180 / 3600) * 100;
    const expected = ((7.5 / thr) ** 2 * 600 + (8 / thr) ** 2 * 3000 + 6 * ((13 / thr) ** 2 * 20 + (7 / thr) ** 2 * 100)) / 36 + walk;
    expect(n.load!.value).toBeCloseTo(expected, 0);
    expect(n.intensityFactor).toBeCloseTo(Math.sqrt(n.load!.value / 125), 3);
  });
});

describe("grade-adjusted pace (4.9)", () => {
  const speed = 10 / 3.6;
  it("is the pace at 0% and at 1% on a treadmill, which counts as flat", () => {
    expect(gapSpeed(speed, 0, true)).toBe(speed);
    expect(gapSpeed(speed, 1, true)).toBe(speed);
    expect(adjustedGrade(1, true)).toBe(0);
  });

  it("at 5% on a treadmill adjusts 4% on Minetti's running curve", () => {
    expect(adjustedGrade(5, true)).toBe(4);
    // Cr(0.04) / Cr(0) = 4.451 / 3.6.
    expect(kmh(gapSpeed(speed, 5, true))).toBeCloseTo(10 * 1.2364, 2);
    // Outdoors the whole grade counts.
    expect(kmh(gapSpeed(speed, 5, false))).toBeGreaterThan(kmh(gapSpeed(speed, 5, true)));
  });

  it("a walk at 6 km/h and 5% uses Minetti's walking curve", () => {
    // Cw(0.04) / Cw(0) = 3.3620 / 2.5.
    expect(kmh(gapSpeed(6 / 3.6, 5, true))).toBeCloseTo(6 * 1.3448, 2);
    expect(kmh(gapSpeed(7 / 3.6, 5, true))).toBeCloseTo(7 * 1.2364, 2);
  });

  it("a 5% treadmill step raises the pace load", () => {
    const flat = doneRunNumbers([{ seconds: 1800, meters: 5000, inclinePct: 1, avgHr: null }], { thresholdSpeed: 3, lthr: null, rpe: null, treadmill: true });
    const hill = doneRunNumbers([{ seconds: 1800, meters: 5000, inclinePct: 5, avgHr: null }], { thresholdSpeed: 3, lthr: null, rpe: null, treadmill: true });
    expect(hill.load!.value / flat.load!.value).toBeCloseTo(1.2364 ** 2, 2);
    expect(paceText(hill.gapSPerKm!)).not.toBe(paceText(hill.paceSPerKm!));
  });
});

describe("the run's load (4.9)", () => {
  const step = { seconds: 1800, meters: 5000, inclinePct: null, avgHr: null };
  it("has no pace load on Trail or snow, with no belt or distance, or with no threshold pace: the effort load then", () => {
    const base = { thresholdSpeed: 3, lthr: null, rpe: 5, treadmill: false };
    expect(doneRunNumbers([step], { ...base, surface: "trail" }).load?.method).toBe("effort");
    expect(doneRunNumbers([{ ...step, meters: null }], { ...base, treadmill: true }).load?.method).toBe("effort");
    expect(doneRunNumbers([step], { ...base, thresholdSpeed: null }).load?.method).toBe("effort");
    expect(doneRunNumbers([step], { ...base, thresholdSpeed: null, rpe: null }).load).toBeNull();
    expect(doneRunNumbers([step], base).load?.method).toBe("pace");
  });

  it("needs distance on 90% of the time", () => {
    const base = { thresholdSpeed: 3, lthr: null, rpe: 5, treadmill: true };
    expect(doneRunNumbers([step, { ...step, seconds: 180, meters: null }], base).load?.method).toBe("pace");
    expect(doneRunNumbers([step, { ...step, seconds: 300, meters: null }], base).load?.method).toBe("effort");
  });
});

describe("time in heart rate zones by step (4.9)", () => {
  it("puts each step's time in the zone of its average (Friel, run LTHR)", () => {
    const n = doneRunNumbers(
      [
        { seconds: 600, meters: null, inclinePct: null, avgHr: 140 },
        { seconds: 3000, meters: null, inclinePct: null, avgHr: 156 },
        { seconds: 300, meters: null, inclinePct: null, avgHr: null },
      ],
      { thresholdSpeed: null, lthr: 180, rpe: null, treadmill: true },
    );
    expect(n.hrZoneMinutes).toEqual([10, 50, 0, 0, 0]);
    expect(n.avgHr).toBeCloseTo((140 * 600 + 156 * 3000) / 3600, 5);
    expect(doneRunNumbers([{ seconds: 600, meters: null, inclinePct: null, avgHr: 140 }], { thresholdSpeed: null, lthr: null, rpe: null, treadmill: true }).hrZoneMinutes).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("runPaceLoad with an incline (section 3)", () => {
  it("gives a pace load on a 1% treadmill run, and a higher one on a hill", () => {
    const flat = runPaceLoad({ seconds: 3600, meters: 10000 }, 3);
    expect(runPaceLoad({ seconds: 3600, meters: 10000, inclinePercent: 1 }, 3)).toEqual(flat);
    const hill = runPaceLoad({ seconds: 3600, meters: 10000, inclinePercent: 5 }, 3);
    expect(hill!.intensityFactor / flat!.intensityFactor).toBeCloseTo(1.2364, 3);
  });
});
