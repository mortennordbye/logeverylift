import { describe, expect, it } from "vitest";
import { lapSpans, matchSteps, powerMark, type MatchStep } from "@/lib/utils/step-match";
import { TEMPO_LAPS_5, TEMPO_LAPS_7 } from "./fixtures/bike-sessions";

const MIN = 60;
// Tempo 4.1 at FTP 180: power in W, HR cap or Garmin Z3 in bpm.
const TEMPO_STEPS: MatchStep[] = [
  { key: "s1", type: "warmup", plannedSeconds: 15 * MIN, power: { low: 108, high: 130 }, hr: { low: null, high: 140 } },
  { key: "s2", type: "work", plannedSeconds: 15 * MIN, power: { low: 135, high: 144 }, hr: { low: 141, high: 160 } },
  { key: "s3", type: "recovery", plannedSeconds: 5 * MIN, power: { low: 90, high: 108 }, hr: { low: null, high: 140 } },
  { key: "s4", type: "work", plannedSeconds: 15 * MIN, power: { low: 135, high: 144 }, hr: { low: 141, high: 160 } },
  { key: "s5", type: "cooldown", plannedSeconds: 15 * MIN, power: { low: 108, high: 130 }, hr: { low: null, high: 140 } },
];

describe("powerMark", () => {
  it("allows 5 % on each side, and reads one-sided targets", () => {
    expect(powerMark(140, { low: 135, high: 144 })).toBe("in");
    expect(powerMark(129, { low: 135, high: 144 })).toBe("in");
    expect(powerMark(128, { low: 135, high: 144 })).toBe("under");
    expect(powerMark(152, { low: 135, high: 144 })).toBe("over");
    expect(powerMark(200, { low: null, high: 110 })).toBe("over");
    expect(powerMark(null, { low: 1, high: 2 })).toBeNull();
    expect(powerMark(100, null)).toBeNull();
  });
});

describe("matchSteps", () => {
  it("matches 5 laps to 5 steps by lap", () => {
    const m = matchSteps(TEMPO_STEPS, TEMPO_LAPS_5, null);
    expect(m.by).toBe("laps");
    expect(m.note).toBe("Matched by laps: 5 of 5");
    expect(m.steps.map((s) => s.avgPower)).toEqual([121, 140, 98, 142, 115]);
    expect(m.steps.map((s) => s.power)).toEqual(["in", "in", "in", "in", "in"]);
    expect(m.steps[1]).toMatchObject({ seconds: 899, normalizedPower: 142, avgHeartRate: 152, maxHeartRate: 159, avgCadence: 90, hrOverCap: false });
    // Warm-up HR cap 140, average 128.
    expect(m.steps[0].hrOverCap).toBe(false);
  });

  it("joins the 2 distance laps of 7 into their steps and matches 5 of 5", () => {
    expect(lapSpans(TEMPO_LAPS_7)).toHaveLength(5);
    const m = matchSteps(TEMPO_STEPS, TEMPO_LAPS_7, null);
    expect(m.note).toBe("Matched by laps: 5 of 5");
    // Work 1 = 640 s at 139 W + 259 s at 140 W.
    expect(m.steps[1].seconds).toBe(899);
    expect(m.steps[1].avgPower).toBeCloseTo((640 * 139 + 259 * 140) / 899, 5);
    expect(m.steps[1].maxHeartRate).toBe(159);
    expect(m.steps[3].seconds).toBe(900);
    expect(m.steps.map((s) => s.power)).toEqual(["in", "in", "in", "in", "in"]);
  });

  it("cuts the stream by planned time when only distance laps are left", () => {
    // 3 steps of 1 min; the ride has 1 s samples and three 5 km laps.
    const steps: MatchStep[] = [
      { key: "a", type: "warmup", plannedSeconds: 60, power: { low: 90, high: 110 }, hr: null },
      { key: "b", type: "work", plannedSeconds: 60, power: { low: 190, high: 210 }, hr: { low: 150, high: 160 } },
      { key: "c", type: "cooldown", plannedSeconds: 60, power: { low: 90, high: 110 }, hr: { low: null, high: 120 } },
    ];
    const t = Array.from({ length: 180 }, (_, i) => i);
    const stream = {
      t,
      power: t.map((i) => (i < 60 ? 100 : i < 120 ? 250 : 100)),
      hr: t.map((i) => (i < 60 ? 110 : i < 90 ? 155 : i < 120 ? 165 : 125)),
      cadence: t.map(() => 90),
    };
    const laps = [0, 1, 2].map(() => ({ totalTimerTime: 60, totalDistance: 5000, lapTrigger: "distance" }));
    const m = matchSteps(steps, laps, stream);
    expect(m.by).toBe("time");
    expect(m.note).toBe("Matched by time: 1 lap did not fit 3 steps");
    expect(m.steps.map((s) => s.avgPower)).toEqual([100, 250, 100]);
    expect(m.steps.map((s) => s.power)).toEqual(["in", "over", "in"]);
    expect(m.steps[1].maxHeartRate).toBe(165);
    // Work step: 30 s at 155 bpm inside 150-160.
    expect(m.steps[1].hrZoneSeconds).toBe(30);
    expect(m.steps[0].hrZoneSeconds).toBeNull();
    // Cool-down average 125 is over the 120 cap.
    expect(m.steps[2].hrOverCap).toBe(true);
    expect(m.steps[1].normalizedPower).toBeCloseTo(250, 5);
  });

  it("says how many laps did not fit", () => {
    const laps = Array.from({ length: 7 }, () => ({ totalTimerTime: 60, lapTrigger: "manual" }));
    expect(matchSteps(TEMPO_STEPS, laps, null).note).toBe("Matched by time: 7 laps did not fit 5 steps");
  });
});
