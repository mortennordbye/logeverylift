import { PLAN_MAX_TRAINING_DAYS, PLAN_MIN_TRAINING_DAYS, phaseColumns, triathlonPhases, type PlannedPhase } from "@/lib/utils/triathlon-phases";
import { addDaysStr, seasonTimeline, taperFit } from "@/lib/utils/seasons";
import { describe, expect, it } from "vitest";

/** "Make a triathlon plan": the season's phases from the start date to the A race (docs/plans/plan-tab-redesign.md, P4). */

const half = (raceDate: string) => ({ raceDate, discipline: "triathlon" as const, distance: "half" as const, distanceMeters: null });
const phasesOf = (r: PlannedPhase[] | string) => {
  if (typeof r === "string") throw new Error(r);
  return r;
};

describe("triathlonPhases", () => {
  it("sizes the Jevnaker season: general, base, build, peak and a 10-day taper ending on race day", () => {
    const phases = phasesOf(triathlonPhases("2026-11-16", half("2027-08-29")));
    expect(phases.map((p) => [p.phaseType, p.days, p.start, p.end])).toEqual([
      ["general", 49, "2026-11-16", "2027-01-03"],
      ["base", 105, "2027-01-04", "2027-04-18"],
      ["build", 109, "2027-04-19", "2027-08-05"],
      ["peak", 14, "2027-08-06", "2027-08-19"],
      ["taper", 10, "2027-08-20", "2027-08-29"],
    ]);
    expect(phases.map((p) => p.name)).toEqual([
      "Aerobic base + strength",
      "Longer ride and run",
      "Swim, intervals, bricks",
      "Race pace + open water",
      "Taper",
    ]);
  });

  it("chains the phases with no gap and covers every day from the start to race day", () => {
    for (const [start, race] of [
      ["2026-11-14", "2027-08-29"],
      ["2027-01-01", "2027-03-15"],
      ["2026-12-31", "2028-06-30"],
    ]) {
      const phases = phasesOf(triathlonPhases(start, half(race)));
      expect(phases[0].start).toBe(start);
      expect(phases.at(-1)!.end).toBe(race);
      for (let i = 1; i < phases.length; i++) expect(phases[i].start).toBe(addDaysStr(phases[i - 1].end, 1));
      expect(phases.every((p) => p.days >= 1 && p.days <= 364)).toBe(true);
    }
  });

  it("gives a taper the season's taper fit calls a fit", () => {
    const phases = phasesOf(triathlonPhases("2026-11-16", half("2027-08-29")));
    const timeline = seasonTimeline(
      "2026-11-16",
      phases.map((p, i) => ({
        id: i + 1,
        name: p.name,
        phaseOrder: i + 1,
        phaseType: p.phaseType,
        durationWeeks: p.durationWeeks,
        durationDays: p.durationDays,
        status: "draft" as const,
        startDate: null,
        scheduledStartDate: null,
      })),
    );
    expect(taperFit(timeline, { raceDate: "2027-08-29" })).toEqual({ status: "fits", taperId: 5 });
  });

  it("uses the race's taper length: 14 days for a full, 7 for an olympic", () => {
    const full = phasesOf(triathlonPhases("2027-01-04", { ...half("2027-07-04"), distance: "full" }));
    expect(full.at(-1)).toMatchObject({ phaseType: "taper", days: 14, durationWeeks: 2, durationDays: null });
    const oly = phasesOf(triathlonPhases("2027-01-04", { ...half("2027-07-04"), distance: "olympic" }));
    expect(oly.at(-1)).toMatchObject({ phaseType: "taper", days: 7 });
  });

  it("leaves out a phase with no days and uses a one-week peak in a short build", () => {
    // 10 taper days + 28 training days: 7 peak, 21 before it; general gets no whole week.
    const phases = phasesOf(triathlonPhases("2027-01-01", half(addDaysStr("2027-01-01", 37))));
    expect(phases.map((p) => [p.phaseType, p.days])).toEqual([
      ["base", 7],
      ["build", 14],
      ["peak", 7],
      ["taper", 10],
    ]);
  });

  it("refuses a race too close, too far, or before the start", () => {
    expect(triathlonPhases("2027-01-01", half(addDaysStr("2027-01-01", PLAN_MIN_TRAINING_DAYS + 8)))).toBe(
      "A plan needs at least 6 weeks before the race. Pick an earlier start or a later race.",
    );
    expect(triathlonPhases("2027-01-01", half(addDaysStr("2027-01-01", PLAN_MAX_TRAINING_DAYS + 10)))).toBe(
      "The race is more than two years away. Pick a later start.",
    );
    expect(triathlonPhases("2027-01-01", half("2026-12-01"))).toBe("The race is before the start date.");
  });
});

describe("phaseColumns", () => {
  it("stores whole weeks as weeks and other lengths as days", () => {
    expect(phaseColumns(56)).toEqual({ durationWeeks: 8, durationDays: null });
    expect(phaseColumns(10)).toEqual({ durationWeeks: 2, durationDays: 10 });
  });
});
