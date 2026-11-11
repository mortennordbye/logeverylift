import {
  normalizedPower,
  overlapShare,
  powerLoad,
  sampleDurations,
  strengthLoad,
  trimpLoad,
  zoneLoad,
  defaultZoneFloors,
} from "@/lib/garmin/analytics/load";
import { computePmc, rampBand } from "@/lib/garmin/analytics/pmc";
import { hrvSeries, restingHrSeries, sleepingLow } from "@/lib/garmin/analytics/recovery";
import { clockSpreadMinutes, regularityIndex, sleepDebt, sleepTiming, type SleepNight } from "@/lib/garmin/analytics/sleep";
import { isIndoor, sportOf } from "@/lib/garmin/analytics/sport";
import { thresholdsFor } from "@/lib/garmin/analytics/thresholds";
import { bandsFromStream, bandsFromZones, distributionLabel, polarizationIndex } from "@/lib/garmin/analytics/zones";
import { addDays } from "@/lib/garmin/dates";
import { describe, expect, it } from "vitest";

const seconds = (n: number, step = 1) => Array.from({ length: n }, (_, i) => i * step);
const th = { maxHr: 200, restHr: 50, lthr: 170 };

describe("sportOf", () => {
  it("maps Garmin type keys to five sports", () => {
    expect(sportOf("lap_swimming")).toBe("swim");
    expect(sportOf("open_water_swimming")).toBe("swim");
    expect(sportOf("indoor_cycling")).toBe("bike");
    expect(sportOf("road_biking")).toBe("bike");
    expect(sportOf("treadmill_running")).toBe("run");
    expect(sportOf("trail_running")).toBe("run");
    expect(sportOf("strength_training")).toBe("strength");
    expect(sportOf("bouldering")).toBe("other");
    expect(isIndoor("treadmill_running")).toBe(true);
    expect(isIndoor("running")).toBe(false);
  });
});

describe("thresholdsFor", () => {
  it("prefers the activity's own FIT session zones, then the snapshot", () => {
    const fit = [{ referenceMesg: "lap", thresholdHeartRate: 1 }, { referenceMesg: "session", thresholdHeartRate: 180, maxHeartRate: 208, restingHeartRate: 44, functionalThresholdPower: 250 }];
    expect(thresholdsFor({ timeInZone: fit, snapshot: null, isBike: true })).toEqual({ maxHr: 208, restHr: 44, lthr: 180, ftp: 250, source: "fit" });
    const snapshot = [
      { sport: "DEFAULT", maxHeartRateUsed: 200, restingHeartRateUsed: 45, lactateThresholdHeartRateUsed: 175 },
      { sport: "CYCLING", maxHeartRateUsed: 195, restingHeartRateUsed: 45, lactateThresholdHeartRateUsed: 170 },
    ];
    expect(thresholdsFor({ timeInZone: [], snapshot, isBike: true })).toMatchObject({ maxHr: 195, lthr: 170, source: "snapshot" });
    expect(thresholdsFor({ timeInZone: [], snapshot, isBike: false })).toMatchObject({ maxHr: 200, lthr: 175 });
    expect(thresholdsFor({ timeInZone: null, snapshot: null, isBike: false }).source).toBe("none");
  });
});

describe("load", () => {
  it("treats a gap longer than 10 s as a pause", () => {
    expect(sampleDurations([0, 1, 2, 300, 301])).toEqual([1, 1, 0, 1, 1]);
  });

  it("gives NP equal to a constant power, and above the mean for on-off efforts", () => {
    const t = seconds(600);
    expect(normalizedPower(t, t.map(() => 200))).toBeCloseTo(200, 6);
    const onOff = t.map((s) => (Math.floor(s / 60) % 2 === 0 ? 300 : 100));
    expect(normalizedPower(t, onOff)!).toBeGreaterThan(200);
    expect(normalizedPower(seconds(20), seconds(20).map(() => 200))).toBeNull();
  });

  it("scores one hour at FTP as 100", () => {
    const t = seconds(3600);
    expect(powerLoad(t, t.map(() => 250), 250)!.load).toBeCloseTo(100, 0);
  });

  it("scores one hour at LTHR as 100 by TRIMP, and less for easier work", () => {
    const t = seconds(3600);
    expect(trimpLoad(t, t.map(() => 170), th)).toBeCloseTo(100, 0);
    expect(trimpLoad(t, t.map(() => 130), th)!).toBeLessThan(60);
    expect(trimpLoad(seconds(30), seconds(30).map(() => 170), th)).toBeNull();
    expect(trimpLoad(t, t.map(() => 170), { maxHr: 150, restHr: 50, lthr: 170 })).toBeNull();
  });

  it("estimates load from seconds in zones when there is no stream", () => {
    const floors = defaultZoneFloors(200);
    expect(floors).toEqual([100, 120, 140, 160, 180]);
    const load = zoneLoad([0, 0, 0, 3600, 0], floors, th)!;
    // An hour at the zone 4 midpoint (170 bpm) is an hour at LTHR.
    expect(load).toBeCloseTo(100, 0);
  });

  it("scores strength by session RPE, from sets, then feeling, then 6", () => {
    expect(strengthLoad(60, [7, 8, null], null)).toEqual({ load: 60 * 7.5 * 0.22, rpe: 7.5 });
    expect(strengthLoad(60, [], "Tired")!.rpe).toBe(8);
    expect(strengthLoad(60, [], null)!.rpe).toBe(6);
    expect(strengthLoad(0, [7], null)).toBeNull();
  });

  it("measures overlap as a share of the shorter session", () => {
    expect(overlapShare([0, 100], [50, 150])).toBe(0.5);
    expect(overlapShare([0, 100], [20, 60])).toBe(1);
    expect(overlapShare([0, 100], [100, 200])).toBe(0);
  });
});

describe("computePmc", () => {
  const range = (n: number) => Array.from({ length: n }, (_, i) => addDays("2026-01-01", i));

  it("converges to fitness = load and form 0 under a constant load", () => {
    const days = range(300);
    const loads = Object.fromEntries(days.map((d) => [d, { run: 100 }]));
    const pmc = computePmc(loads, days[0], days.at(-1)!);
    const last = pmc.at(-1)!;
    expect(last.tracks.total.ctl).toBeCloseTo(100, 3);
    expect(last.tracks.total.tsb).toBeCloseTo(0, 3);
    expect(last.tracks.run.ctl).toBeCloseTo(100, 3);
    expect(last.tracks.bike.ctl).toBe(0);
  });

  it("drops form after a hard block and lets fatigue fall faster than fitness in rest", () => {
    const days = range(70);
    const loads = Object.fromEntries(days.slice(42, 56).map((d) => [d, { bike: 150 }]));
    const pmc = computePmc(loads, days[0], days.at(-1)!);
    const endOfBlock = pmc[56];
    expect(endOfBlock.tracks.total.tsb).toBeLessThan(-40);
    const afterRest = pmc.at(-1)!;
    expect(afterRest.tracks.total.tsb).toBeGreaterThan(0);
    expect(afterRest.tracks.total.atl).toBeLessThan(afterRest.tracks.total.ctl);
  });

  it("counts strength in total fitness and keeps its own track", () => {
    const days = range(10);
    const pmc = computePmc({ [days[5]]: { strength: 70, run: 30 } }, days[0], days.at(-1)!);
    expect(pmc[5].tracks.total.load).toBe(100);
    expect(pmc[5].tracks.strength.load).toBe(70);
  });

  it("marks the first 42 days calibrating and gives ramp and monotony once there is a week", () => {
    const days = range(50);
    const pmc = computePmc(Object.fromEntries(days.map((d, i) => [d, { run: i % 2 ? 50 : 100 }])), days[0], days.at(-1)!);
    expect(pmc[41].calibrating).toBe(true);
    expect(pmc[42].calibrating).toBe(false);
    expect(pmc[6].ramp).toBeNull();
    expect(pmc[7].ramp).not.toBeNull();
    expect(pmc[10].monotony).toBeGreaterThan(2);
    expect(rampBand(4)).toBe("normal");
    expect(rampBand(6)).toBe("fast");
    expect(rampBand(9)).toBe("warning");
  });
});

describe("hrvSeries", () => {
  const nights = (values: (number | null)[], garmin?: [number, number]) =>
    values.map((ms, i) => ({ date: addDays("2026-01-01", i), ms, garminLow: garmin?.[0], garminHigh: garmin?.[1] }));

  it("uses Garmin's band until there are 30 nights, then its own", () => {
    const early = hrvSeries(nights(Array(10).fill(60), [55, 70]));
    expect(early.at(-1)).toMatchObject({ bandLow: 55, bandHigh: 70, bandSource: "garmin", state: "balanced" });
    const later = hrvSeries(nights(Array.from({ length: 40 }, (_, i) => 60 + (i % 5)), [10, 20]));
    expect(later.at(-1)!.bandSource).toBe("ours");
    expect(later.at(-1)!.bandLow!).toBeGreaterThan(55);
  });

  it("needs 4 of 7 nights for the weekly mean", () => {
    const s = hrvSeries(nights([60, null, null, null, 61, 62, null], [50, 70]));
    expect(s.at(-1)!.mean7).toBeNull();
    expect(s.at(-1)!.state).toBe("calibrating");
  });

  it("flags a week below the band", () => {
    const s = hrvSeries(nights([...Array(10).fill(60), ...Array(7).fill(40)], [55, 70]));
    expect(["fatigued", "strained"]).toContain(s.at(-1)!.state);
  });
});

describe("restingHrSeries and sleepingLow", () => {
  it("flags a 7-day mean 5 bpm over baseline", () => {
    const days = [...Array(30).fill(45), ...Array(7).fill(51)].map((bpm, i) => ({ date: addDays("2026-01-01", i), bpm }));
    expect(restingHrSeries(days).at(-1)!.flag).toBe(true);
    expect(restingHrSeries(days.slice(0, 30)).at(-1)!.flag).toBe(false);
    // A 1 bpm drift on a flat baseline is not a flag.
    const drift = [...Array(30).fill(45), ...Array(7).fill(46)].map((bpm, i) => ({ date: addDays("2026-01-01", i), bpm }));
    expect(restingHrSeries(drift).at(-1)!.flag).toBe(false);
  });

  it("finds the lowest 30-minute HR of the night and when it fell", () => {
    const start = 0;
    const end = 8 * 3600_000;
    const values: [number, number][] = [];
    for (let ts = start; ts <= end; ts += 120_000) values.push([ts, ts > 6 * 3600_000 && ts < 7 * 3600_000 ? 42 : 55]);
    const low = sleepingLow(values, start, end)!;
    expect(low.bpm).toBeCloseTo(42, 0);
    expect(low.fractionOfNight).toBeGreaterThan(0.75);
    expect(sleepingLow(values.slice(0, 50), start, end)).toBeNull();
  });
});

describe("zones", () => {
  it("splits an HR stream into three bands around LTHR", () => {
    const t = seconds(100);
    const hr = t.map((s) => (s < 50 ? 140 : s < 80 ? 160 : 180));
    expect(bandsFromStream(t, hr, 170)).toEqual({ low: 50, mid: 30, high: 20 });
  });

  it("folds Garmin's five zones into three bands", () => {
    expect(bandsFromZones([100, 200, 30, 20, 10])).toEqual({ low: 300, mid: 50, high: 10 });
  });

  it("labels polarized, pyramidal and threshold weeks", () => {
    expect(polarizationIndex({ low: 80, mid: 5, high: 15 })!).toBeGreaterThan(2);
    expect(distributionLabel({ low: 80, mid: 5, high: 15 })).toBe("polarized");
    expect(distributionLabel({ low: 75, mid: 20, high: 5 })).toBe("pyramidal");
    expect(distributionLabel({ low: 30, mid: 60, high: 10 })).toBe("threshold");
    expect(distributionLabel({ low: 90, mid: 10, high: 0 })).toBe("no_high");
    expect(polarizationIndex({ low: 90, mid: 10, high: 0 })).toBeNull();
  });
});

describe("sleep", () => {
  const night = (i: number, onsetMin: number, hours: number, need = 8): SleepNight => {
    const date = addDays("2026-01-05", i);
    const start = Date.parse(`${addDays(date, -1)}T00:00:00Z`) + onsetMin * 60_000;
    return { date, start, end: start + hours * 3600_000, sleepSeconds: hours * 3600, needSeconds: need * 3600, napSeconds: 0 };
  };

  it("scores identical windows 100 and shifting ones lower", () => {
    const same = Array.from({ length: 14 }, (_, i) => night(i, 23 * 60, 8));
    expect(regularityIndex(same)).toBeCloseTo(100, 0);
    const shifting = Array.from({ length: 14 }, (_, i) => night(i, 21 * 60 + (i % 2) * 240, 8));
    expect(regularityIndex(shifting)!).toBeLessThan(60);
    expect(regularityIndex(same.slice(0, 5))).toBeNull();
  });

  it("builds debt from short nights and repays at most an hour per long night", () => {
    const short = Array.from({ length: 14 }, (_, i) => night(i, 23 * 60, 7));
    expect(sleepDebt(short)!).toBeGreaterThan(3600 * 4);
    const enough = Array.from({ length: 14 }, (_, i) => night(i, 23 * 60, 8));
    expect(sleepDebt(enough)).toBe(0);
    const oneHuge = [...short.slice(0, 13), night(13, 21 * 60, 14)];
    // The last night goes from 1 h short to 6 h over: its 1 h debt is gone and it repays 1 h at most.
    expect(sleepDebt(oneHuge)!).toBeCloseTo(sleepDebt(short)! - 7200, 0);
  });

  it("measures timing spread on a circle, across midnight", () => {
    // 23:30 and 00:30 are an hour apart, not 23 hours.
    const ts = [Date.parse("2026-01-01T23:30:00Z"), Date.parse("2026-01-03T00:30:00Z"), Date.parse("2026-01-03T23:30:00Z"), Date.parse("2026-01-05T00:30:00Z")];
    expect(clockSpreadMinutes(ts)!).toBeLessThan(40);
    const nights = Array.from({ length: 14 }, (_, i) => night(i, 23 * 60, 8));
    expect(sleepTiming(nights).onsetSpread!).toBeLessThan(1);
    expect(sleepTiming(nights).socialJetlag!).toBeLessThan(1);
  });
});

import { computeActivityMetrics } from "@/lib/garmin/analytics/activity";
import { buildDailyMetrics, matchStrength, type ActivityInput } from "@/lib/garmin/analytics/daily";

describe("computeActivityMetrics", () => {
  const fitZones = [{ referenceMesg: "session", thresholdHeartRate: 170, maxHeartRate: 200, restingHeartRate: 50, hrZoneHighBoundary: [100, 120, 140, 160, 180, 200] }];
  const t = seconds(3600);

  it("uses power on a ride with FTP, then HR stream, then zones, then Garmin's TSS", () => {
    const ride = computeActivityMetrics({
      typeKey: "road_biking",
      summary: { startTimeGMT: "2026-11-01 07:00:00", duration: 3600 },
      streams: { t, hr: t.map(() => 150), power: t.map(() => 200) },
      timeInZone: [{ ...fitZones[0], functionalThresholdPower: 200 }],
      hrZonesSnapshot: null,
      female: false,
    });
    expect(ride).toMatchObject({ sport: "bike", loadMethod: "power", load: 100 });
    expect(ride.startMs).toBe(Date.parse("2026-11-01T07:00:00Z"));
    expect(ride.endMs).toBe(ride.startMs! + 3600_000);

    // Garmin's FTP on a run is running power: not used, HR stream instead.
    const run = computeActivityMetrics({
      typeKey: "running",
      summary: { duration: 3600 },
      streams: { t, hr: t.map(() => 170), power: t.map(() => 400) },
      timeInZone: [{ ...fitZones[0], functionalThresholdPower: 400 }],
      hrZonesSnapshot: null,
      female: false,
    });
    expect(run).toMatchObject({ sport: "run", loadMethod: "trimp", load: 100 });
    expect(run.bands).toEqual({ low: 0, mid: 3600, high: 0 });

    const noStream = computeActivityMetrics({
      typeKey: "treadmill_running",
      summary: { duration: 3600, hrTimeInZone_4: 3600 },
      streams: null,
      timeInZone: fitZones,
      hrZonesSnapshot: null,
      female: false,
    });
    expect(noStream.loadMethod).toBe("zones");
    expect(noStream.load!).toBeCloseTo(100, -1);

    const nothing = computeActivityMetrics({ typeKey: "yoga", summary: { trainingStressScore: 42 }, streams: null, timeInZone: null, hrZonesSnapshot: null, female: false });
    expect(nothing).toMatchObject({ sport: "other", loadMethod: "garmin_tss", load: 42 });
  });
});

describe("buildDailyMetrics", () => {
  const strengthActivity: ActivityInput = {
    garminActivityId: 1,
    day: "2026-11-02",
    sport: "strength",
    load: 30,
    loadMethod: "trimp",
    startMs: Date.parse("2026-11-02T16:00:00Z"),
    endMs: Date.parse("2026-11-02T17:00:00Z"),
    bands: { low: 3000, mid: 600, high: 0 },
  };
  const session = {
    sessionId: 9,
    day: "2026-11-02",
    startMs: Date.parse("2026-11-02T16:05:00Z"),
    endMs: Date.parse("2026-11-02T17:02:00Z"),
    setRpes: [8, 8],
    feeling: null,
  };
  const days = [{ date: "2026-11-02", hrvMs: 70, garminHrvLow: 60, garminHrvHigh: 80, restingHr: 45, sleep: null }];

  it("matches a Garmin strength activity to the LogEveryLift session it overlaps", () => {
    expect(matchStrength([strengthActivity], [session]).get(1)?.sessionId).toBe(9);
    expect(matchStrength([strengthActivity], [{ ...session, startMs: Date.parse("2026-11-02T18:00:00Z"), endMs: Date.parse("2026-11-02T19:00:00Z") }]).size).toBe(0);
  });

  it("counts a matched session once, with Garmin's duration and LogEveryLift's RPE", () => {
    const [day] = buildDailyMetrics({ start: "2026-11-02", end: "2026-11-02", activities: [strengthActivity], strengthSessions: [session], days });
    expect(day.entries).toEqual([{ source: "garmin", id: 1, sport: "strength", load: 60 * 8 * 0.22, method: "srpe", matchedSessionId: 9 }]);
    expect(day.pmc.strength.load).toBeCloseTo(105.6, 1);
    expect(day.bands).toEqual({ low: 3000, mid: 600, high: 0 });
  });

  it("counts an unmatched LogEveryLift session on its own, and keeps Garmin-only activities", () => {
    const run: ActivityInput = { ...strengthActivity, garminActivityId: 2, sport: "run", load: 50, startMs: Date.parse("2026-11-02T06:00:00Z"), endMs: Date.parse("2026-11-02T07:00:00Z") };
    const [day] = buildDailyMetrics({ start: "2026-11-02", end: "2026-11-02", activities: [run], strengthSessions: [session], days });
    expect(day.entries.map((e) => [e.source, e.sport])).toEqual([
      ["garmin", "run"],
      ["logeverylift", "strength"],
    ]);
    expect(day.pmc.total.load).toBeCloseTo(50 + 57 * 8 * 0.22, 1);
  });
});
