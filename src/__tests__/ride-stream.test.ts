/**
 * A ride against its Garmin activity (docs/plans/bike-ride-logger.md, 4.6 and
 * 4.8), on synthetic 1 s streams: the split by laps or by time with Garmin's
 * timer pauses, the step averages, NP, IF, load, kJ, zones, time on target
 * and heart rate drift.
 */
import { bikeHrZone } from "@/lib/utils/bike-outdoor";
import { rideDoneChart, rideStreamNumbers, splitRide, streamToActive, timerPauses, windowValues, type RideStreams } from "@/lib/utils/ride-stream";
import type { WorkoutStep } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

const T0 = Date.parse("2026-11-17T16:00:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();

/** 1 s samples over [from, to) seconds of stream time, with a value per field from each time. */
function stream(ranges: [number, number][], f: Partial<Record<Exclude<keyof RideStreams, "t">, (t: number) => number | null>>): RideStreams {
  const t: number[] = [];
  for (const [a, b] of ranges) for (let s = a; s < b; s++) t.push(s);
  const out: RideStreams = { t };
  for (const [k, fn] of Object.entries(f) as [Exclude<keyof RideStreams, "t">, (t: number) => number | null][]) out[k] = t.map(fn);
  return out;
}

const step = (type: WorkoutStep["type"], seconds: number): WorkoutStep => ({ type, end: { type: "time", seconds } }) as WorkoutStep;
const planStep = (programSetId: number, type: WorkoutStep["type"], power: { from: number | null; to: number | null } | null, outdoor: { low: number | null; high: number | null } | null = null) => ({
  programSetId,
  step: step(type, 600),
  power,
  outdoor: outdoor ? { ...outdoor, unit: "bpm" as const, text: "", missing: null } : null,
});

describe("splitRide", () => {
  /** The app's ride: step 1 from 0 to 660 s with a pause from 400 to 460 s, step 2 to 960 s, step 3 skipped at once. */
  const ms = (sec: number) => T0 + sec * 1000;
  const steps = [
    { programSetId: 1, activeSeconds: 600, startedAt: ms(0), endedAt: ms(660) },
    { programSetId: 2, activeSeconds: 300, startedAt: ms(660), endedAt: ms(960) },
    { programSetId: 3, activeSeconds: 0, startedAt: ms(960), endedAt: ms(960) },
  ];
  const appPauses: [number, number][] = [[ms(400), ms(460)]];

  it("Garmin's timer pauses from its events", () => {
    const events = [
      { timestamp: iso(0), eventType: "start" },
      { timestamp: iso(400), eventType: "stop_all" },
      { timestamp: iso(460), eventType: "start" },
    ];
    expect(timerPauses(events, T0)).toEqual([[400, 460]]);
  });

  it("by time: each step on the wall clock, less the app's own pauses; the skipped step gets no window", () => {
    const split = splitRide(steps, [], [], T0, appPauses);
    expect(split.method).toBe("time");
    expect(split.windows).toEqual([
      { programSetId: 1, from: 0, to: 660, gaps: [[400, 460]] },
      { programSetId: 2, from: 660, to: 960 },
    ]);
    expect(streamToActive(700, split.pauses)).toBe(640);
  });

  it("by time: a watch started 3 min before the app moves every window by 3 min", () => {
    const split = splitRide(steps, [], [], T0 - 180_000, appPauses);
    expect(split.windows).toEqual([
      { programSetId: 1, from: 180, to: 840, gaps: [[580, 640]] },
      { programSetId: 2, from: 840, to: 1140 },
    ]);
  });

  it("by time: Garmin's own (auto-)pauses shift nothing", () => {
    const events = [
      { timestamp: iso(200), eventType: "stop_all" },
      { timestamp: iso(300), eventType: "start" },
    ];
    expect(splitRide(steps, [], events, T0, appPauses).windows.map((w) => [w.from, w.to])).toEqual([
      [0, 660],
      [660, 960],
    ]);
  });

  it("the step values leave out the samples of the app's pause", () => {
    const s = stream([[0, 660]], { power: (t) => (t >= 400 && t < 460 ? 0 : 200) });
    const [w] = splitRide(steps, [], [], T0, appPauses).windows;
    expect(windowValues(s, w, "indoor").avgPower).toBe(200);
  });

  it("by laps: one lap per ridden step, each within 10% of its step's time", () => {
    const laps = [
      { startTime: iso(20), totalElapsedTime: 640, totalTimerTime: 640 },
      { startTime: iso(660), totalElapsedTime: 290, totalTimerTime: 290 },
    ];
    const split = splitRide(steps, laps, [], T0);
    expect(split.method).toBe("laps");
    expect(split.windows).toEqual([
      { programSetId: 1, from: 20, to: 660 },
      { programSetId: 2, from: 660, to: 950 },
    ]);
  });

  it("falls back to time when a lap is more than 10% off, or the lap count differs", () => {
    const off = [
      { startTime: iso(0), totalElapsedTime: 600, totalTimerTime: 600 },
      { startTime: iso(600), totalElapsedTime: 340, totalTimerTime: 340 },
    ];
    expect(splitRide(steps, off, [], T0).method).toBe("time");
    expect(splitRide(steps, [off[0]], [], T0).method).toBe("time");
  });
});

describe("windowValues", () => {
  it("indoors: time-weighted avg power with zeros, heart rate and cadence without zeros, max HR; no distance", () => {
    const s = stream([[0, 120]], { power: (t) => (t < 60 ? 200 : 0), hr: (t) => (t < 10 ? 0 : 140 + (t % 2)), cadence: (t) => (t < 60 ? 90 : 0) });
    expect(windowValues(s, { from: 0, to: 120 }, "indoor")).toEqual({ avgPower: 100, avgHr: 141, maxHr: 141, avgCadence: 90, avgSpeed: null, distanceMeters: null, climbM: null });
  });

  it("outdoors: distance and speed from the distance stream, climbing with the deadband", () => {
    const s = stream([[0, 100]], { distance: (t) => t * 8, altitude: (t) => 100 + t * 0.5 + (t % 2) });
    const v = windowValues(s, { from: 0, to: 100 }, "outdoor");
    expect(v.distanceMeters).toBe(792);
    expect(v.avgSpeed).toBe(7.92);
    expect(v.climbM).toBeGreaterThanOrEqual(45);
    expect(v.climbM).toBeLessThanOrEqual(50);
  });
});

describe("rideStreamNumbers", () => {
  it("steady 200 W for an hour at FTP 200: NP 200, IF 1, load 100, 720 kJ, all in zone 4", () => {
    const s = stream([[0, 3600]], { power: () => 200 });
    const n = rideStreamNumbers(s, [], [], { ftp: 200, lthr: null, mode: "indoor" });
    expect(n.np).toBeCloseTo(200, 6);
    expect(n.intensityFactor).toBeCloseTo(1, 6);
    expect(n.load).toBeCloseTo(100, 6);
    expect(n.kj).toBe(720);
    expect(n.avgPower).toBe(200);
    expect(n.powerZoneMinutes).toEqual([0, 0, 0, 60, 0, 0, 0]);
  });

  it("NP is above avg power for intervals; load = hours x IF^2 x 100", () => {
    const s = stream([[0, 1800]], { power: (t) => (Math.floor(t / 60) % 2 ? 100 : 300) });
    const n = rideStreamNumbers(s, [], [], { ftp: 250, lthr: null, mode: "indoor" });
    expect(n.avgPower).toBe(200);
    expect(n.np!).toBeGreaterThan(230);
    expect(n.load).toBeCloseTo(0.5 * n.intensityFactor! ** 2 * 100, 6);
  });

  it("zones: Coggan power zones from FTP and Friel heart rate zones from bike LTHR", () => {
    expect([80, 81, 89.9, 90, 93.9, 94, 100].map(bikeHrZone)).toEqual([1, 2, 2, 3, 3, 4, 5]);
    const s = stream([[0, 1200]], { power: (t) => (t < 600 ? 100 : 160), hr: (t) => (t < 600 ? 130 : 160) });
    const n = rideStreamNumbers(s, [], [], { ftp: 200, lthr: 170, mode: "indoor" });
    expect(n.powerZoneMinutes).toEqual([10, 0, 10, 0, 0, 0, 0]);
    expect(n.hrZoneMinutes).toEqual([10, 0, 0, 10, 0]);
  });

  it("time on target: power indoors, heart rate outdoors; a step with no target has none", () => {
    const s = stream([[0, 600]], { power: (t) => (t < 300 ? 155 : 140), hr: (t) => (t < 150 ? 150 : 160) });
    const steps = [planStep(1, "work", { from: 150, to: 160 }, { low: 145, high: 155 }), planStep(2, "work", null)];
    const windows = [
      { programSetId: 1, from: 0, to: 600 },
      { programSetId: 2, from: 0, to: 600 },
    ];
    expect(rideStreamNumbers(s, steps, windows, { ftp: 200, lthr: 170, mode: "indoor" }).onTarget).toEqual({ 1: 50, 2: null });
    expect(rideStreamNumbers(s, steps, windows, { ftp: 200, lthr: 170, mode: "outdoor" }).onTarget).toEqual({ 1: 25, 2: null });
    // An "under" target: inside at or below its cap.
    const under = [planStep(1, "recovery", { from: null, to: 150 })];
    expect(rideStreamNumbers(s, under, [windows[0]], { ftp: 200, lthr: 170, mode: "indoor" }).onTarget).toEqual({ 1: 50 });
  });

  it("drift: warm-up and cool-down left out, two halves by time, avg power / avg HR", () => {
    // 10 min warm-up at 100 W and HR 110, 50 min at 150 W with HR 130 then 140, 10 min cool-down.
    const s = stream([[0, 4200]], {
      power: (t) => (t < 600 || t >= 3600 ? 100 : 150),
      hr: (t) => (t < 600 || t >= 3600 ? 110 : t < 2100 ? 130 : 140),
    });
    const steps = [planStep(1, "warmup", null), planStep(2, "work", null), planStep(3, "cooldown", null)];
    const windows = [
      { programSetId: 1, from: 0, to: 600 },
      { programSetId: 2, from: 600, to: 3600 },
      { programSetId: 3, from: 3600, to: 4200 },
    ];
    const n = rideStreamNumbers(s, steps, windows, { ftp: 200, lthr: 170, mode: "indoor" });
    // (150/130 - 150/140) / (150/130) = 1 - 130/140 = 7.1%
    expect(n.drift).toEqual({ pct: 7.1, steady: false, efFirst: 1.154, efSecond: 1.071 });

    const flat = stream([[0, 3600]], { power: () => 150, hr: () => 135 });
    expect(rideStreamNumbers(flat, [], [{ programSetId: 2, from: 0, to: 3600 }], { ftp: 200, lthr: 170, mode: "indoor" }).drift).toMatchObject({ pct: 0, steady: true });
  });

  it("no drift under 60 min, or without heart rate", () => {
    const short = stream([[0, 3500]], { power: () => 150, hr: () => 135 });
    expect(rideStreamNumbers(short, [], [{ programSetId: 1, from: 0, to: 3500 }], { ftp: 200, lthr: 170, mode: "indoor" }).drift).toBeNull();
    const noHr = stream([[0, 3700]], { power: () => 150 });
    expect(rideStreamNumbers(noHr, [], [{ programSetId: 1, from: 0, to: 3700 }], { ftp: 200, lthr: 170, mode: "indoor" }).drift).toBeNull();
  });

  it("no FTP: NP and kJ, but no IF, load or power zones", () => {
    const n = rideStreamNumbers(stream([[0, 600]], { power: () => 150 }), [], [], { ftp: null, lthr: null, mode: "indoor" });
    expect([Math.round(n.np!), n.intensityFactor, n.load, n.kj]).toEqual([150, null, null, 90]);
    expect(n.powerZoneMinutes.every((m) => m === 0)).toBe(true);
  });
});

describe("rideDoneChart", () => {
  it("a band per ridden step with a power target, a power line and a dashed heart rate line over ridden time", () => {
    const s = stream(
      [
        [0, 400],
        [460, 960],
      ],
      { power: (t) => (t < 660 ? 150 : 90), hr: () => 140 },
    );
    const split = splitRide(
      [
        { programSetId: 1, activeSeconds: 600, startedAt: T0, endedAt: T0 + 660_000 },
        { programSetId: 2, activeSeconds: 300, startedAt: T0 + 660_000, endedAt: T0 + 960_000 },
      ],
      [],
      [],
      T0,
      [[T0 + 400_000, T0 + 460_000]],
    );
    const c = rideDoneChart(s, [planStep(1, "work", { from: 140, to: 160 }), planStep(2, "recovery", { from: null, to: 100 })], split, 200)!;
    expect(c.bands).toHaveLength(2);
    // Step 2 starts at 600 s of 900 s of ridden time.
    expect(c.bands[1].x).toBeCloseTo(24 + (600 / 900) * 222, 0);
    // 30 bins of 30 s: the power drops at the step change, 600 s in, the pause does not show.
    const pts = c.power!.split(" ").map((p) => p.split(",").map(Number));
    expect(pts).toHaveLength(30);
    expect(pts.filter(([x]) => x < 172).every(([, y]) => y === pts[0][1])).toBe(true);
    expect(pts.filter(([x]) => x > 172).every(([, y]) => y > pts[0][1])).toBe(true);
    expect(c.hrLabel?.text).toBe("HR 140");
    expect(c.ftpY).not.toBeNull();
    expect(c.xTicks.at(-1)!.label).toBe("15 min");
  });

  it("null without power or heart rate", () => {
    expect(rideDoneChart(stream([[0, 60]], { cadence: () => 90 }), [], { method: "time", windows: [{ programSetId: 1, from: 0, to: 60 }], pauses: [] }, 200)).toBeNull();
  });
});
