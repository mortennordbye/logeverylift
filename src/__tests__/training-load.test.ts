import { computePmc } from "@/lib/garmin/analytics/pmc";
import {
  DEFAULT_IF,
  appPmc,
  dailyLoads,
  loadSource,
  pairWithGarmin,
  plannedLoad,
  runPaceLoad,
  sessionLoad,
  srpeLoad,
  stepIntensity,
  swimCssLoad,
  weightedRpe,
  type AppSessionLoad,
} from "@/lib/utils/training-load";
import { describe, expect, it } from "vitest";

const close = (a: number | null | undefined, b: number) => expect(a).toBeCloseTo(b, 6);

describe("srpeLoad", () => {
  it("is minutes x RPE x 0.22, so one hour at 7.5 is about 100", () => {
    close(srpeLoad(60, 7.5), 99);
    close(srpeLoad(45, 6), 59.4);
  });
  it("needs time and an RPE of 1-10", () => {
    expect(srpeLoad(0, 7)).toBeNull();
    expect(srpeLoad(30, null)).toBeNull();
    expect(srpeLoad(30, 0)).toBeNull();
    expect(srpeLoad(30, 11)).toBeNull();
  });
});

describe("weightedRpe", () => {
  it("weights by duration and skips sets without RPE or time", () => {
    close(weightedRpe([{ durationSeconds: 600, rpe: 4 }, { durationSeconds: 1800, rpe: 8 }, { durationSeconds: 900, rpe: null }, { durationSeconds: null, rpe: 10 }]), 7);
    expect(weightedRpe([{ durationSeconds: 600, rpe: null }])).toBeNull();
  });
});

describe("runPaceLoad", () => {
  const threshold = 1000 / 240; // 4:00 per km
  it("one hour at threshold speed is 100", () => {
    close(runPaceLoad({ seconds: 3600, meters: 15000 }, threshold)?.load, 100);
  });
  it("an easy hour at IF 0.8 is 64", () => {
    const r = runPaceLoad({ seconds: 3600, meters: 12000 }, threshold);
    close(r?.intensityFactor, 0.8);
    close(r?.load, 64);
  });
  it("gives nothing without a threshold, below the floors, on an incline, or with a bad IF", () => {
    expect(runPaceLoad({ seconds: 3600, meters: 12000 }, null)).toBeNull();
    expect(runPaceLoad({ seconds: 299, meters: 1000 }, threshold)).toBeNull();
    expect(runPaceLoad({ seconds: 600, meters: 399 }, threshold)).toBeNull();
    expect(runPaceLoad({ seconds: 3600, meters: 12000, inclinePercent: 3 }, threshold)).toBeNull();
    expect(runPaceLoad({ seconds: 600, meters: 9000 }, threshold)).toBeNull(); // IF 3.6: a typo
  });
});

describe("swimCssLoad", () => {
  const css = 100 / 105; // 1:45 per 100 m
  it("one hour at CSS is 100, and the cube weighs pace", () => {
    close(swimCssLoad({ seconds: 3600, meters: 3600 * css }, css)?.load, 100);
    close(swimCssLoad({ seconds: 3600, meters: 3600 * css * 0.9 }, css)?.load, 72.9);
  });
  it("gives nothing without CSS or below the floors", () => {
    expect(swimCssLoad({ seconds: 3600, meters: 3000 }, undefined)).toBeNull();
    expect(swimCssLoad({ seconds: 100, meters: 200 }, css)).toBeNull();
    expect(swimCssLoad({ seconds: 600, meters: 50 }, css)).toBeNull();
  });
});

describe("sessionLoad", () => {
  const anchors = { runThresholdSpeed: 1000 / 240, swimCss: 100 / 105 };
  it("run: pace first, then sRPE", () => {
    expect(sessionLoad({ sport: "run", seconds: 3600, meters: 12000, rpe: 9 }, anchors)).toMatchObject({ method: "run_pace" });
    expect(sessionLoad({ sport: "run", seconds: 3600, meters: 12000, rpe: 5 }, {})).toEqual({ load: 3600 / 60 * 5 * 0.22, method: "srpe" });
    expect(sessionLoad({ sport: "run", seconds: 3600, meters: 12000, inclinePercent: 5, rpe: 5 }, anchors).method).toBe("srpe");
  });
  it("swim: CSS on moving time when given, then sRPE", () => {
    const withMoving = sessionLoad({ sport: "swim", seconds: 3600, movingSeconds: 3000, meters: 3000, rpe: 6 }, anchors);
    const without = sessionLoad({ sport: "swim", seconds: 3600, meters: 3000, rpe: 6 }, anchors);
    expect(withMoving.method).toBe("swim_css");
    expect(withMoving.load!).toBeGreaterThan(without.load!);
    expect(sessionLoad({ sport: "swim", seconds: 1800, meters: 1500, rpe: 6 }, {}).method).toBe("srpe");
  });
  // Review fix 3: moving time can never be longer than the logged time.
  it("swim: moving time is capped at the logged time", () => {
    const capped = sessionLoad({ sport: "swim", seconds: 1800, movingSeconds: 3600, meters: 1700, rpe: 6 }, anchors);
    const logged = sessionLoad({ sport: "swim", seconds: 1800, meters: 1700, rpe: 6 }, anchors);
    expect(capped).toEqual(logged);
  });

  it("bike: sRPE only", () => {
    expect(sessionLoad({ sport: "bike", seconds: 3600, meters: 30000, rpe: 7 }, { ...anchors, ftp: 250 }).method).toBe("srpe");
  });
  it("no RPE and no anchor gives no load, never a default", () => {
    expect(sessionLoad({ sport: "bike", seconds: 3600 }, anchors)).toEqual({ load: null, method: "none", reason: "needs_rpe" });
    expect(sessionLoad({ sport: "run", seconds: 0, rpe: 5 }, anchors)).toEqual({ load: null, method: "none", reason: "no_time" });
  });
});

describe("plannedLoad", () => {
  const anchors = { ftp: 250, runThresholdSpeed: 1000 / 240, swimCss: 100 / 105 };
  it("power targets use the middle of the range", () => {
    const r = plannedLoad("bike", [{ type: "work", seconds: 3600, target: { metric: "power", anchor: "ftp", low: 95, high: 105 } }], anchors);
    close(r.load, 100);
    expect(r.partial).toBe(false);
  });
  it("power zones and absolute watts", () => {
    close(stepIntensity("bike", { metric: "power", anchor: "ftp", zone: 2 }, anchors), 0.65);
    close(stepIntensity("bike", { metric: "power", anchor: "absolute", low: 200, high: 250 }, anchors), 0.9);
    expect(stepIntensity("bike", { metric: "power", anchor: "ftp", zone: 9 }, anchors)).toBeNull();
    expect(stepIntensity("bike", { metric: "power", anchor: "absolute", low: 200, high: 250 }, {})).toBeNull();
  });
  it("pace targets: percent of threshold speed, CSS offset, and the swim cube", () => {
    close(stepIntensity("run", { metric: "pace", anchor: "threshold_pace", low: 85, high: 95 }, anchors), 0.9);
    const css = anchors.swimCss;
    close(stepIntensity("swim", { metric: "pace", anchor: "css", offsetLow: 0, offsetHigh: 0 }, anchors), 1);
    close(stepIntensity("swim", { metric: "pace", anchor: "css", offsetLow: 2, offsetHigh: 4 }, anchors), 100 / (100 / css + 3) / css);
    close(plannedLoad("swim", [{ type: "work", seconds: 3600, target: { metric: "pace", anchor: "css", low: 90, high: 90 } }], anchors).load, 72.9);
  });
  it("heart-rate targets and no target use the default IF and mark the estimate partial", () => {
    const r = plannedLoad("run", [
      { type: "warmup", seconds: 600 },
      { type: "work", seconds: 1200, target: { metric: "hr", anchor: "lthr", zone: 2 } },
      { type: "rest", seconds: 60 },
    ], anchors);
    close(r.load, (600 / 3600) * DEFAULT_IF.warmup ** 2 * 100 + (1200 / 3600) * DEFAULT_IF.work ** 2 * 100);
    expect(r.partial).toBe(true);
  });
  it("a step with no time adds nothing and marks partial; rest alone is not partial", () => {
    expect(plannedLoad("bike", [{ type: "cooldown", seconds: null }], anchors)).toEqual({ load: 0, partial: true });
    expect(plannedLoad("bike", [{ type: "rest", seconds: 120 }], anchors)).toEqual({ load: 0, partial: false });
  });
});

describe("pairWithGarmin", () => {
  it("pairs one to one by sport and date, closest duration first", () => {
    const app = [
      { id: 1, sport: "run" as const, date: "2027-05-01", durationS: 3600 },
      { id: 2, sport: "run" as const, date: "2027-05-01", durationS: 1800 },
      { id: 3, sport: "bike" as const, date: "2027-05-01", durationS: 3600 },
      { id: 4, sport: "run" as const, date: "2027-05-02", durationS: 3600 },
    ];
    const garmin = [
      { id: 10, sport: "run" as const, date: "2027-05-01", durationS: 1700 },
      { id: 11, sport: "run" as const, date: "2027-05-01", durationS: 3500 },
      { id: 12, sport: "swim" as const, date: "2027-05-01", durationS: 3600 },
    ];
    expect([...pairWithGarmin(app, garmin)].sort()).toEqual([[1, 11], [2, 10]]);
  });

  // Review fix 5: an activity with no duration still pairs by sport and day, after the timed ones.
  it("pairs an activity with no duration by sport and day", () => {
    const app = [{ id: 1, sport: "run" as const, date: "d", durationS: 3000 }];
    expect([...pairWithGarmin(app, [{ id: 9, sport: "run", date: "d", durationS: null }])]).toEqual([[1, 9]]);
    const two = [...app, { id: 2, sport: "run" as const, date: "d", durationS: 600 }];
    expect([...pairWithGarmin(two, [{ id: 9, sport: "run", date: "d", durationS: null }, { id: 8, sport: "run", date: "d", durationS: 610 }])].sort()).toEqual([[1, 9], [2, 8]]);
  });

  it("uses each activity once; the farther session stays unpaired", () => {
    const app = [
      { id: 1, sport: "run" as const, date: "d", durationS: 3000 },
      { id: 2, sport: "run" as const, date: "d", durationS: 3100 },
    ];
    expect([...pairWithGarmin(app, [{ id: 9, sport: "run", date: "d", durationS: 3120 }])]).toEqual([[2, 9]]);
  });
});

describe("series", () => {
  it("picks one source, never both", () => {
    expect(loadSource({ garminAllowed: true, garminDays: 30 })).toBe("garmin");
    expect(loadSource({ garminAllowed: true, garminDays: 0 })).toBe("app");
    expect(loadSource({ garminAllowed: false, garminDays: 30 })).toBe("app");
  });

  const sessions: AppSessionLoad[] = [
    { id: 1, date: "2027-01-01", sport: "run", load: 50, method: "run_pace" },
    { id: 2, date: "2027-01-01", sport: "run", load: 20, method: "srpe" },
    { id: 3, date: "2027-01-01", sport: "strength", load: 40, method: "strength_srpe" },
    { id: 4, date: "2027-01-02", sport: "bike", load: null, method: "none" },
    { id: 5, date: "2027-01-03", sport: "swim", load: 30, method: "swim_css" },
  ];

  it("sums per day and sport and lists sessions with no load", () => {
    const { loads, noLoad } = dailyLoads(sessions);
    expect(loads).toEqual({ "2027-01-01": { run: 70, strength: 40 }, "2027-01-03": { swim: 30 } });
    expect(noLoad.map((s) => s.id)).toEqual([4]);
  });

  it("feeds the existing model and leaves out sessions outside the window", () => {
    const { days, noLoad } = appPmc([...sessions, { id: 6, date: "2026-12-01", sport: "run", load: 999, method: "srpe" }], "2027-01-01", "2027-01-10");
    expect(days).toEqual(computePmc(dailyLoads(sessions).loads, "2027-01-01", "2027-01-10"));
    expect(days[0].tracks.total.load).toBe(110);
    expect(noLoad.map((s) => s.id)).toEqual([4]);
  });
});
