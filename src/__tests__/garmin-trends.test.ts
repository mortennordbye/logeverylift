import type { Efforts } from "@/lib/garmin/analytics/efforts";
import { criticalFit, curve, dynamicsTrend, efPoints, thresholdHistory, vo2Series, type TrendActivity } from "@/lib/garmin/analytics/trends";
import { describe, expect, it } from "vitest";

const none: Efforts = { power: {}, speed: {}, distance: {}, vo2: null, hr30: null, dynamics: [] };
let id = 1;
const act = (day: string, sport: TrendActivity["sport"], efforts: Partial<Efforts> = {}, extra: Partial<TrendActivity> = {}): TrendActivity => ({
  id: id++,
  day,
  sport,
  indoor: false,
  durationS: 3600,
  efforts: { ...none, ...efforts },
  decoupling: null,
  watchLthr: null,
  ...extra,
});

/** Bests from an exact CP model: P(t) = CP + W' / t. */
const cpBests = (cp: number, w: number) => Object.fromEntries([180, 300, 720, 1200].map((t) => [t, cp + w / t]));

describe("criticalFit", () => {
  it("recovers CP and W' from bests that follow the model", () => {
    const pts = curve([act("2026-11-01", "bike", { power: cpBests(250, 20000) })], "power", "2026-10-01", "2026-11-11");
    const f = criticalFit(pts)!;
    expect(f.cp).toBeCloseTo(250, 5);
    expect(f.w).toBeCloseTo(20000, 3);
    expect(f.r2).toBeCloseTo(1);
  });

  it("refuses under 3 points or a poor fit", () => {
    expect(criticalFit([{ x: 180, value: 400, id: 1, day: "d" }, { x: 300, value: 350, id: 1, day: "d" }])).toBeNull();
    const noisy = [180, 300, 720, 1200].map((x, i) => ({ x, value: [200, 400, 150, 380][i], id: 1, day: "d" }));
    expect(criticalFit(noisy)).toBeNull();
  });
});

describe("curve", () => {
  it("keeps the best per duration in the window, with its activity", () => {
    const a = act("2026-11-01", "bike", { power: { 60: 400, 1200: 250 } });
    const b = act("2026-11-05", "bike", { power: { 60: 380, 1200: 260 } });
    const old = act("2026-01-01", "bike", { power: { 60: 999 } });
    const c = curve([a, b, old], "power", "2026-10-01", "2026-11-11");
    expect(c).toEqual([
      { x: 60, value: 400, id: a.id, day: "2026-11-01" },
      { x: 1200, value: 260, id: b.id, day: "2026-11-05" },
    ]);
  });
});

describe("thresholdHistory", () => {
  it("gives FTP as 95 % of the best 20 minutes and LTHR from the best hard hr30, over the 90 days before each week", () => {
    const acts = [
      act("2026-08-01", "bike", { power: { 1200: 300 }, hr30: 170 }, { watchMaxHr: 190 }),
      act("2026-11-02", "bike", { power: { 1200: 240 }, hr30: 165 }, { watchMaxHr: 190 }),
      act("2026-11-03", "run", { hr30: 175 }, { watchLthr: 172, watchMaxHr: 190 }),
      // An easy run (under 85 % of max) does not count toward LTHR.
      act("2026-11-04", "run", { hr30: 150 }, { watchMaxHr: 190 }),
    ];
    const h = thresholdHistory(acts, "2026-11-09", "2026-11-11");
    expect(h).toHaveLength(1);
    // The August ride is more than 90 days before the week's end.
    expect(h[0]).toMatchObject({ weekStart: "2026-11-09", ftp: 228, lthrBike: 165, lthrRun: 175, watchLthr: 172, cp: null });
  });
});

describe("vo2Series", () => {
  it("takes the median of the run estimates in the last 42 days", () => {
    const runs = [
      act("2026-09-01", "run", { vo2: { value: 40, samples: 900 } }),
      act("2026-10-20", "run", { vo2: { value: 50, samples: 900 } }),
      act("2026-10-25", "run", { vo2: { value: 54, samples: 900 } }),
      act("2026-11-01", "run", { vo2: { value: 52, samples: 900 } }),
    ];
    const v = vo2Series(runs);
    expect(v.runs).toHaveLength(4);
    expect(v.trend.at(-1)).toEqual({ day: "2026-11-01", value: 52 });
    expect(v.trend[0]).toEqual({ day: "2026-09-01", value: 40 });
  });
});

describe("efPoints and dynamicsTrend", () => {
  it("keeps steady sessions only, and compares run dynamics at the most-run speed", () => {
    const steady = act("2026-11-01", "run", {}, { decoupling: { valid: true, efFirst: 1.5, efSecond: 1.45, pct: 3.3, ef: 1.48, minutes: 60, temperature: 12 } });
    const notSteady = act("2026-11-02", "run", {}, { decoupling: { valid: false, reason: "Intervals", ef: 1.2 } });
    expect(efPoints([steady, notSteady])).toEqual([{ day: "2026-11-01", sport: "run", ef: 1.48, durationS: 3600, decoupling: 3.3, temperature: 12, id: steady.id }]);

    const bin = (speed: number, seconds: number, gct: number) => ({ speed, seconds, cadence: 85, gct, vo: null, stepLength: null });
    const d = dynamicsTrend([
      act("2026-10-01", "run", { dynamics: [bin(3, 900, 250), bin(3.5, 100, 240)] }),
      act("2026-11-01", "run", { dynamics: [bin(3, 800, 245)] }),
    ])!;
    expect(d.speed).toBe(3);
    expect(d.points.map((p) => p.gct)).toEqual([250, 245]);
  });

  it("labels long spans with month and year so labels never repeat", async () => {
    const { timeLabelFormat } = await import("@/lib/garmin/charts/trends");
    expect(timeLabelFormat(["2026-10-01", "2026-11-01"])).toBe("{d} {MMM}");
    expect(timeLabelFormat(["2024-10-01", "2026-11-01"])).toBe("{MMM} {yy}");
  });
});
