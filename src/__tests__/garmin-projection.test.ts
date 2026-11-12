import { RACE_TSB, projectPmc, projectionSentence } from "@/lib/garmin/analytics/projection";
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
