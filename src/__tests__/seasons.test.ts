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
  addPhaseWarning,
  fitTaperChange,
  lengthShort,
  rangeLabel,
  runLength,
  runLengthDays,
  nextPhase,
  phasesSkippedBy,
  replanFlag,
  replanTitle,
  replanReason,
  replanWithoutRace,
  seasonARace,
  seasonEndAfterRace,
  seasonTimeline,
  taperDaysFor,
  taperFit,
  type PhaseLike,
  type RaceLike,
} from "@/lib/utils/seasons";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A label shows the year of a date outside the current one (round 11 I2):
// the clock stays in the year of the dates these tests use.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T12:00:00Z"));
});
afterAll(() => vi.useRealTimers());

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
    expect(fitTaperChange(ended, { raceDate: "2027-08-09" }, "2027-07-30")).toMatch(/^“.+” has ended/);
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

  it("ends the running phase the day before another block's scheduled start (J4-18)", () => {
    const phases = [phase(1, { status: "active", startDate: "2026-11-09", durationWeeks: 7 }), phase(2, { durationWeeks: 4 })];
    // Another season's first phase starts 16 Nov: that start completes phase 1 (startDueScheduledCycle).
    const t = seasonTimeline("2026-11-09", phases, "2026-11-16");
    expect(t.map((p) => [p.id, p.start, p.end, p.lengthDays])).toEqual([
      [1, "2026-11-09", "2026-11-15", 7],
      [2, "2026-11-16", "2026-12-13", 28],
    ]);
    // A start the day after the phase ends, or none, changes nothing.
    expect(seasonTimeline("2026-11-09", phases, "2026-12-28")[0].end).toBe("2026-12-27");
    expect(seasonTimeline("2026-11-09", phases, null)[0].end).toBe("2026-12-27");
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

  it("adds days by the calendar", () => {
    expect(addDaysStr("2027-03-27", 2)).toBe("2027-03-29");
    expect(addDaysStr("2027-12-31", 1)).toBe("2028-01-01");
  });
});

describe("a phase added after race day (J4-09)", () => {
  it("warns when the phase starts after race day or runs past the season end", () => {
    expect(addPhaseWarning({ startsOn: "2027-08-30", lengthDays: 28, raceDate: "2027-08-29", seasonEnd: "2027-08-29" })).toBe(
      "This phase starts after race day on 29 Aug 2027.",
    );
    expect(addPhaseWarning({ startsOn: "2027-08-10", lengthDays: 28, raceDate: null, seasonEnd: "2027-08-29" })).toBe(
      "This phase runs 8 days past the season end on 29 Aug 2027.",
    );
    expect(addPhaseWarning({ startsOn: "2027-08-02", lengthDays: 28, raceDate: "2027-08-29", seasonEnd: "2027-08-29" })).toBeNull();
    // An existing cycle that keeps its own length is checked by its start only.
    expect(addPhaseWarning({ startsOn: "2027-08-02", lengthDays: null, raceDate: "2027-08-29", seasonEnd: "2027-08-29" })).toBeNull();
  });
});

describe("re-plan trigger (D17)", () => {
  it("flags a date change of any priority", () => {
    expect(replanReason([race(1, { priority: "C" })], [race(1, { priority: "C", raceDate: "2027-08-29" })])).toBe(
      'The C race "R1" moved from 22 Aug 2027 to 29 Aug 2027',
    );
  });

  it("flags an A race added or removed, and a priority change to or from A", () => {
    // "The A race", so the priority does not read as the article (J4-11).
    expect(replanReason([], [race(1)])).toBe('The A race "R1" added on 22 Aug 2027');
    expect(replanReason([race(1), race(2, { priority: "B" })], [race(1, { raceDate: "2027-08-29" }), race(2, { priority: "B", raceDate: "2027-08-01" })])).toBe(
      'The A race "R1" moved from 22 Aug 2027 to 29 Aug 2027; the B race "R2" moved from 22 Aug 2027 to 1 Aug 2027',
    );
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

  it("dates a priority line, so two races with the same name differ (round 11 I2)", () => {
    expect(replanReason([race(1)], [race(1, { priority: "B" }), race(2, { name: "R1", raceDate: "2027-09-05" })])).toBe(
      '"R1" on 22 Aug 2027 changed from A priority to B priority; the A race "R1" added on 5 Sep 2027',
    );
  });

  it("titles the banner by what happened, not always as a date change (round 11 I2)", () => {
    const fits = (reason: string | null) => replanTitle(reason, false);
    expect(replanTitle('The A race "R1" moved from 22 Aug 2027 to 29 Aug 2027', true)).toBe("Race date changed. The taper no longer ends on race day.");
    expect(fits('The B race "R2" moved from 22 Aug 2027 to 1 Aug 2027')).toBe("Race date changed. The phases stay as they are.");
    // A second A race makes the first a B race: an A race was added, no date changed.
    expect(replanTitle('The A race "R1" added on 5 Sep 2027; "R1" on 22 Aug 2027 changed from A priority to B priority', true)).toBe(
      "An A race was added. The taper no longer ends on race day.",
    );
    expect(fits('The A race "R1" on 22 Aug 2027 removed')).toBe("An A race was removed. The phases stay as they are.");
    expect(fits('"R1" on 22 Aug 2027 changed from A priority to B priority')).toBe("Race priority changed. The phases stay as they are.");
    // A name with a kind word in it does not decide the kind.
    expect(fits('The A race "Moved from added on" moved from 22 Aug 2027 to 29 Aug 2027')).toBe("Race date changed. The phases stay as they are.");
    expect(fits('The A race "R1" moved from 22 Aug 2027 to 29 Aug 2027; "R2" on 1 Aug 2027 changed from C priority to A priority')).toBe(
      "Your races changed. The phases stay as they are.",
    );
    expect(replanTitle(null, true)).toBe("Your races changed. The taper no longer ends on race day.");
  });

  it("says where the season end moves when an A race takes it (round 11 I2)", () => {
    const races = [race(1, { raceDate: "2027-08-22" })];
    // A new A race past the season end takes the end with it.
    expect(seasonEndAfterRace("2027-08-22", races, { raceDate: "2027-09-05", priority: "A" })).toBe("2027-09-05");
    // A B race cannot go past the end; inside the season nothing moves.
    expect(seasonEndAfterRace("2027-08-22", races, { raceDate: "2027-09-05", priority: "B" })).toBeNull();
    expect(seasonEndAfterRace("2027-08-22", races, { raceDate: "2027-08-01", priority: "A" })).toBeNull();
    // The A race the season ends on moves earlier: the end follows it, but not before a later race.
    expect(seasonEndAfterRace("2027-08-22", races, { id: 1, raceDate: "2027-08-15", priority: "A" })).toBe("2027-08-15");
    expect(seasonEndAfterRace("2027-08-22", [...races, race(2, { priority: "C", raceDate: "2027-08-18" })], { id: 1, raceDate: "2027-08-15", priority: "A" })).toBe("2027-08-18");
    // An unchanged date moves nothing.
    expect(seasonEndAfterRace("2027-08-22", races, { id: 1, raceDate: "2027-08-22", priority: "A" })).toBeNull();
  });

  it("keeps the race of each line, and a removed race takes only its own lines", () => {
    const flag = replanFlag([race(1)], [race(1, { priority: "B" }), race(2, { name: "R1" })])!;
    expect(flag.replanRaceIds).toEqual([1, 2]);
    expect(replanWithoutRace(flag, { id: 1, name: "R1" })).toEqual({ replanReason: 'The A race "R1" added on 22 Aug 2027', replanRaceIds: [2] });
    expect(replanWithoutRace({ ...flag, replanRaceIds: [2] }, { id: 2, name: "R1" })).toBeNull();
    // A reason stored before the ids were kept is matched by the race name.
    expect(replanWithoutRace({ replanReason: 'The A race "R1" moved; the B race "R2" moved', replanRaceIds: null }, { id: 1, name: "R1" })).toEqual({
      replanReason: 'The B race "R2" moved',
      replanRaceIds: null,
    });
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
    expect(diffSnapshots(null, snap())).toEqual(['Created season “2027”']);
    const after = snap({
      season: { ...snap().season, endDate: "2027-10-15", replanFlaggedAt: "2027-01-10T10:00:00.000Z", replanReason: "moved" },
      races: [{ id: 5, name: "Haugesund", raceDate: "2027-08-22", priority: "A" }],
      phases: [{ cycleId: 9, name: "Base", phaseOrder: 1, phaseType: "base" }],
    });
    expect(diffSnapshots(snap(), after)).toEqual([
      "End changed from 30 Sep 2027 to 15 Oct 2027",
      "Flagged for a re-plan (moved)",
      'Added A race “Haugesund” on 22 Aug 2027',
      'Phase “Base” added',
    ]);
    expect(diffSnapshots(after, snap())).toContain("Marked as re-planned");
    expect(diffSnapshots(after, snap())).toContain('Removed race “Haugesund”');
  });
});

describe("season row words (docs/design/plan-redesign/spec.md)", () => {
  it("shows a range with the month once when both days share it", () => {
    expect(rangeLabel("2026-11-16", "2026-12-10")).toBe("16 Nov – 10 Dec");
    expect(rangeLabel("2026-11-17", "2026-11-26")).toBe("17 – 26 Nov");
    // A one-day phase is one day, not "28 – 28 May" (round 8).
    expect(rangeLabel("2026-11-28", "2026-11-28")).toBe("28 Nov");
  });

  it("shows a length as weeks or days", () => {
    expect(lengthShort({ durationWeeks: 8, durationDays: null })).toBe("8 wk");
    // A length over two weeks that is not whole weeks reads as weeks and days (round 8).
    expect(lengthShort({ durationWeeks: 8, durationDays: 53 })).toBe("7 wk 4 days");
    expect(lengthShort({ durationWeeks: 17, durationDays: 116 })).toBe("16 wk 4 days");
    expect(lengthShort({ durationWeeks: 3, durationDays: 15 })).toBe("2 wk 1 day");
    expect(lengthShort({ durationWeeks: 2, durationDays: 10 })).toBe("10 days");
    expect(lengthShort({ durationWeeks: 1, durationDays: 1 })).toBe("1 day");
    // Days that make whole weeks read as weeks (Fit the taper writes days).
    expect(lengthShort({ durationWeeks: 15, durationDays: 105 })).toBe("15 wk");
  });

  it("shows the length a phase runs, so a phase cut by a scheduled start shows its cut length (fix round 7)", () => {
    const [cut] = seasonTimeline(
      "2026-11-09",
      [{ id: 1, name: "Base", phaseOrder: 1, phaseType: "base", durationWeeks: 7, durationDays: null, status: "active", startDate: "2026-11-09", scheduledStartDate: null }],
      "2026-11-16",
    );
    expect(runLength(cut)).toBe("1 wk");
    expect(runLength({ lengthDays: 49 })).toBe("7 wk");
    expect(runLength({ lengthDays: 10 })).toBe("10 days");
    expect(runLength({ lengthDays: 1 })).toBe("1 day");
  });

  it("counts the days a running block runs, cut by a scheduled start inside it", () => {
    expect(runLengthDays("2026-11-09", 49, "2026-11-16")).toBe(7);
    expect(runLengthDays("2026-11-09", 49, "2026-11-19")).toBe(10);
    expect(runLengthDays("2026-11-09", 49, "2026-12-28")).toBe(49);
    expect(runLengthDays("2026-11-09", 49, null)).toBe(49);
  });
});

describe("a phase that ended early (round 8)", () => {
  it("ends on its real last day; the chain after it keeps its planned dates", () => {
    const t = seasonTimeline("2026-09-28", [
      { id: 1, name: "Aerobic base", phaseOrder: 1, phaseType: "base", durationWeeks: 8, durationDays: null, status: "completed", startDate: "2026-09-28", scheduledStartDate: null, lastDay: "2026-11-01" },
      { id: 2, name: "Run build", phaseOrder: 2, phaseType: "build", durationWeeks: 8, durationDays: null, status: "draft", startDate: null, scheduledStartDate: null },
    ]);
    expect(t[0]).toMatchObject({ start: "2026-09-28", end: "2026-11-01", lengthDays: 35 });
    expect(t[1].start).toBe("2026-11-23");
  });

  it("keeps the planned end when it ran its whole length", () => {
    const t = seasonTimeline("2026-09-28", [
      { id: 1, name: "Aerobic base", phaseOrder: 1, phaseType: "base", durationWeeks: 8, durationDays: null, status: "completed", startDate: "2026-09-28", scheduledStartDate: null, lastDay: null },
    ]);
    expect(t[0].end).toBe("2026-11-22");
  });
});
