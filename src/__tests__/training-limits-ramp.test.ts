import { computePmc } from "@/lib/garmin/analytics/pmc";
import { DEFAULT_IF } from "@/lib/utils/training-load";
import {
  RAMP_LIMIT,
  RAMP_LIMIT_LOW,
  plannedDayLoads,
  programSteps,
  weeklyLoadRamp,
  weeklyRamps,
  type PlacedSession,
  type RampStart,
} from "@/lib/utils/training-limits";
import { describe, expect, it } from "vitest";

/**
 * The weekly load ramp (docs/plans/limits-strength-readiness.md, 3.1):
 * endurance CTL projected day by day from yesterday with the PMC model, a
 * limit of 8 a week (6 at CTL 45 or less), and the rise rule.
 */

const TODAY = "2026-11-16"; // a Monday
const NEXT = "2026-11-23";

function start(ctl: number, doneToday = 0): RampStart {
  return { today: TODAY, ctlYesterday: ctl, pastCtl: new Map([["2026-11-15", ctl]]), doneToday };
}
let n = 0;
const ride = (date: string, load: number | null, extra: Partial<PlacedSession> = {}): PlacedSession => ({
  ref: `p:${++n}`,
  label: "Ride",
  date,
  position: 1,
  sport: "bike",
  hard: false,
  plannedDurationS: 3600,
  storedPriority: null,
  heavyLegSets: 0,
  strengthSets: 0,
  cycleId: 1,
  plannedLoad: load,
  loadPartial: false,
  ...extra,
});
const week = (from: string, load: number) => Array.from({ length: 7 }, (_, i) => ride(new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), load));

describe("weeklyRamps", () => {
  it("matches the existing PMC model day by day", () => {
    // 60 days at 50 a day, then a week at 110: the same CTL as computePmc gives.
    const loads: Record<string, { bike: number }> = {};
    const dates = Array.from({ length: 67 }, (_, i) => new Date(Date.parse("2026-09-10T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));
    dates.forEach((d, i) => (loads[d] = { bike: i < 60 ? 50 : 110 }));
    const pmc = computePmc(loads, dates[0], dates.at(-1)!);
    const before = pmc[59];
    const s: RampStart = { today: dates[60], ctlYesterday: before.tracks.bike.ctl, pastCtl: new Map([[dates[59], before.tracks.bike.ctl]]), doneToday: 0 };
    const monday = dates[60];
    const r = weeklyRamps({ ...s, today: monday }, week(monday, 110), [monday]).get(monday)!;
    expect(r.ctlEnd).toBeCloseTo(pmc[66].tracks.bike.ctl, 6);
    expect(r.ramp).toBeCloseTo(pmc[66].tracks.bike.ctl - before.tracks.bike.ctl, 6);
  });

  it("uses 8 a week above CTL 45 and 6 at 45 or less", () => {
    expect(weeklyRamps(start(50), [], [TODAY]).get(TODAY)!.limit).toBe(RAMP_LIMIT);
    expect(weeklyRamps(start(45), [], [TODAY]).get(TODAY)!.limit).toBe(RAMP_LIMIT_LOW);
  });

  it("counts today's done load, skips done and past sessions, and counts a session with no estimate as partial and a mixed program by its estimate", () => {
    const { loads, partial } = plannedDayLoads(start(50, 30), [
      ride(TODAY, 40),
      ride(TODAY, 60, { done: true }),
      ride("2026-11-15", 99),
      ride("2026-11-17", null),
      ride("2026-11-18", 20, { loadPartial: true }),
      ride("2026-11-19", 50, { sport: null }),
    ]);
    expect(loads.get(TODAY)).toBe(70);
    expect(loads.has("2026-11-15")).toBe(false);
    expect(loads.has("2026-11-17")).toBe(false);
    expect(partial.get("2026-11-17")).toBe(1);
    expect(partial.get("2026-11-18")).toBe(1);
    // A mixed program (a ride plus core work) has an estimate and no single sport: it counts (review item 4).
    expect(loads.get("2026-11-19")).toBe(50);
    expect(partial.has("2026-11-19")).toBe(false);
  });
});

describe("weeklyLoadRamp", () => {
  it("breaks a week over 8 that the write made steeper, with the numbers", () => {
    const before = weeklyRamps(start(50), week(TODAY, 60), [TODAY]);
    const after = weeklyRamps(start(50), week(TODAY, 110), [TODAY]);
    const hit = weeklyLoadRamp(before, after, TODAY);
    expect(hit?.rule).toBe("weekly_load_ramp");
    expect(hit?.message).toMatch(/^This week would raise fitness \(endurance CTL\) by 9\.\d in 7 days, from 50 to 59\. Limit 8 a week \(6 while fitness is 45 or less\)\. The planned load is an estimate\.$/);
    expect(hit?.numbers).toMatchObject({ week: TODAY, ctlStart: 50, limit: 8, plannedLoad: 770 });
  });

  it("uses the lower limit at CTL 45 or less", () => {
    expect(weeklyLoadRamp(new Map(), weeklyRamps(start(40), week(TODAY, 80), [TODAY]), TODAY)?.numbers).toMatchObject({ limit: 6 });
    expect(weeklyLoadRamp(new Map(), weeklyRamps(start(40), week(TODAY, 78), [TODAY]), TODAY)).toBeNull();
  });

  it("does not block an edit that leaves a steep week as steep or makes it gentler", () => {
    const steep = weeklyRamps(start(50), week(TODAY, 120), [TODAY]);
    expect(weeklyLoadRamp(steep, steep, TODAY)).toBeNull();
    expect(weeklyLoadRamp(steep, weeklyRamps(start(50), week(TODAY, 115), [TODAY]), TODAY)).toBeNull();
  });

  it("names a later week by its Monday, and says how many sessions have no estimate", () => {
    const sessions = [...week(NEXT, 120), ride(NEXT, null)];
    const hit = weeklyLoadRamp(new Map(), weeklyRamps(start(50), sessions, [TODAY, NEXT]), TODAY);
    expect(hit?.message).toContain(`The week of ${NEXT} would raise fitness`);
    expect(hit?.message).toContain("1 session has no time or no power or pace target, so the estimate is rough.");
  });
});

describe("programSteps", () => {
  it("maps zones and roles to step types, and a distance to time by threshold speed", () => {
    const steps = programSteps(
      [
        { discipline: "run", sessionRole: "work", targetHeartRateZone: null, durationSeconds: 300, distanceMeters: null },
        { discipline: "run", sessionRole: null, targetHeartRateZone: 1, durationSeconds: 600, distanceMeters: null },
        { discipline: "run", sessionRole: null, targetHeartRateZone: 2, durationSeconds: null, distanceMeters: 10_000 },
        { discipline: "bike", sessionRole: null, targetHeartRateZone: 5, durationSeconds: null, distanceMeters: 40_000 },
        { discipline: null, sessionRole: null, targetHeartRateZone: null, durationSeconds: 60, distanceMeters: null },
      ],
      { runThresholdSpeed: 4 },
      DEFAULT_IF,
    );
    expect(steps.map((s) => s.type)).toEqual(["work", "recovery", "warmup", "work"]);
    expect(steps[2].seconds).toBeCloseTo(10_000 / (DEFAULT_IF.warmup * 4), 6);
    expect(steps[3].seconds).toBeNull();
  });
});
