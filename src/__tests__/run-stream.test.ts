import { buildRunPlan } from "@/lib/utils/run-plan";
import type { RideSplit, RideStreams } from "@/lib/utils/ride-stream";
import { beltSpans, decoupling, runDoneChart, runStreamNumbers, runWindowValues, smoothedSpeedGrade, type RunStreamInput } from "@/lib/utils/run-stream";
import { gapSpeed } from "@/lib/utils/run-gap";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/** The numbers of a run that only a Garmin stream gives (docs/plans/run-logger.md, 4.9, step 7). */

const TH = { run_threshold_pace: 1000 / 339, lthr_run: 180 };

/** 50 min steady in zone 2, strides 6 x (20 s fast, 100 s easy), 3 min cool-down. */
const parsed = parseWorkout({
  v: 2,
  sport: "run",
  name: "Base",
  steps: [
    { type: "work", end: { type: "time", seconds: 3000 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
    {
      type: "repeat",
      count: 6,
      steps: [
        { type: "work", end: { type: "time", seconds: 20 }, target: { metric: "rpe", anchor: "absolute", low: 8, high: 9 } },
        { type: "recovery", end: { type: "time", seconds: 100 }, target: { metric: "rpe", anchor: "absolute", low: 2, high: 2 } },
      ],
    },
    { type: "cooldown", end: { type: "time", seconds: 180 } },
  ],
});
if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
const ids = Array.from({ length: 14 }, (_, i) => i + 1);
const plan = buildRunPlan(parsed.workout, ids, TH, "outdoor");

/** Each step's window one after the other from stream second 0. */
function split(): RideSplit {
  let at = 0;
  return {
    method: "time",
    windows: plan.steps.map((s) => {
      const w = { programSetId: s.programSetId, from: at, to: at + (s.seconds ?? 0) };
      at = w.to;
      return w;
    }),
    pauses: [],
  };
}

/** A 1 s stream over the plan: `at(s)` gives speed (m/s) and heart rate at stream second s; flat. */
function stream(at: (s: number) => { speed: number; hr: number; climb?: number }): RideStreams {
  const end = split().windows.at(-1)!.to;
  const t: number[] = [];
  const hr: number[] = [];
  const distance: number[] = [];
  const altitude: number[] = [];
  const cadence: number[] = [];
  let d = 0;
  let a = 100;
  for (let s = 0; s < end; s++) {
    const x = at(s);
    t.push(s);
    hr.push(x.hr);
    d += x.speed;
    a += (x.climb ?? 0) * x.speed;
    distance.push(d);
    altitude.push(a);
    cadence.push(85);
  }
  return { t, hr, distance, altitude, cadence };
}

const input = (streams: RideStreams): RunStreamInput => ({ streams, t0Ms: 0, split: split(), plan, belts: null, bounds: {} });
const stridesFrom = 3000;
const stridesTo = 3000 + 6 * 120;

describe("decoupling (4.9, unit 14)", () => {
  it("leaves out the strides and the first 10 min: a hot start and fast strides change nothing", () => {
    const s = stream((t) =>
      t < 600 ? { speed: 2.5, hr: 175 } : t >= stridesFrom && t < stridesTo ? { speed: (t - stridesFrom) % 120 < 20 ? 3.6 : 2, hr: 178 } : { speed: 2.5, hr: 140 },
    );
    const n = runStreamNumbers(input(s));
    // Counted, the hot start (175) or the strides (178) would move it by more than 10%; only the 30 s smoothing at the steady step's edge is left.
    expect(Math.abs(n.drift!.pct)).toBeLessThan(0.5);
    expect(n.drift!.steady).toBe(true);
  });

  it("splits the steady part into two halves by time: heart rate up 10 bpm at the same pace is over 5%", () => {
    // Steady counts from 600 to 3000 s: the halves meet at 1800 s.
    const s = stream((t) => ({ speed: 2.5, hr: t < 1800 ? 140 : 150 }));
    const drift = decoupling(input(s), smoothedSpeedGrade(s).speed.map((v) => (v === null ? null : gapSpeed(v, 0, false))));
    expect(drift?.pct).toBeCloseTo(6.7, 1);
    expect(drift?.steady).toBe(false);
  });

  it("needs 45 min of steady steps", () => {
    const short = parseWorkout({ v: 2, sport: "run", name: "Short", steps: [{ type: "work", end: { type: "time", seconds: 2400 } }] });
    if (!short.ok) throw new Error("bad");
    const p = buildRunPlan(short.workout, [1], TH, "outdoor");
    const t = Array.from({ length: 2400 }, (_, i) => i);
    const streams = { t, hr: t.map(() => 140), distance: t.map((i) => i * 2.5) };
    const n = runStreamNumbers({ streams, t0Ms: 0, split: { method: "time", windows: [{ programSetId: 1, from: 0, to: 2400 }], pauses: [] }, plan: p, belts: null, bounds: {} });
    expect(n.drift).toBeNull();
  });
});

describe("outdoor GAP, IF and load from the stream (4.9)", () => {
  it("on the flat GAP is the pace; uphill GAP is faster than the pace", () => {
    const flat = runStreamNumbers(input(stream(() => ({ speed: 2.5, hr: 140 }))));
    expect(flat.gapSPerKm).toBeCloseTo(400, 0);
    // IF = 2.5 / (1000 / 339) = 0.8475; load = hours x IF^2 x 100 over 65 min.
    expect(flat.intensityFactor).toBeCloseTo(0.8475, 3);
    expect(flat.load).toBeCloseTo((3900 / 3600) * 0.8475 ** 2 * 100, 1);
    const hill = runStreamNumbers(input(stream(() => ({ speed: 2.5, hr: 140, climb: 0.05 }))));
    expect(hill.gapSPerKm!).toBeLessThan(flat.gapSPerKm! - 30);
  });

  it("time in heart rate zones from the 1 s stream (Friel, run LTHR 180)", () => {
    const n = runStreamNumbers(input(stream((t) => ({ speed: 2.5, hr: t < 1950 ? 140 : 160 }))));
    // 140 is 78% (zone 1), 160 is 89% (zone 2).
    expect(n.hrZoneMinutes).toEqual([33, 33, 0, 0, 0]);
  });

  it("time on target: the share of a step's seconds inside its heart rate cap", () => {
    const s = stream((t) => ({ speed: 2.5, hr: t < 2400 ? 150 : 165 }));
    const n = runStreamNumbers({ ...input(s), bounds: { 1: { series: "hr", low: null, high: 160 } } });
    expect(n.onTarget[1]).toBe(80);
    expect(n.onTarget[2]).toBeNull();
  });

  it("no load on Trail or snow, nor without a threshold pace", () => {
    const s = stream(() => ({ speed: 2.5, hr: 140 }));
    expect(runStreamNumbers({ ...input(s), plan: { ...plan, surface: "trail" } }).load).toBeNull();
    expect(runStreamNumbers({ ...input(s), plan: { ...plan, thresholds: { lthr_run: 180 } } }).load).toBeNull();
  });
});

describe("a step's values for the fill (4.8)", () => {
  it("doubles Garmin's per-foot cadence and gives no power; a treadmill has no climbing", () => {
    const s = { ...stream(() => ({ speed: 2.5, hr: 140, climb: 0.01 })), power: [] as (number | null)[] };
    s.cadence = s.t.map((i) => ((i as number) % 2 ? 84 : 86));
    s.power = s.t.map(() => 300);
    const w = { programSetId: 1, from: 0, to: 600 };
    expect(runWindowValues(s, w, "outdoor")).toMatchObject({ avgCadence: 170, avgPower: null, distanceMeters: 1498 });
    expect(runWindowValues(s, w, "outdoor").climbM).toBeGreaterThan(10);
    expect(runWindowValues(s, w, "indoor").climbM).toBeNull();
  });
});

describe("belt spans of a treadmill run (4.9)", () => {
  it("follow the frozen belt and the belt events of each step; an event with another step's key is ignored", () => {
    const tp = buildRunPlan(parsed.workout, ids, TH, "indoor");
    const steps = [
      { index: 0, key: tp.steps[0].key, startedAt: 0, endedAt: 3_000_000 },
      { index: 1, key: tp.steps[1].key, startedAt: 3_000_000, endedAt: 3_020_000 },
    ];
    const spans = beltSpans(tp, steps, [
      { seq: 1, kind: "belt", value: 85, at: 1_000_000, stepKey: tp.steps[0].key },
      { seq: 2, kind: "belt", value: 95, at: 2_000_000, stepKey: tp.steps[1].key },
      { seq: 3, kind: "incline", value: 10, at: 2_500_000, stepKey: null },
    ]);
    expect(spans.map((b) => [b.from, b.to, b.kmh, b.incline])).toEqual([
      [0, 1_000_000, tp.steps[0].run!.belt! / 10, null],
      [1_000_000, 2_500_000, 8.5, null],
      [2_500_000, 3_000_000, 8.5, 1],
      [3_000_000, 3_020_000, tp.steps[1].run!.belt! / 10, 1],
    ]);
  });
});

describe("the plan against done chart (section 5)", () => {
  it("outdoors labels whole-minute paces that never crowd each other, slow recoveries too", () => {
    const s = stream((t) => ({ speed: t >= stridesFrom && t < stridesTo && (t - stridesFrom) % 120 >= 20 ? 1.6 : 3, hr: 150 }));
    const chart = runDoneChart(input(s))!;
    expect(chart.power).toBeTruthy();
    expect(chart.yTicks.length).toBeGreaterThan(1);
    for (let i = 1; i < chart.yTicks.length; i++) expect(Math.abs(chart.yTicks[i].y - chart.yTicks[i - 1].y)).toBeGreaterThanOrEqual(12);
  });
});

describe("step 7 review: time on target of the whole run", () => {
  it("weighs each step by its seconds in the stream: a step ended early or extended counts as run", () => {
    // The 50 min steady ended after 10 min over its cap; the 3 min cool-down ran 30 min under it.
    const steady = plan.steps[0].programSetId;
    const cool = plan.steps[plan.steps.length - 1].programSetId;
    const t = Array.from({ length: 2400 }, (_, i) => i);
    const streams = { t, hr: t.map((i) => (i < 600 ? 170 : 150)), distance: t.map((i) => i * 2.5) };
    const n = runStreamNumbers({
      streams,
      t0Ms: 0,
      split: { method: "time", windows: [{ programSetId: steady, from: 0, to: 600 }, { programSetId: cool, from: 600, to: 2400 }], pauses: [] },
      plan,
      belts: null,
      bounds: { [steady]: { series: "hr", low: null, high: 160 }, [cool]: { series: "hr", low: null, high: 160 } },
    });
    expect(n.onTarget).toEqual({ [steady]: 0, [cool]: 100 });
    expect(n.timeOnTarget).toBe(75);
  });
});
