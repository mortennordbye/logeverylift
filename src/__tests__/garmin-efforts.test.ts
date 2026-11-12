import { bestMeans, bestTimes, computeEfforts, dynamicsBins, hr30, perSecond, summaryEfforts, vo2FromRun } from "@/lib/garmin/analytics/efforts";
import { describe, expect, it } from "vitest";

const range = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));

describe("perSecond", () => {
  it("holds short gaps and zeroes long ones", () => {
    expect(perSecond([0, 2, 10], [100, 200, 300])).toEqual([100, 100, 200, 200, 200, 200, 200, 200, 0, 0, 300]);
  });
});

describe("bestMeans", () => {
  it("finds the best mean for each duration that fits", () => {
    const grid = [...range(60, () => 100), ...range(30, () => 400), ...range(60, () => 100)];
    const b = bestMeans(grid, [30, 60, 300]);
    expect(b[30]).toBe(400);
    expect(b[60]).toBe(250);
    expect(b[300]).toBeUndefined();
  });
});

describe("bestTimes", () => {
  it("finds the fastest stretch covering each distance", () => {
    // 3 m/s for 10 minutes, then 5 m/s for 5 minutes.
    const t = range(901, (i) => i);
    const d = t.map((s) => (s <= 600 ? s * 3 : 1800 + (s - 600) * 5));
    const b = bestTimes(t, d, [1000, 3000, 5000]);
    expect(b[1000]).toBe(200);
    // The last 300 s give 1500 m at 5 m/s; the other 1500 m take 500 s at 3 m/s.
    expect(b[3000]).toBe(800);
    expect(b[5000]).toBeUndefined();
  });
});

describe("vo2FromRun", () => {
  it("recovers a known VO2 max on flat ground", () => {
    // 3 m/s = 180 m/min, VO2 = 3.5 + 36 = 39.5. At 60 % HRR that gives VO2max = 3.5 + 36 / 0.6 = 63.5.
    const n = 1800;
    const restHr = 50;
    const maxHr = 190;
    const hr = 50 + 0.6 * 140;
    const est = vo2FromRun({ t: range(n, (i) => i), hr: range(n, () => hr), speed: range(n, () => 3), altitude: range(n, () => 100), restHr, maxHr })!;
    expect(est.value).toBeCloseTo(63.5, 1);
    expect(est.samples).toBe(n - 600);
  });

  it("uses only 10 to 70 minutes into the run, so late cardiac drift does not pull it down", () => {
    const n = 7200;
    // Heart rate drifts up after 70 minutes at the same pace.
    const hr = range(n, (i) => (i < 4200 ? 134 : 160));
    const est = vo2FromRun({ t: range(n, (i) => i), hr, speed: range(n, () => 3), restHr: 50, maxHr: 190 })!;
    expect(est.value).toBeCloseTo(63.5, 1);
    expect(est.samples).toBe(3600);
  });

  it("returns null when too few seconds qualify", () => {
    expect(vo2FromRun({ t: range(1700, (i) => i), hr: range(1700, () => 150), speed: range(1700, () => 3), restHr: 50, maxHr: 190 })).toBeNull();
    expect(vo2FromRun({ t: range(1800, (i) => i), hr: range(1800, () => 70), speed: range(1800, () => 3), restHr: 50, maxHr: 190 })).toBeNull();
  });
});

describe("hr30", () => {
  it("averages the last 20 minutes of the hardest 30", () => {
    const hr = [...range(1200, () => 120), ...range(600, () => 150), ...range(1200, () => 170), ...range(600, () => 110)];
    expect(hr30(range(hr.length, (i) => i), hr)).toBe(170);
    expect(hr30(range(100, (i) => i), range(100, () => 150))).toBeNull();
  });
});

describe("dynamicsBins", () => {
  it("averages each 0.25 m/s bin with 2 minutes or more", () => {
    const n = 300;
    const speed = range(n, (i) => (i < 200 ? 3.1 : 3.6));
    const b = dynamicsBins({ t: range(n, (i) => i), speed, cadence: range(n, () => 85), gct: range(n, (i) => (i < 200 ? 250 : 230)) });
    expect(b).toEqual([{ speed: 3, seconds: 200, cadence: 85, gct: 250, vo: null, stepLength: null }]);
  });
});

describe("computeEfforts", () => {
  it("falls back to Garmin's summary bests when there is no stream, and leaves treadmill pace out", () => {
    const summary = { maxAvgPower_1200: 250, maxAvgPower_5: 700, fastestSplit_1000: 240 };
    const bike = computeEfforts({ sport: "bike", indoor: true, summary, streams: null, restHr: null, maxHr: null });
    expect(bike.power).toEqual({ 5: 700, 1200: 250 });
    expect(bike.distance).toEqual({});
    expect(computeEfforts({ sport: "run", indoor: false, summary, streams: null, restHr: null, maxHr: null }).distance).toEqual({ 1000: 240 });
    expect(computeEfforts({ sport: "run", indoor: true, summary, streams: null, restHr: null, maxHr: null }).distance).toEqual({});
    expect(summaryEfforts({}).power).toEqual({});
  });
});
