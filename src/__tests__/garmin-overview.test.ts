import { garminView } from "@/components/features/garmin/tabs";
import { bodySignal, changeOver, intensityWeek, normalRange, parseFitnessAge, raceStatus, rollingMean, stageShares, type CycleForRace } from "@/lib/garmin/analytics/overview";
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

describe("intensityWeek", () => {
  it("counts vigorous minutes twice, Monday to the given day, against today's goal", () => {
    const rows = [
      { date: "2026-11-08", data: { moderateIntensityMinutes: 500 } },
      { date: "2026-11-09", data: { moderateIntensityMinutes: 20, vigorousIntensityMinutes: 30 } },
      { date: "2026-11-11", data: { moderateIntensityMinutes: 10, vigorousIntensityMinutes: 5, intensityMinutesGoal: 150 } },
      { date: "2026-11-12", data: { moderateIntensityMinutes: 99 } },
    ];
    const w = intensityWeek(rows, "2026-11-11", "2026-11-09");
    expect(w.minutes).toBe(20 + 60 + 10 + 10);
    expect(w.goal).toBe(150);
    expect(w.days.map((d) => d.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(w.days[3]).toEqual({ date: "2026-11-12", moderate: 0, vigorous: 0 });
  });

  it("has no goal when Garmin sent none", () => {
    expect(intensityWeek([], "2026-11-11", "2026-11-09")).toMatchObject({ minutes: 0, goal: null });
  });
});

describe("parseFitnessAge", () => {
  it("reads the age and orders the parts by Garmin's priority", () => {
    const f = parseFitnessAge({
      fitnessAge: 18,
      chronologicalAge: 23,
      components: {
        rhr: { value: 45 },
        bodyFat: { value: 21.2, priority: 1, targetValue: 13.6, potentialAge: 18 },
        vigorousDaysAvg: { value: 2.1, priority: 2, targetValue: 3, potentialAge: 19.3 },
        vigorousMinutesAvg: { value: 126 },
        unknown: { value: 1 },
      },
    })!;
    expect(f.age).toBe(18);
    expect(f.chronological).toBe(23);
    expect(f.parts.map((p) => p.key)).toEqual(["bodyFat", "vigorousDaysAvg", "rhr", "vigorousMinutesAvg"]);
    expect(f.parts[0]).toEqual({ key: "bodyFat", label: "Body fat", unit: "%", value: 21.2, target: 13.6, potentialAge: 18 });
  });

  it("is null without an age", () => {
    expect(parseFitnessAge({ components: {} })).toBeNull();
    expect(parseFitnessAge(null)).toBeNull();
  });
});

describe("rollingMean", () => {
  it("averages each day with the 6 before it, once 4 days are in the window", () => {
    const series = run(5, (i) => (i + 1) * 1000);
    expect(rollingMean(series)).toEqual([
      { date: addDays(today, -1), value: 2500 },
      { date: today, value: 3000 },
    ]);
  });

  it("drops days outside the 7-day window", () => {
    const series = [{ date: addDays(today, -10), value: 99999 }, ...run(4, () => 8000)];
    expect(rollingMean(series).at(-1)).toEqual({ date: today, value: 8000 });
  });
});

describe("bodySignal fresh", () => {
  it("keeps 90 days of history but shows no value older than `fresh` days", () => {
    const s = bodySignal([{ date: addDays(today, -20), value: 50 }], today, { days: 90, fresh: 14 });
    expect(s.points).toHaveLength(1);
    expect(s.value).toBeNull();
  });
});

describe("changeOver", () => {
  const sig = (points: { date: string; value: number }[]) => bodySignal(points, today, { days: 90 });

  it("compares the newest value with the newest point at least `days` back", () => {
    const s = sig([{ date: addDays(today, -30), value: 50 }, { date: addDays(today, -27), value: 52 }, { date: today, value: 51 }]);
    expect(changeOver(s, 28)).toEqual({ now: 51, then: 50, delta: 1 });
  });

  it("compares 7-day means when asked, so one odd night does not swing it", () => {
    const night = (i: number) => (i === 0 ? 40 : 80);
    const s = sig([...run(7, (i) => night(i), addDays(today, -28)), ...run(7, () => 82)]);
    expect(changeOver(s, 28)!.delta).toBe(82 - 80);
    expect(changeOver(s, 28, 7)!.then).toBeCloseTo((40 + 6 * 80) / 7);
  });

  it("is null without a point that far back", () => {
    expect(changeOver(sig(run(10, () => 50)), 28)).toBeNull();
  });
});

describe("stageShares", () => {
  it("is each stage's share of the time asleep, awake left out", () => {
    expect(stageShares({ deepS: 5100, lightS: 18600, remS: 6300 })).toEqual({ deep: 17, light: 62, rem: 21 });
    expect(stageShares({ deepS: 0, lightS: 0, remS: 0 })).toEqual({ deep: 0, light: 0, rem: 0 });
  });
});
