import { cycleLengthDays, cycleWeek, weeksForDays } from "@/lib/utils/cycle-position";
import {
  PHASE_RAMP_START,
  PHASE_TRANSITION,
  cycleLoad,
  deloadCadenceForLevel,
  periodizedLoad,
  phaseLoad,
  type AthleteLevel,
  type TrainingGoal,
} from "@/lib/utils/periodization";
import { diffSnapshots, type SeasonSnapshot } from "@/lib/utils/plan-revisions";
import {
  addDaysStr,
  inDaysLabel,
  fitTaperChange,
  nextPhase,
  phasesSkippedBy,
  replanReason,
  seasonARace,
  seasonTimeline,
  taperDaysFor,
  taperFit,
  type PhaseLike,
  type RaceLike,
} from "@/lib/utils/seasons";
import { describe, expect, it } from "vitest";

/** docs/plans/seasons.md, section 5 (unit rows). */

const phase = (id: number, over: Partial<PhaseLike> = {}): PhaseLike => ({
  id,
  name: `P${id}`,
  phaseOrder: id,
  phaseType: null,
  durationWeeks: 4,
  durationDays: null,
  status: "draft",
  startDate: null,
  scheduledStartDate: null,
  ...over,
});

const race = (id: number, over: Partial<RaceLike> = {}): RaceLike => ({
  id,
  name: `R${id}`,
  raceDate: "2027-08-22",
  discipline: "triathlon",
  distance: "half",
  distanceMeters: null,
  priority: "A",
  ...over,
});

describe("cycle length in days (T8)", () => {
  it("uses days when set, else weeks", () => {
    expect(cycleLengthDays({ durationWeeks: 2, durationDays: 10 })).toBe(10);
    expect(cycleLengthDays({ durationWeeks: 2, durationDays: null })).toBe(14);
    expect(weeksForDays(10)).toBe(2);
    expect(weeksForDays(7)).toBe(1);
    expect(weeksForDays(1)).toBe(1);
  });

  it("ends a 10-day phase on day 11, with a short second week", () => {
    const start = new Date(2027, 7, 12);
    const day10 = cycleWeek(start, 2, new Date(2027, 7, 21), 10);
    expect(day10).toMatchObject({ currentWeek: 2, isOver: false });
    const day11 = cycleWeek(start, 2, new Date(2027, 7, 22), 10);
    expect(day11.isOver).toBe(true);
    expect(day11.endDate).toEqual(new Date(2027, 7, 22));
  });

  it("gives the same week, end and over as before with no days", () => {
    const start = new Date(2026, 0, 5);
    for (let d = 0; d < 80; d += 3) {
      const today = new Date(2026, 0, 5 + d);
      expect(cycleWeek(start, 8, today, null)).toEqual(cycleWeek(start, 8, today));
      expect(cycleWeek(start, 8, today, undefined).endDate).toEqual(new Date(2026, 0, 5 + 56));
    }
  });
});

describe("phase curves (owner decision 2)", () => {
  it("a cycle with no phase type runs exactly the old block curve", () => {
    const goals: TrainingGoal[] = ["build", "maintain"];
    const levels: (AthleteLevel | null)[] = [null, "novice", "intermediate", "advanced"];
    for (const goal of goals)
      for (const athleteLevel of levels)
        for (const weeks of [1, 4, 6, 8, 12, 16, 24])
          for (let w = 1; w <= weeks; w++) {
            expect(cycleLoad({ goal, athleteLevel, phaseType: null }, w, weeks)).toEqual(
              periodizedLoad(w, weeks, goal, deloadCadenceForLevel(athleteLevel)),
            );
          }
  });

  it("base ramps from 0.80 to 1.00 with a deload by level, never on the last week", () => {
    expect(phaseLoad("base", 1, 6).multiplier).toBe(PHASE_RAMP_START);
    expect(phaseLoad("base", 6, 6)).toMatchObject({ multiplier: 1, isDeload: false, phase: "base" });
    expect(phaseLoad("build", 4, 6, 4).isDeload).toBe(true);
    expect(phaseLoad("build", 3, 6, 3).isDeload).toBe(true);
    expect(phaseLoad("general", 4, 4, 4).isDeload).toBe(false);
    expect(phaseLoad("general", 1, 4).phase).toBe("general");
  });

  it("peak holds 1.00, taper falls 0.60 to 0.35, transition holds 0.50", () => {
    expect(phaseLoad("peak", 2, 3).multiplier).toBe(1);
    expect(phaseLoad("taper", 1, 2).multiplier).toBe(0.6);
    expect(phaseLoad("taper", 2, 2).multiplier).toBe(0.35);
    expect(phaseLoad("taper", 1, 1).multiplier).toBe(0.35);
    expect(phaseLoad("transition", 1, 2)).toMatchObject({ multiplier: PHASE_TRANSITION, phase: "transition" });
  });
});

describe("taper (2.5)", () => {
  it("defaults by race", () => {
    expect(taperDaysFor(race(1, { distance: "full" }))).toBe(14);
    expect(taperDaysFor(race(1, { distance: "half" }))).toBe(10);
    expect(taperDaysFor(race(1, { distance: "olympic" }))).toBe(7);
    expect(taperDaysFor(race(1, { distance: "sprint" }))).toBe(7);
    expect(taperDaysFor(race(1, { discipline: "run", distance: null, distanceMeters: 42195 }))).toBe(14);
    expect(taperDaysFor(race(1, { discipline: "run", distance: null, distanceMeters: 10000 }))).toBe(7);
    expect(taperDaysFor(race(1, { discipline: "ride", distance: null, distanceMeters: 160000 }))).toBe(7);
  });

  it("plans for the next A race on or after today, else the last one", () => {
    const races = [race(1, { raceDate: "2027-05-01" }), race(2, { raceDate: "2027-08-22" }), race(3, { raceDate: "2027-06-01", priority: "B" })];
    expect(seasonARace(races, "2027-01-01")?.id).toBe(1);
    expect(seasonARace(races, "2027-05-01")?.id).toBe(1);
    expect(seasonARace(races, "2027-05-02")?.id).toBe(2);
    expect(seasonARace(races, "2027-09-01")?.id).toBe(2);
    expect(seasonARace([race(4, { priority: "B" })], "2027-01-01")).toBeNull();
  });

  const timeline = () =>
    seasonTimeline("2027-06-01", [
      phase(1, { durationWeeks: 8 }),
      phase(2, { phaseType: "taper", durationWeeks: 2, durationDays: 10 }),
    ]);

  it("reports whether the taper ends on race day", () => {
    const t = timeline();
    expect(t[1]).toMatchObject({ start: "2027-07-27", end: "2027-08-05", lengthDays: 10 });
    expect(taperFit(t, { raceDate: "2027-08-05" })).toEqual({ status: "fits", taperId: 2 });
    expect(taperFit(t, { raceDate: "2027-08-09" })).toEqual({ status: "early", taperId: 2, days: 4 });
    expect(taperFit(t, { raceDate: "2027-08-03" })).toEqual({ status: "late", taperId: 2, days: 2 });
    expect(taperFit(t, null)).toEqual({ status: "no_race" });
    expect(taperFit(seasonTimeline("2027-06-01", [phase(1)]), { raceDate: "2027-08-05" })).toEqual({ status: "no_taper" });
  });

  it("fit taper changes the length of the phase before it", () => {
    expect(fitTaperChange(timeline(), { raceDate: "2027-08-09" }, "2027-06-01")).toEqual({ cycleId: 1, durationDays: 60 });
    expect(fitTaperChange(timeline(), { raceDate: "2027-08-03" }, "2027-06-01")).toEqual({ cycleId: 1, durationDays: 54 });
    expect(fitTaperChange(timeline(), { raceDate: "2027-08-05" }, "2027-06-01")).toMatch(/already/);
    const ended = seasonTimeline("2027-06-01", [
      phase(1, { status: "completed", startDate: "2027-06-01", durationWeeks: 8 }),
      phase(2, { phaseType: "taper", durationWeeks: 2, durationDays: 10 }),
    ]);
    expect(fitTaperChange(ended, { raceDate: "2027-08-09" }, "2027-07-30")).toMatch(/has ended/);
    const first = seasonTimeline("2027-06-01", [phase(2, { phaseType: "taper", durationDays: 10, durationWeeks: 2 })]);
    expect(fitTaperChange(first, { raceDate: "2027-08-09" }, "2027-06-01")).toMatch(/first phase/);
  });
});

describe("timeline (2.4)", () => {
  it("chains forward from the season start, and real or scheduled starts win", () => {
    const t = seasonTimeline("2027-01-04", [
      phase(2, { phaseOrder: 2, durationWeeks: 3 }),
      phase(1, { phaseOrder: 1, status: "active", startDate: "2027-01-06", durationWeeks: 2 }),
      phase(3, { phaseOrder: 3, durationDays: 5, durationWeeks: 1, scheduledStartDate: "2027-02-10" }),
    ]);
    expect(t.map((p) => [p.id, p.start, p.end, p.state])).toEqual([
      [1, "2027-01-06", "2027-01-19", "active"],
      [2, "2027-01-20", "2027-02-09", "planned"],
      [3, "2027-02-10", "2027-02-14", "planned"],
    ]);
    expect(nextPhase(t)?.id).toBe(2);
  });

  it("the next phase follows the last started one", () => {
    const t = seasonTimeline("2027-01-04", [
      phase(1, { status: "completed", startDate: "2027-01-04" }),
      phase(2),
      phase(3, { status: "active", startDate: "2027-03-01" }),
      phase(4),
    ]);
    expect(nextPhase(t)?.id).toBe(4);
    expect(nextPhase(seasonTimeline("2027-01-04", [phase(1, { status: "completed", startDate: "2027-01-04" })]))).toBeNull();
  });

  it("counts the planned phases a start of a later phase skips", () => {
    const t = seasonTimeline("2027-01-04", [
      phase(1, { status: "completed", startDate: "2027-01-04" }),
      phase(2),
      phase(3),
      phase(4),
    ]);
    expect(phasesSkippedBy(t, 2)).toBe(0);
    expect(phasesSkippedBy(t, 4)).toBe(2);
    expect(phasesSkippedBy(t, 1)).toBe(0);
    expect(phasesSkippedBy(seasonTimeline("2027-01-04", [phase(1, { status: "completed", startDate: "2027-01-04" })]), 1)).toBe(0);
  });

  it("says how far off a day is: today, tomorrow, in N days", () => {
    expect(inDaysLabel("2027-08-22", "2027-08-22")).toBe("today");
    expect(inDaysLabel("2027-08-22", "2027-08-23")).toBe("tomorrow");
    expect(inDaysLabel("2027-08-22", "2027-08-25")).toBe("in 3 days");
  });

  it("adds days by the calendar", () => {
    expect(addDaysStr("2027-03-27", 2)).toBe("2027-03-29");
    expect(addDaysStr("2027-12-31", 1)).toBe("2028-01-01");
  });
});

describe("re-plan trigger (D17)", () => {
  it("flags a date change of any priority", () => {
    expect(replanReason([race(1, { priority: "C" })], [race(1, { priority: "C", raceDate: "2027-08-29" })])).toBe(
      'C race "R1" moved from 2027-08-22 to 2027-08-29',
    );
  });

  it("flags an A race added or removed, and a priority change to or from A", () => {
    expect(replanReason([], [race(1)])).toMatch(/A race "R1" added/);
    expect(replanReason([race(1)], [])).toMatch(/removed/);
    expect(replanReason([race(1)], [race(1, { priority: "B" })])).toMatch(/from A priority to B priority/);
    expect(replanReason([race(1, { priority: "C" })], [race(1, { priority: "A" })])).toMatch(/from C priority to A priority/);
  });

  it("does not flag a rename, a distance change, or a B race added or removed", () => {
    expect(replanReason([race(1)], [race(1, { name: "New", distance: "full" })])).toBeNull();
    expect(replanReason([], [race(2, { priority: "B" })])).toBeNull();
    expect(replanReason([race(2, { priority: "C" })], [])).toBeNull();
    expect(replanReason([race(1, { priority: "B" })], [race(1, { priority: "C" })])).toBeNull();
  });
});

describe("season history text", () => {
  const snap = (over: Partial<SeasonSnapshot> = {}): SeasonSnapshot => ({
    v: 1,
    season: { id: 1, name: "2027", startDate: "2027-01-04", endDate: "2027-09-30", goal: null, nextGoal: null, replanFlaggedAt: null, replanReason: null },
    races: [],
    phases: [],
    ...over,
  });

  it("describes a create, field changes, races, phases and the flag", () => {
    expect(diffSnapshots(null, snap())).toEqual(['Created season "2027"']);
    const after = snap({
      season: { ...snap().season, endDate: "2027-10-15", replanFlaggedAt: "2027-01-10T10:00:00.000Z", replanReason: "moved" },
      races: [{ id: 5, name: "Haugesund", raceDate: "2027-08-22", priority: "A" }],
      phases: [{ cycleId: 9, name: "Base", phaseOrder: 1, phaseType: "base" }],
    });
    expect(diffSnapshots(snap(), after)).toEqual([
      "end 2027-09-30 → 2027-10-15",
      "Flagged for a re-plan: moved",
      'Added A race "Haugesund" on 2027-08-22',
      'Phase "Base" added',
    ]);
    expect(diffSnapshots(after, snap())).toContain("Marked as re-planned");
    expect(diffSnapshots(after, snap())).toContain('Removed race "Haugesund"');
  });
});
