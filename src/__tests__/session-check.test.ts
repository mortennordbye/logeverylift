import type { StepLog } from "@/lib/utils/ride-results";
import { buildRidePlan } from "@/lib/utils/ride-timeline";
import { buildRunPlan } from "@/lib/utils/run-plan";
import { checkStep, checkSteps, judge, sessionVerdict, splitWatchOnly } from "@/lib/utils/session-check";
import { parseWorkout, type ThresholdValues, type Workout } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/** The session check's judging rule and step cards (docs/plans/session-check.md, decisions 1, 7 and 8). */

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

describe("judge", () => {
  it("in inside the range, over or under only past the margin of each metric", () => {
    const r = { low: 140, high: 149 };
    expect(judge("power", 145, r)).toBe("in");
    expect(judge("power", 152, r)).toBe("in");
    expect(judge("power", 153, r)).toBe("over");
    expect(judge("power", 137, r)).toBe("in");
    expect(judge("power", 136, r)).toBe("under");
    const hr = { low: 140, high: 150 };
    expect(judge("hr", 152, hr, { seconds: 600 })).toBe("in");
    expect(judge("hr", 153, hr, { seconds: 600 })).toBe("over");
    expect(judge("hr", 137, hr, { seconds: 600 })).toBe("under");
    const cad = { low: 85, high: 95 };
    expect(judge("cadence", 83, cad)).toBe("in");
    expect(judge("cadence", 82, cad)).toBe("under");
    expect(judge("cadence", 98, cad)).toBe("over");
  });

  it("pace is seconds per km: faster than the range past 5 s is over, slower is under", () => {
    const r = { low: 335, high: 359 };
    expect(judge("pace", 330, r)).toBe("in");
    expect(judge("pace", 329, r)).toBe("over");
    expect(judge("pace", 364, r)).toBe("in");
    expect(judge("pace", 365, r)).toBe("under");
  });

  it("a cap passes under it, a floor passes over it", () => {
    expect(judge("hr", 120, { low: null, high: 161 }, { seconds: 1200 })).toBe("in");
    expect(judge("hr", 163, { low: null, high: 161 }, { seconds: 1200 })).toBe("in");
    expect(judge("hr", 164, { low: null, high: 161 }, { seconds: 1200 })).toBe("over");
    expect(judge("power", 400, { low: 250, high: null })).toBe("in");
    expect(judge("power", 246, { low: 250, high: null })).toBe("under");
  });

  it("heart rate is not judged on a step under 3 min, nor with no length", () => {
    expect(judge("hr", 190, { low: 140, high: 150 }, { seconds: 179 })).toBe("none");
    expect(judge("hr", 190, { low: 140, high: 150 }, { seconds: 180 })).toBe("over");
    expect(judge("hr", 190, { low: 140, high: 150 })).toBe("none");
  });

  it("time is in within 10 % of the plan", () => {
    const t = { low: 900, high: 900 };
    expect(judge("time", 990, t)).toBe("in");
    expect(judge("time", 810, t)).toBe("in");
    expect(judge("time", 991, t)).toBe("over");
    expect(judge("time", 809, t)).toBe("under");
  });

  it("pace outside is shown, not judged", () => {
    expect(judge("pace", 200, { low: 335, high: 359 }, { outdoor: true })).toBe("none");
  });

  it("no target or no number is none", () => {
    expect(judge("power", null, { low: 1, high: 2 })).toBe("none");
    expect(judge("power", 100, null)).toBe("none");
    expect(judge("power", 100, { low: null, high: null })).toBe("none");
  });
});

/** Bike tempo of the step page picture: warm-up, 2 x (15 min at 140-149 W, HR zone 3, 85-95 rpm, 5 min easy), cool-down. */
const TEMPO = tree({
  v: 2,
  sport: "bike",
  name: "Bike tempo",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "absolute", low: 100, high: 120 } },
    {
      type: "repeat",
      count: 2,
      steps: [
        {
          type: "work",
          end: { type: "time", seconds: 900 },
          target: { metric: "power", anchor: "absolute", low: 140, high: 149 },
          target2: { metric: "hr", anchor: "absolute", low: 135, high: 148 },
          cadence: { low: 85, high: 95 },
        },
        { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "absolute", low: 80, high: 100 } },
      ],
    },
    { type: "cooldown", end: { type: "time", seconds: 600 } },
  ],
});
const BIKE_TH: ThresholdValues = { ftp: 200, lthr_bike: 160 };
// The last recovery is dropped: warm-up 1, work 2, easy 3, work 4, cool-down 6.
const bike = buildRidePlan(TEMPO, [1, 2, 3, 4, 5, 6], BIKE_TH, "indoor");

describe("checkStep: a bike step", () => {
  it("a work step shows power, heart rate and cadence, each with its mark", () => {
    const c = checkStep(bike, 1, log({ avgPower: 146, avgHr: 141, avgCadence: 80 }));
    expect(c.title).toBe("Work · 1 of 2");
    expect(c.time).toEqual({ value: "15:00", plan: "15:00", mark: "in" });
    expect(c.rows.map((r) => [r.label, r.value, r.plan, r.mark])).toEqual([
      ["Power", "146 W", "140-149", "in"],
      ["Heart rate", "141", "135-148", "in"],
      ["Cadence", "80 rpm", "85-95", "under"],
    ]);
  });

  it("over the power range is over", () => {
    expect(checkStep(bike, 3, log({ avgPower: 155 })).rows[0]).toMatchObject({ metric: "power", mark: "over" });
  });

  it("a warm-up, recovery and cool-down show time only", () => {
    const c = checkSteps(bike, { 1: log({ durationSeconds: 600, avgPower: 160 }), 3: log({ durationSeconds: 300, avgPower: 150 }), 6: log({ durationSeconds: 600 }) });
    expect(c.map((s) => [s.title, s.rows.length])).toEqual([
      ["Warm-up", 0],
      ["Work · 1 of 2", 3],
      ["Easy", 0],
      ["Work · 2 of 2", 3],
      ["Cool-down", 0],
    ]);
    expect(c[0].time.mark).toBe("in");
  });

  it("a step with no log has no marks and no time; a skipped one says Skipped", () => {
    const none = checkStep(bike, 1, null);
    expect(none.time).toEqual({ value: "–", plan: "15:00", mark: "none" });
    expect(none.rows.every((r) => r.mark === "none" && r.value === "–")).toBe(true);
    expect(checkStep(bike, 1, log({ status: "skipped", durationSeconds: 5, avgPower: 300 })).time.value).toBe("Skipped");
  });

  it("outdoors heart rate leads: an HR main target is judged on the avg HR", () => {
    const hrRide = tree({ v: 2, sport: "bike", name: "Z2", steps: [{ type: "work", end: { type: "time", seconds: 3600 }, target: { metric: "hr", anchor: "absolute", low: 120, high: 135 } }] });
    const p = buildRidePlan(hrRide, [1], BIKE_TH, "outdoor");
    expect(checkStep(p, 0, log({ durationSeconds: 3600, avgHr: 140 })).rows).toEqual([expect.objectContaining({ metric: "hr", plan: "120-135", mark: "over" })]);
  });
});

/** A treadmill tempo and an outdoor easy run, as the owner runs them (threshold pace 5:39 /km, run LTHR 180). */
const RUN_TH: ThresholdValues = { run_threshold_pace: 1000 / 339, lthr_run: 180 };

describe("checkStep: a run step", () => {
  const TEMPO_RUN = tree({
    v: 2,
    sport: "run",
    name: "Tempo",
    steps: [{ type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "pace", anchor: "threshold_pace", low: 98, high: 102 }, cadence: { low: 155, high: 165 } }],
  });

  it("on a treadmill the belt's pace is judged against the pace range, with the margin in s/km", () => {
    const p = buildRunPlan(TEMPO_RUN, [1], RUN_TH, "indoor");
    // 98-102% of threshold speed: 5:32 to 5:46 /km.
    const at = (kmh: number) => checkStep(p, 0, log({ durationSeconds: 1200, avgSpeed: kmh / 3.6, avgCadence: 160 })).rows.find((r) => r.metric === "pace")!;
    expect(at(10.5)).toMatchObject({ value: "5:43 /km", plan: "5:32-5:46", mark: "in" });
    expect(at(10.1).mark).toBe("under");
    expect(at(11.2).mark).toBe("over");
  });

  it("outdoors the pace is shown, not judged, and the cadence is in spm", () => {
    const p = buildRunPlan(TEMPO_RUN, [1], RUN_TH, "outdoor");
    const c = checkStep(p, 0, log({ durationSeconds: 1200, distanceMeters: 4000, avgSpeed: 4000 / 1200, avgCadence: 160, avgHr: 170 }));
    expect(c.rows.find((r) => r.metric === "pace")).toMatchObject({ value: "5:00 /km", mark: "none" });
    expect(c.rows.find((r) => r.metric === "cadence")).toMatchObject({ value: "160 spm", plan: "155-165", mark: "in" });
    expect(c.rows.find((r) => r.metric === "hr")?.mark).not.toBe("none");
  });

  it("an easy cap passes under it and is over past the margin", () => {
    const easy = tree({ v: 2, sport: "run", name: "Easy", steps: [{ type: "work", end: { type: "time", seconds: 3000 }, target: { metric: "hr", anchor: "lthr", zone: 2 } }] });
    const p = buildRunPlan(easy, [1], RUN_TH, "outdoor");
    const hr = (bpm: number) => checkStep(p, 0, log({ durationSeconds: 3000, avgHr: bpm })).rows[0];
    expect(hr(148)).toMatchObject({ metric: "hr", plan: "under 162", mark: "in" });
    expect(hr(163).mark).toBe("in");
    expect(hr(164).mark).toBe("over");
  });
});

describe("sessionVerdict", () => {
  it("reads the work steps only; time against their planned total", () => {
    const steps = checkSteps(bike, {
      1: log({ durationSeconds: 600, avgPower: 60 }),
      2: log({ avgPower: 146, avgHr: 141, avgCadence: 90 }),
      3: log({ durationSeconds: 300 }),
      4: log({ avgPower: 160, avgHr: 145, avgCadence: 90 }),
      6: log({ durationSeconds: 600 }),
    });
    const v = Object.fromEntries(sessionVerdict(steps).map((m) => [m.metric, m]));
    expect(v.power).toMatchObject({ mark: "over", counts: { in: 1, over: 1, under: 0 }, actual: 153 });
    expect(v.hr).toMatchObject({ mark: "in", counts: { in: 2, over: 0, under: 0 } });
    expect(v.cadence.mark).toBe("in");
    expect(v.time).toMatchObject({ mark: "in", actual: 1800, planned: 1800 });
    expect(v.pace).toBeUndefined();
  });

  it("more under than over is under; nothing judged is none", () => {
    const steps = checkSteps(bike, { 2: log({ avgPower: 120 }), 4: log({ avgPower: 120 }) });
    const v = Object.fromEntries(sessionVerdict(steps).map((m) => [m.metric, m]));
    expect(v.power.mark).toBe("under");
    expect(v.hr.mark).toBe("none");
  });
});

describe("splitWatchOnly", () => {
  const t0 = Date.parse("2026-11-22T08:00:00Z");
  const steps = [
    { programSetId: 1, seconds: 600 },
    { programSetId: 2, seconds: 900 },
    { programSetId: 3, seconds: 300 },
  ];
  const lap = (startS: number, seconds: number) => ({ startTime: new Date(t0 + startS * 1000).toISOString(), totalElapsedTime: seconds, totalTimerTime: seconds });

  it("by laps when there is one lap per step, whatever their length", () => {
    const s = splitWatchOnly(steps, [lap(0, 700), lap(700, 800), lap(1500, 400)], [], t0);
    expect(s.method).toBe("laps");
    expect(s.windows).toEqual([
      { programSetId: 1, from: 0, to: 700 },
      { programSetId: 2, from: 700, to: 1500 },
      { programSetId: 3, from: 1500, to: 1900 },
    ]);
  });

  it("by the planned step times when the lap count differs", () => {
    const s = splitWatchOnly(steps, [lap(0, 1800)], [], t0);
    expect(s.method).toBe("time");
    expect(s.windows).toEqual([
      { programSetId: 1, from: 0, to: 600 },
      { programSetId: 2, from: 600, to: 1500 },
      { programSetId: 3, from: 1500, to: 1800 },
    ]);
  });

  it("by time, a Garmin timer pause pushes the steps on and is a gap in its step", () => {
    const at = (s: number) => new Date(t0 + s * 1000).toISOString();
    const events = [
      { timestamp: at(0), eventType: "start" },
      { timestamp: at(800), eventType: "stop_all" },
      { timestamp: at(860), eventType: "start" },
    ];
    const s = splitWatchOnly(steps, [], events, t0);
    expect(s.windows).toEqual([
      { programSetId: 1, from: 0, to: 600 },
      { programSetId: 2, from: 600, to: 1560, gaps: [[800, 860]] },
      { programSetId: 3, from: 1560, to: 1860 },
    ]);
  });
});
