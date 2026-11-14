import {
  diffSnapshots,
  sessionChangeLine,
  snapshotName,
  type CycleSnapshot,
  type PlannedSessionSnapshot,
  type SeasonSnapshot,
  type SlotSnap,
} from "@/lib/utils/plan-revisions";
import { describe, expect, it } from "vitest";

/**
 * The words of a cycle's and a season's history page (docs/design/plan-redesign/spec.md):
 * no colons, human dates, and rotation positions as the session sheet shows them.
 */

const cycle = (over: Record<string, unknown> = {}, slots: SlotSnap[] = []): CycleSnapshot => ({
  v: 1,
  cycle: {
    id: 1,
    name: "Upper / Lower",
    durationWeeks: 8,
    durationDays: null,
    scheduleType: "rotation",
    status: "draft",
    startDate: null,
    scheduledStartDate: null,
    endAction: "none",
    endMessage: null,
    raceDate: null,
    raceDistance: null,
    adaptationPct: 100,
    seasonId: null,
    phaseOrder: null,
    phaseType: null,
    ...over,
  },
  slots,
});

const slot = (id: number, orderIndex: number | null, label: string, dayOfWeek: number | null = null, daySlot = 1): SlotSnap => ({
  id,
  orderIndex,
  dayOfWeek,
  daySlot,
  label,
  programId: id + 100,
  programName: label,
  autoComplete: true,
  notes: null,
});

const noColon = (lines: string[]) => lines.forEach((l) => expect(l).not.toMatch(/:/));

describe("cycle history text", () => {
  it("says a date was set, changed or cleared, as a human date", () => {
    expect(diffSnapshots(cycle(), cycle({ startDate: "2026-10-31" }))).toEqual(["Start date set to 31 Oct 2026"]);
    expect(diffSnapshots(cycle({ startDate: "2026-10-31" }), cycle({ startDate: "2026-11-07" }))).toEqual([
      "Start date changed from 31 Oct 2026 to 7 Nov 2026",
    ]);
    expect(diffSnapshots(cycle({ scheduledStartDate: "2026-11-16" }), cycle())).toEqual(["Scheduled start cleared"]);
  });

  it("names the length, the end and the schedule in the app's words", () => {
    const lines = diffSnapshots(cycle(), cycle({ durationWeeks: 10, endAction: "deload", status: "active", endMessage: "Test 1RM" }));
    expect(lines).toEqual([
      "Length changed from 8 weeks to 10 weeks",
      "Status changed from draft to active",
      "When it ends changed from Just stop to Deload week",
      "Note to future self changed",
    ]);
    noColon(lines);
  });

  it("numbers rotation slots from 1 in their order, as the session sheet does", () => {
    // Order indexes need not start at 1 or be dense: an MCP write may use 0, a delete leaves a gap.
    const before = cycle({}, [slot(1, 0, "Upper A"), slot(2, 3, "Lower A")]);
    const after = cycle({}, [slot(1, 0, "Upper A"), slot(2, 3, "Lower A"), slot(3, 7, "Lower B")]);
    expect(diffSnapshots(before, after)).toEqual(["Added Lower B at position 3"]);
    expect(diffSnapshots(after, before)).toEqual(["Removed Lower B from position 3"]);
    const swapped = cycle({}, [slot(1, 0, "Push"), slot(2, 3, "Lower A")]);
    expect(diffSnapshots(before, swapped)).toEqual(["Position 1 changed from Upper A to Push"]);
  });

  it("names weekday slots by their day, and a day's second session by its number", () => {
    const before = cycle({ scheduleType: "day_of_week" }, [slot(1, null, "Upper A", 1)]);
    const after = cycle({ scheduleType: "day_of_week" }, [slot(1, null, "Upper A", 1), slot(2, null, "Easy run", 1, 2)]);
    const lines = diffSnapshots(before, after);
    expect(lines).toEqual(["Added Easy run on Mon, session 2"]);
    noColon(lines);
  });
});

describe("season history text", () => {
  const season = (over: Partial<SeasonSnapshot> = {}): SeasonSnapshot => ({
    v: 1,
    season: { id: 1, name: "2027", startDate: "2027-01-04", endDate: "2027-09-30", goal: null, nextGoal: null, replanFlaggedAt: null, replanReason: null },
    races: [],
    phases: [],
    ...over,
  });

  it("writes dates, races and phases without colons", () => {
    const before = season({
      races: [{ id: 5, name: "Haugesund", raceDate: "2027-08-22", priority: "A" }],
      phases: [{ cycleId: 9, name: "Base", phaseOrder: 1, phaseType: "base" }],
    });
    const after = season({
      season: { ...season().season, endDate: "2027-10-15", replanFlaggedAt: "2027-01-10T10:00:00.000Z", replanReason: "moved" },
      races: [{ id: 5, name: "Haugesund", raceDate: "2027-08-29", priority: "A" }],
      phases: [{ cycleId: 9, name: "Base", phaseOrder: 2, phaseType: "build" }],
    });
    const lines = diffSnapshots(before, after);
    expect(lines).toEqual([
      "End changed from 30 Sep 2027 to 15 Oct 2027",
      "Flagged for a re-plan (moved)",
      'Race "Haugesund" date changed from 22 Aug 2027 to 29 Aug 2027',
      'Phase "Base" moved from position 1 to 2',
      'Phase "Base" type changed from Base to Build',
    ]);
    noColon(lines);
    expect(diffSnapshots(season(), before)).toContain('Added A race "Haugesund" on 22 Aug 2027');
  });
});

describe("dated session history text", () => {
  const snap = (session: Record<string, unknown> = {}, programName: string | null = "Squat day"): PlannedSessionSnapshot => ({
    v: 1,
    session: { id: 5, date: "2026-11-04", position: 1, programId: 10, label: null, notes: null, status: "planned", skipReason: null, touchedAt: null, deletedAt: null, rotationPosition: null, ...session },
    programName,
  });

  it("names a dated session by its day", () => {
    expect(snapshotName(snap())).toBe("Squat day on Wed 4 Nov");
    expect(diffSnapshots(snap(), snap({ date: "2026-11-06" }))).toEqual(["Moved Squat day from Wed 4 Nov to Fri 6 Nov"]);
  });

  it("gives a rotation session no walk number, which the sheet does not show", () => {
    // rotationPosition counts every session of the block (11 is the 12th);
    // the sheet numbers the slots ("position 2 of 5"), so the walk number would disagree.
    const rotation = snap({ date: null, rotationPosition: 11, status: "skipped" }, "Lower B");
    expect(snapshotName(rotation)).toBe("Lower B in the rotation");
    expect(diffSnapshots(null, rotation)).toEqual(["Skipped Lower B in the rotation"]);
  });

  it("writes reasons and changes without colons", () => {
    const lines = [
      ...diffSnapshots(snap(), snap({ status: "skipped", skipReason: "Travel" })),
      ...diffSnapshots(snap({ programId: 11 }, "Run"), snap()),
      ...diffSnapshots(snap(), snap({ status: "missed", missedReason: "Work" })),
    ];
    expect(lines).toEqual(["Skipped (Travel)", "Program changed from Run to Squat day", "Confirmed missed (Work)"]);
    noColon(lines);
  });

  it("a missed session moved to a coming day is one move, not a move and a plan again (J8-04)", () => {
    expect(diffSnapshots(snap({ status: "missed" }), snap({ date: "2026-11-07" }))).toEqual(["Moved Squat day from Wed 4 Nov to Sat 7 Nov"]);
  });

  it("a skip names the session and the day, with the reason after (J8-04)", () => {
    expect(sessionChangeLine("Long ride on Sun 22 Nov", "Skipped (Work trip)")).toBe("Skipped Long ride on Sun 22 Nov (Work trip)");
    expect(sessionChangeLine("Long ride on Sun 22 Nov", "Skipped")).toBe("Skipped Long ride on Sun 22 Nov");
    expect(sessionChangeLine("Long ride on Sun 22 Nov", "Skipped Long ride on Sun 22 Nov")).toBe("Skipped Long ride on Sun 22 Nov");
  });

  it("joins a change to the session it is about with a comma", () => {
    expect(sessionChangeLine("Squat day on Wed 4 Nov", "Label set to Heavy")).toBe("Squat day on Wed 4 Nov, label set to Heavy");
    expect(sessionChangeLine("Squat day on Fri 6 Nov", "Moved Squat day from Wed 4 Nov to Fri 6 Nov")).toBe("Moved Squat day from Wed 4 Nov to Fri 6 Nov");
    expect(sessionChangeLine("Squat day on Wed 4 Nov", "Added Squat day on Wed 4 Nov")).toBe("Added Squat day on Wed 4 Nov");
  });
});
