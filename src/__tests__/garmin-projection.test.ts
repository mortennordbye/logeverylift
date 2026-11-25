import { RACE_TSB, projectPmc, projectionCurve, projectionSentence } from "@/lib/garmin/analytics/projection";
import { addDays } from "@/lib/garmin/dates";
import { describe, expect, it } from "vitest";

const cycle = { startDate: "2026-09-07", durationWeeks: 24, goal: "build" as const, athleteLevel: "intermediate" as const };
const raceDay = addDays(cycle.startDate, 24 * 7 - 1);

describe("projectPmc", () => {
  it("holds a steady state flat when the plan is flat", () => {
    const p = projectPmc({ today: "2026-11-11", raceDay: "2026-12-11", ctl: 60, atl: 60, last7: Array(7).fill(60), cycle: { ...cycle, goal: "maintain" }, peakCtl: 60 })!;
    expect(p.dates).toHaveLength(30);
    expect(p.ctl.at(-1)).toBeCloseTo(60);
    expect(p.tsb.at(-1)).toBeCloseTo(0);
    expect(p.race.verdict).toBe("too_tired");
  });

  it("tapers into positive form on race day, inside the band", () => {
    const today = addDays(raceDay, -60);
    const p = projectPmc({ today, raceDay, ctl: 70, atl: 75, last7: Array(7).fill(75), cycle, peakCtl: 70 })!;
    expect(p.raceDay).toBe(raceDay);
    expect(p.race.tsb).toBeGreaterThan(0);
    const i = p.dates.length - 1;
    expect(p.tsbLow[i]).toBeLessThan(p.tsb[i]);
    expect(p.tsbHigh[i]).toBeGreaterThan(p.tsb[i]);
  });

  it("judges race morning against form +10 to +25 and a 10 % fitness drop", () => {
    const today = addDays(raceDay, -14);
    const p = projectPmc({ today, raceDay, ctl: 80, atl: 90, last7: Array(7).fill(30), cycle, peakCtl: 80 })!;
    // A big taper from a low base: fresh, but fitness falls a lot.
    expect(p.race.dropPct).toBeGreaterThan(10);
    expect(p.race.verdict).toBe("fitness_drop");
    expect(projectionSentence(p)).toMatch(/shorten the taper/);
  });

  it("returns null on or after race day, or with no recent load", () => {
    expect(projectPmc({ today: raceDay, raceDay, ctl: 1, atl: 1, last7: [1], cycle, peakCtl: 1 })).toBeNull();
    expect(projectPmc({ today: "2026-11-11", raceDay, ctl: 1, atl: 1, last7: [], cycle, peakCtl: 1 })).toBeNull();
  });

  it("names the target in its sentence", () => {
    expect(RACE_TSB).toEqual([10, 25]);
  });
});

describe("projectPmc across season phases", () => {
  // A 4-week build phase that started two weeks ago, then a 2-week taper.
  const today = "2026-11-25";
  const build = { startDate: addDays(today, -14), durationWeeks: 4, goal: "build" as const, athleteLevel: "intermediate" as const, phaseType: "build" as const };
  const boundary = addDays(build.startDate, 28);
  const taper = { ...build, startDate: boundary, durationWeeks: 2, phaseType: "taper" as const };
  const base = { today, ctl: 70, atl: 75, last7: Array(7).fill(75), cycle: build, peakCtl: 70 };

  it("gives the single-phase result with no later phase, or one that starts after race day", () => {
    const raceDay = addDays(today, 30);
    const single = projectPmc({ ...base, raceDay });
    expect(projectPmc({ ...base, raceDay, later: [] })).toEqual(single);
    expect(projectPmc({ ...base, raceDay, later: [{ ...taper, startDate: addDays(raceDay, 1) }] })).toEqual(single);
  });

  it("switches to the next phase's curve on its first day", () => {
    expect(projectionCurve(build, [taper], addDays(boundary, -1))).toBe(build);
    expect(projectionCurve(build, [taper], boundary)).toBe(taper);
    const raceDay = addDays(boundary, 10);
    const single = projectPmc({ ...base, raceDay })!;
    const phased = projectPmc({ ...base, raceDay, later: [taper] })!;
    const i = phased.dates.indexOf(boundary);
    expect(phased.ctl.slice(0, i)).toEqual(single.ctl.slice(0, i));
    // The taper's load is lower from its first day.
    expect(phased.ctl[i]).toBeLessThan(single.ctl[i]);
  });

  it("judges a race inside a later phase on that phase's curve", () => {
    const raceDay = addDays(boundary, 10);
    const single = projectPmc({ ...base, raceDay })!;
    const phased = projectPmc({ ...base, raceDay, later: [taper] })!;
    expect(phased.raceDay).toBe(raceDay);
    // Without the taper the build's last week holds to race day; with it the athlete arrives fresher.
    expect(phased.race.tsb).toBeGreaterThan(single.race.tsb + 5);
  });
});
