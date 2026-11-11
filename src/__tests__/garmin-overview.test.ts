import { garminView } from "@/components/features/garmin/tabs";
import { bodySignal, normalRange, raceStatus, type CycleForRace } from "@/lib/garmin/analytics/overview";
import { addDays } from "@/lib/garmin/dates";
import { describe, expect, it } from "vitest";

const today = "2026-11-10";
const run = (n: number, value: (i: number) => number, end = today) => Array.from({ length: n }, (_, i) => ({ date: addDays(end, i - n + 1), value: value(i) }));

describe("normalRange", () => {
  it("is mean ± 1 SD, and needs 10 values", () => {
    expect(normalRange([1, 2, 3])).toBeNull();
    const r = normalRange(Array.from({ length: 10 }, (_, i) => (i % 2 ? 50 : 40)))!;
    expect(r[0]).toBeCloseTo(40);
    expect(r[1]).toBeCloseTo(50);
  });
});

describe("bodySignal", () => {
  it("judges the newest value against the 28 days before it", () => {
    const series = [...run(28, (i) => (i % 2 ? 46 : 44), addDays(today, -1)), { date: today, value: 52 }];
    const s = bodySignal(series, today);
    expect(s.value).toBe(52);
    expect(s.normal![0]).toBeCloseTo(44);
    expect(s.normal![1]).toBeCloseTo(46);
    expect(s.state).toBe("above");
    expect(s.points).toHaveLength(14);
  });

  it("uses a given band instead of the computed one", () => {
    const s = bodySignal(run(3, () => 70), today, { band: [60, 80] });
    expect(s.normal).toEqual([60, 80]);
    expect(s.state).toBe("within");
  });

  it("shows no value when the newest point is outside the window, and no state without a normal", () => {
    expect(bodySignal(run(5, () => 80, addDays(today, -30)), today).value).toBeNull();
    const s = bodySignal(run(3, () => 80), today);
    expect(s.value).toBe(80);
    expect(s.state).toBeNull();
  });

  it("ignores points after today", () => {
    expect(bodySignal([{ date: addDays(today, 1), value: 9 }, { date: today, value: 5 }], today).value).toBe(5);
  });
});

describe("raceStatus", () => {
  const cycle: CycleForRace = { name: "IM build", startDate: "2026-09-01", durationWeeks: 24, goal: "build", athleteLevel: "intermediate", raceDate: null, raceDistance: null };

  it("counts down to the cycle's last day while no race is set", () => {
    const r = raceStatus(cycle, today)!;
    expect(r.raceSet).toBe(false);
    expect(r.raceDay).toBe(addDays("2026-09-01", 24 * 7 - 1));
    expect(r.week).toBe(11);
    expect(r.phase).toBe("build");
  });

  it("uses the race date and distance when set", () => {
    const r = raceStatus({ ...cycle, raceDate: "2027-02-14", raceDistance: "full" }, today)!;
    expect(r).toMatchObject({ raceSet: true, raceDay: "2027-02-14", distance: "full", daysToRace: 96 });
  });

  it("has no week or phase before the start, and no status without a start date", () => {
    expect(raceStatus({ ...cycle, startDate: "2026-12-01" }, today)).toMatchObject({ week: null, phase: null });
    expect(raceStatus({ ...cycle, startDate: null }, today)).toBeNull();
    expect(raceStatus(null, today)).toBeNull();
  });
});

describe("garminView", () => {
  it("opens on Overview and keeps the old tab names working", () => {
    expect(garminView(undefined)).toBe("overview");
    expect(garminView("nonsense")).toBe("overview");
    expect(garminView("today")).toBe("day");
    expect(garminView("load")).toBe("training");
    expect(garminView("sleep")).toBe("recovery");
    expect(garminView("data")).toBe("data");
    expect(garminView("activities")).toBe("activities");
  });
});
