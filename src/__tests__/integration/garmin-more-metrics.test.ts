import { db } from "@/db";
import { garminActivities, garminDays } from "@/db/schema";
import { garminToday, getActivitiesData, getOverviewData, getTodayData, getTrendsData } from "@/lib/garmin/queries";
import { describe, expect, it } from "vitest";
import { createUser } from "./factories";

/** The last Garmin fields brought into the app, read through the real queries. */

describe("Garmin's remaining metrics", () => {
  it("Overview reads the night's feedback, sleep need, breathing, SpO2, naps and timing", async () => {
    const me = await createUser();
    await db.insert(garminDays).values([
      {
        userId: me.id,
        calendarDate: "2026-11-11",
        kind: "sleep",
        data: {
          deepSleepSeconds: 5100,
          lightSleepSeconds: 18600,
          remSleepSeconds: 6300,
          awakeSleepSeconds: 900,
          sleepScoreFeedback: "POSITIVE_LONG_AND_DEEP",
          sleepScoreInsight: "NONE",
          nextSleepNeed: { actual: 510, recommendedBedtimeStartMins: 1320, recommendedBedtimeEndMins: 1340 },
          breathingDisruptionSeverity: "LOW",
          lowestSpO2Value: 87,
          dailyNapDTOS: [{ napTimeSec: 1200 }, { napTimeSec: 600 }],
          sleepAlignment: { status: "BEHIND" },
        },
      },
      { userId: me.id, calendarDate: "2026-11-10", kind: "spo2", data: { lastSevenDaysAvgSpO2: 96.6 } },
      { userId: me.id, calendarDate: "2026-11-11", kind: "spo2", data: { lastSevenDaysAvgSpO2: null } },
    ]);

    const n = (await getOverviewData(me.id, "2026-11-11")).night!;
    expect(n).toMatchObject({ feedback: "POSITIVE_LONG_AND_DEEP", insight: "NONE", nextNeedMin: 510, bedtime: [1320, 1340], breathing: "LOW", lowestSpO2: 87, spo2Avg7: 96.6, napS: 1800, alignment: "BEHIND" });
  });

  it("Overview reads the day's floors, distance, active time, calories and altitude from complete days, and the scale's bone mass and water", async () => {
    const me = await createUser();
    const summary = { floorsAscended: 18.08, userFloorsAscendedGoal: 10, totalDistanceMeters: 11267, activeSeconds: 3164, highlyActiveSeconds: 3288, totalKilocalories: 3245, bmrKilocalories: 2399, averageMonitoringEnvironmentAltitude: 97.3 };
    await db.insert(garminDays).values([
      { userId: me.id, calendarDate: "2026-11-10", kind: "user_summary", data: summary },
      // Today is still filling up: left out.
      { userId: me.id, calendarDate: "2026-11-11", kind: "user_summary", data: { ...summary, floorsAscended: 1, totalKilocalories: 300, bmrKilocalories: 500 } },
      { userId: me.id, calendarDate: "2026-11-09", kind: "weight", data: { latestWeight: { weight: 89700, boneMass: 6340, bodyWater: 58.1 } } },
      // Last night's sleep makes 11 Nov the newest Garmin day, as real data does.
      { userId: me.id, calendarDate: "2026-11-11", kind: "sleep", data: { sleepTimeSeconds: 28000 } },
    ]);

    const d = await getOverviewData(me.id, "2026-11-11");
    expect(d.body.floors).toMatchObject({ value: 18, date: "2026-11-10" });
    expect(d.body.distance.value).toBe(11.3);
    expect(d.body.activeTime.value).toBe(108);
    expect(d.body.calories.value).toBe(3245);
    expect(d.body.altitude.value).toBe(97);
    expect(d.body.boneMass.value).toBe(6.3);
    expect(d.body.bodyWater.value).toBe(58.1);
    expect(d.floorGoal).toBe(10);
    expect(d.bmr).toBe(2399);
  });

  it("the activity list carries Garmin's PR flag, Trends the previous fitness age, the Day tab body battery", async () => {
    const me = await createUser();
    await db.insert(garminActivities).values([
      { userId: me.id, garminActivityId: 41, startTimeLocal: new Date("2026-11-10T07:00:00Z"), activityType: "running", data: { isPR: true } },
      { userId: me.id, garminActivityId: 42, startTimeLocal: new Date("2026-11-11T07:00:00Z"), activityType: "running", data: {} },
    ]);
    await db.insert(garminDays).values([
      { userId: me.id, calendarDate: "2026-11-11", kind: "fitness_age", data: { fitnessAge: 18, chronologicalAge: 23, previousFitnessAge: 19 } },
      { userId: me.id, calendarDate: "2026-11-11", kind: "body_battery", data: { bodyBatteryValuesArray: [[Date.parse("2026-11-11T06:00:00Z"), 97]], bodyBatteryActivityEvent: [] } },
    ]);

    const list = (await getActivitiesData(me.id)).list;
    expect(list.map((a) => [a.id, a.pr])).toEqual([
      [42, false],
      [41, true],
    ]);
    expect((await getTrendsData(me.id, "2026-11-11")).fitnessAge?.previous).toBe(19);
    expect((await getTodayData(me.id, "2026-11-11")).bodyBattery?.points.map((p) => p.level)).toEqual([97]);
  });
});

describe("garminToday", () => {
  it("is today in the time zone of the user's Garmin profile, UTC without one", async () => {
    const me = await createUser();
    const lateUtc = new Date("2026-11-12T23:30:00Z");
    expect(await garminToday(me.id, lateUtc)).toBe("2026-11-12");
    await db.insert(garminDays).values({ userId: me.id, calendarDate: "2026-11-01", kind: "profile", data: { timeZone: "Europe/Oslo" } });
    expect(await garminToday(me.id, lateUtc)).toBe("2026-11-13");
    // Another user's zone is never used.
    expect(await garminToday((await createUser()).id, lateUtc)).toBe("2026-11-12");
  });
});
