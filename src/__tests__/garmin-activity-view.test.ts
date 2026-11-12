import { benefitLabel, lapRows, lapSpans, paceLabel, pointZones, selectionStats, setRows, statTiles, streamPanels, verdict } from "@/lib/garmin/charts/activity";
import type { ActivityMetrics } from "@/lib/garmin/analytics/activity";
import type { ActivityDetail } from "@/lib/garmin/queries";
import { describe, expect, it } from "vitest";

function detail(over: Partial<ActivityDetail> = {}, metrics: Partial<ActivityMetrics> = {}): ActivityDetail {
  return {
    id: 1,
    name: "Run",
    typeKey: "running",
    sport: "run",
    start: 0,
    summary: { duration: 3600 },
    metrics: {
      sport: "run",
      load: 60,
      loadMethod: "trimp",
      thresholds: { maxHr: 200, restHr: 50, lthr: 170, ftp: null, source: "fit" },
      bands: { low: 3000, mid: 600, high: 0 },
      durationS: 3600,
      distanceM: 10000,
      avgHr: 150,
      np: null,
      intensityFactor: null,
      startMs: 0,
      endMs: 3600_000,
      hrPreview: [],
      decoupling: null,
      ...metrics,
    },
    streams: {},
    laps: [],
    sets: [],
    hrZoneFloors: [100, 120, 140, 160, 180],
    matchedSessionId: null,
    fuel: null,
    stamina: null,
    ...over,
  };
}

describe("activity view", () => {
  it("judges a steady session by its decoupling, and says when heat may explain it", () => {
    expect(verdict(detail({}, { decoupling: { valid: true, efFirst: 1, efSecond: 0.97, pct: 3, ef: 1, minutes: 60, temperature: 12 } }))).toBe(
      "Steady aerobic run. Decoupling 3 %: your base holds for 1.0 h.",
    );
    expect(verdict(detail({}, { decoupling: { valid: true, efFirst: 1, efSecond: 0.9, pct: 10, ef: 1, minutes: 60, temperature: 28 } }))).toBe(
      "HR drifted 10 % against output in the second half at 28 °C. Check fuel, heat or pace.",
    );
  });

  it("falls back to the intensity mix without a decoupling number", () => {
    expect(verdict(detail({}, { bands: { low: 3200, mid: 300, high: 100 } }))).toBe("Easy run: 89 % of the time in the low band.");
    expect(verdict(detail({}, { bands: { low: 1000, mid: 1000, high: 1600 } }))).toBe("Hard run: 44 % of the time above threshold.");
  });

  it("pairs each working set with the rest that follows it", () => {
    const sets = setRows(
      detail({
        sets: [
          { setType: "active", repetitions: 8, weight: 80, duration: 35, startTime: "2026-11-05T06:30:00.000Z" },
          { setType: "rest", duration: 120 },
          { setType: "active", repetitions: 6, weight: 85, duration: 30, startTime: "2026-11-05T06:33:00.000Z" },
        ],
      }),
      Date.parse("2026-11-05T06:25:00Z"),
    );
    expect(sets).toEqual([
      { n: 1, reps: 8, weightKg: 80, durationS: 35, restAfterS: 120, startS: 300 },
      { n: 2, reps: 6, weightKg: 85, durationS: 30, restAfterS: null, startS: 480 },
    ]);
  });

  it("reads laps, paces and HR zones per point", () => {
    expect(lapRows(detail({ laps: [{ totalTimerTime: 360, totalDistance: 1000, avgHeartRate: 150, enhancedAvgSpeed: 2.78 }] }))[0]).toMatchObject({ n: 1, durationS: 360, avgHr: 150 });
    expect(paceLabel(1000 / 360)).toBe("6:00");
    expect(pointZones(detail({ streams: { hr: [110, 150, 185, null] } }))).toEqual([0, 2, 4, null]);
  });

  it("shows pace inverted for runs and leaves out streams the file lacks", () => {
    const panels = streamPanels(detail({ streams: { t: [0, 1], hr: [140, 141], speed: [2.78, 2.8], cadence: [0, 0] } }));
    expect(panels.map((p) => p.key)).toEqual(["hr", "pace"]);
    expect(panels[1]).toMatchObject({ invert: true, unit: "min/km" });
  });
});

describe("selectionStats", () => {
  const t = Array.from({ length: 11 }, (_, i) => i * 60);
  const d = detail({
    streams: {
      t,
      hr: t.map((_, i) => (i < 5 ? 120 : 160)),
      distance: t.map((x) => x * 3),
      altitude: [100, 101, 102, 105, 110, 108, 109, 115, 115, 115, 115],
      power: t.map(() => null),
    },
  });

  it("averages the samples inside the range and takes distance from the stream", () => {
    const s = selectionStats(d, 300, 600)!;
    expect(s.durationS).toBe(300);
    expect(s.distanceM).toBe(900);
    expect(s.avgHr).toBe(160);
    expect(s.avgSpeed).toBe(3);
    expect(s.avgPower).toBeNull();
  });

  it("counts climbing with a 3 m deadband", () => {
    // 100 -> 105 (+5), 105 -> 110 (+5), dip to 108 (under 3 m), 110 -> 115 (+5)
    expect(selectionStats(d, 0, 600)!.climbM).toBe(15);
  });

  it("is null for a range with under two samples", () => {
    expect(selectionStats(d, 1000, 2000)).toBeNull();
  });
});

describe("lapSpans", () => {
  it("places each lap in stream seconds from the activity start", () => {
    const start = Date.parse("2026-11-04T06:00:00Z");
    const d = detail({ laps: [{ startTime: "2026-11-04T06:00:00.000Z", totalElapsedTime: 600 }, { startTime: "2026-11-04T06:10:00.000Z", totalElapsedTime: 300 }, {}] });
    expect(lapSpans(d, start)).toEqual([[0, 600], [600, 900], null]);
    expect(lapSpans(d, null)).toEqual([null, null, null]);
  });
});

describe("statTiles: Garmin's own numbers", () => {
  const value = (tiles: { label: string; value: string }[], label: string) => tiles.find((t) => t.label === label)?.value;

  it("shows Garmin load, primary benefit, stamina, body battery and grade-adjusted pace", () => {
    const tiles = statTiles(
      detail({
        summary: { duration: 3600, averageSpeed: 3.2, avgGradeAdjustedSpeed: 3.4, activityTrainingLoad: 61.3, trainingEffectLabel: "LACTATE_THRESHOLD", differenceBodyBattery: -8 },
        stamina: { start: 99, end: 70, min: 64 },
      }),
    );
    expect(value(tiles, "Garmin load")).toBe("61");
    expect(value(tiles, "Primary benefit")).toBe("Lactate threshold");
    expect(value(tiles, "Stamina")).toBe("99 → 70 % · 64 % low");
    expect(value(tiles, "Body battery")).toBe("-8");
    expect(value(tiles, "Grade-adjusted pace")).toBe(`${paceLabel(3.4)} /km`);
  });

  it("leaves out what Garmin did not send, and grade-adjusted pace on a treadmill", () => {
    const tiles = statTiles(detail({ typeKey: "treadmill_running", summary: { duration: 3600, averageSpeed: 3.2, avgGradeAdjustedSpeed: 3.2 } }));
    for (const label of ["Garmin load", "Primary benefit", "Stamina", "Body battery", "Grade-adjusted pace"]) expect(value(tiles, label)).toBeUndefined();
  });

  it("drops the low stamina point when it is the end value", () => {
    expect(value(statTiles(detail({ stamina: { start: 100, end: 74, min: 74 } })), "Stamina")).toBe("100 → 74 %");
  });
});

describe("benefitLabel", () => {
  it("turns Garmin's keys into words", () => {
    expect(benefitLabel("AEROBIC_BASE")).toBe("Aerobic base");
    expect(benefitLabel("VO2MAX")).toBe("VO2 max");
    expect(benefitLabel("NO_BENEFIT")).toBeNull();
    expect(benefitLabel(null)).toBeNull();
  });
});
