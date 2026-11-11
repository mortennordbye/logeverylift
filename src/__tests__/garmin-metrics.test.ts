import { buildGarminMetrics, stripActivityLocation, weekStartOf, type StoredDay } from "@/lib/garmin/metrics";
import { describe, expect, it } from "vitest";

// Shapes copied from Garmin Personal API responses, values made up.
const hrv = {
  calendarDate: "2026-11-03",
  weeklyAvg: 79,
  lastNightAvg: 70,
  baseline: { lowUpper: 79, balancedLow: 84, balancedUpper: 106 },
  status: "LOW",
};
const sleep = {
  calendarDate: "2026-11-03",
  sleepTimeSeconds: 28_800,
  deepSleepSeconds: 3_600,
  remSleepSeconds: 7_200,
  lightSleepSeconds: 18_000,
  awakeSleepSeconds: 300,
  sleepScores: { overall: { value: 81, qualifierKey: "GOOD" } },
};
const daily = {
  calendarDate: "2026-11-03",
  heartRate: { minValue: 43, maxValue: 160, restingValue: 45 },
  movement: { steps: { value: 9_000 } },
  intensityMinutes: { moderate: 10, vigorous: 20 },
  stress: { avgLevel: 27 },
  bodyBattery: { chargedValue: 60, drainedValue: 55, maxValue: 90, minValue: 20 },
};

function activity(id: number, start: string, type: string, load: number | null, duration = 3_600) {
  return {
    garminActivityId: id,
    data: { activityId: id, startTimeLocal: start, activityType: { typeKey: type }, duration, distance: 20_000, averageHR: 130, activityTrainingLoad: load },
  };
}

describe("buildGarminMetrics", () => {
  const days: StoredDay[] = [
    { calendarDate: "2026-11-03", kind: "hrv", data: hrv },
    { calendarDate: "2026-11-03", kind: "sleep", data: sleep },
    { calendarDate: "2026-11-03", kind: "daily", data: daily },
  ];

  it("gives one row per date, with gaps as nulls", () => {
    const m = buildGarminMetrics(days, [], "2026-11-02", "2026-11-04");
    expect(m.days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(m.days[0].hrvLastNight).toBeNull();
    expect(m.days[2].sleepSeconds).toBeNull();
  });

  it("reads HRV, sleep and the daily summary into the day", () => {
    const d = buildGarminMetrics(days, [], "2026-11-03", "2026-11-03").days[0];
    expect(d).toMatchObject({
      hrvLastNight: 70,
      hrvWeeklyAvg: 79,
      hrvBaselineLow: 84,
      hrvBaselineHigh: 106,
      hrvStatus: "LOW",
      sleepSeconds: 28_800,
      deepSeconds: 3_600,
      remSeconds: 7_200,
      lightSeconds: 18_000,
      sleepScore: 81,
      restingHr: 45,
      bodyBatteryMax: 90,
      bodyBatteryMin: 20,
      steps: 9_000,
      stressAvg: 27,
      // Vigorous minutes count double, as in Garmin's own weekly goal.
      intensityMinutes: 50,
    });
  });

  it("shows a missing or wrong-typed field as null instead of throwing", () => {
    const broken: StoredDay[] = [
      { calendarDate: "2026-11-03", kind: "hrv", data: { lastNightAvg: "70", baseline: null } },
      { calendarDate: "2026-11-03", kind: "daily", data: null },
    ];
    const d = buildGarminMetrics(broken, [], "2026-11-03", "2026-11-03").days[0];
    expect(d.hrvLastNight).toBeNull();
    expect(d.hrvBaselineLow).toBeNull();
    expect(d.restingHr).toBeNull();
    expect(d.intensityMinutes).toBeNull();
  });

  it("ignores days outside the range", () => {
    const m = buildGarminMetrics(days, [], "2026-11-04", "2026-11-05");
    expect(m.days.every((d) => d.hrvLastNight === null)).toBe(true);
  });

  it("lists activities newest first and sums load per Monday-start week", () => {
    const m = buildGarminMetrics(
      [],
      [
        activity(1, "2026-11-02 07:00:00", "indoor_cycling", 40), // Monday
        activity(2, "2026-11-08 18:00:00", "treadmill_running", 30, 1_800), // Sunday, same week
        activity(3, "2026-11-09 06:00:00", "lap_swimming", null), // next Monday
        activity(4, "2026-10-20 06:00:00", "running", 99), // before the range
      ],
      "2026-11-02",
      "2026-11-10",
    );
    expect(m.activities.map((a) => a.id)).toEqual([3, 2, 1]);
    expect(m.weeklyLoad).toEqual([
      { weekStart: "2026-11-02", load: 70, minutes: 90, count: 2 },
      { weekStart: "2026-11-09", load: 0, minutes: 60, count: 1 },
    ]);
  });
});

describe("weekStartOf", () => {
  it("returns the Monday of the week", () => {
    expect(weekStartOf("2026-11-11")).toBe("2026-11-09"); // Wednesday
    expect(weekStartOf("2026-11-09")).toBe("2026-11-09"); // Monday
    expect(weekStartOf("2026-11-15")).toBe("2026-11-09"); // Sunday
  });
});

describe("stripActivityLocation", () => {
  it("removes GPS and place fields and keeps the rest", () => {
    const stripped = stripActivityLocation({
      activityId: 1,
      startLatitude: 59.9,
      startLongitude: 10.7,
      endLatitude: 59.9,
      endLongitude: 10.7,
      locationName: "Oslo",
      averageHR: 130,
    });
    expect(stripped).toEqual({ activityId: 1, averageHR: 130 });
  });
});
