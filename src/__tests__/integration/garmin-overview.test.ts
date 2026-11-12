import { db } from "@/db";
import { garminActivities, garminActivityMetrics, garminActivityStreams, garminDays, trainingCycleSlots, trainingCycles, users } from "@/db/schema";
import { updateTrainingCycle } from "@/lib/actions/training-cycles";
import type { GarminDayKind } from "@/lib/garmin/endpoints";
import { getActivityDetail, getOverviewData, getTrendsData, getVolumeData } from "@/lib/garmin/queries";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createExercise, createProgram, createUser } from "./factories";
import { asUser } from "./setup";

/** Overview reads (race date on the cycle, Garmin VO2 max from stored FIT sessions) against a real database. */

async function withActivity(userId: string, id: number, day: string, vo2: number | null) {
  await db.insert(garminDays).values({ userId, calendarDate: day, kind: "hrv", data: { lastNightAvg: 70 } });
  await db.insert(garminActivities).values({ userId, garminActivityId: id, startTimeLocal: new Date(`${day}T07:00:00Z`), activityType: "running", data: { activityName: `Run ${id}`, duration: 1800 } });
  await db.insert(garminActivityMetrics).values({ userId, garminActivityId: id, modelVersion: 1, sport: "run", day, load: 40, loadMethod: "trimp", metrics: { hrPreview: [120, 130], decoupling: null } });
  await db.insert(garminActivityStreams).values({
    userId,
    garminActivityId: id,
    parserVersion: 3,
    streams: {},
    laps: [],
    sets: [],
    timeInZone: [],
    session: { garminVo2Max: vo2, garminVo2MaxUpdated: false },
  });
}

describe("updateTrainingCycle race fields", () => {
  it("saves a race date and distance, and clears them", async () => {
    const user = await createUser();
    asUser(user.id);
    const [c] = await db.insert(trainingCycles).values({ userId: user.id, name: "IM", durationWeeks: 24 }).returning();

    expect((await updateTrainingCycle({ id: c.id, raceDate: "2027-06-20", raceDistance: "full" })).success).toBe(true);
    let [row] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, c.id));
    expect(row).toMatchObject({ raceDate: "2027-06-20", raceDistance: "full" });

    await updateTrainingCycle({ id: c.id, raceDate: null, raceDistance: null });
    [row] = await db.select().from(trainingCycles).where(eq(trainingCycles.id, c.id));
    expect(row).toMatchObject({ raceDate: null, raceDistance: null });
  });

  it("refuses a bad distance and another user's cycle", async () => {
    const owner = await createUser();
    const [c] = await db.insert(trainingCycles).values({ userId: owner.id, name: "IM", durationWeeks: 24 }).returning();
    asUser(owner.id);
    expect((await updateTrainingCycle({ id: c.id, raceDistance: "sprint" })).success).toBe(false);
    asUser((await createUser()).id);
    expect((await updateTrainingCycle({ id: c.id, raceDate: "2027-06-20" })).success).toBe(false);
  });
});

describe("getOverviewData", () => {
  it("reads the active cycle's race and the user's own Garmin VO2 max only", async () => {
    const me = await createUser();
    const other = await createUser();
    await withActivity(me.id, 1, "2026-11-01", 51.2);
    await withActivity(other.id, 2, "2026-11-02", 60);
    await db.insert(trainingCycles).values({ userId: me.id, name: "IM", durationWeeks: 24, status: "active", startDate: "2026-09-01", raceDate: "2027-02-14", raceDistance: "half" });

    const d = await getOverviewData(me.id);
    expect(d.date).toBe("2026-11-01");
    expect(d.body.vo2max.value).toBe(51.2);
    expect(d.body.vo2max.points).toEqual([{ date: "2026-11-01", value: 51.2 }]);
    expect(d.race).toMatchObject({ raceSet: true, raceDay: "2027-02-14", distance: "half" });
    expect(d.last?.id).toBe(1);
  });
});

describe("getVolumeData", () => {
  const today = "2026-11-11";
  async function activity(userId: string, id: number, typeKey: string, sport: string, startIso: string, durationS: number, distanceM: number | null = null) {
    const start = new Date(startIso);
    await db.insert(garminActivities).values({ userId, garminActivityId: id, startTimeLocal: start, activityType: typeKey, data: { duration: durationS, distance: distanceM } });
    await db.insert(garminActivityMetrics).values({
      userId,
      garminActivityId: id,
      modelVersion: 1,
      sport,
      day: startIso.slice(0, 10),
      load: 10,
      loadMethod: "trimp",
      metrics: { startMs: start.getTime(), endMs: start.getTime() + durationS * 1000 },
    });
  }

  it("sums this week's hours, finds a brick, and reads the plan from the active day-of-week cycle", async () => {
    const me = await createUser();
    await activity(me.id, 11, "cycling", "bike", "2026-11-10T08:00:00Z", 7200, 60000);
    await activity(me.id, 12, "running", "run", "2026-11-10T10:05:00Z", 1800, 6000);
    const other = await createUser();
    await activity(other.id, 13, "cycling", "bike", "2026-11-10T08:00:00Z", 20000, 150000);

    const bike = await createExercise({ name: "Bike", category: "cardio", discipline: "bike" });
    const { program } = await createProgram(me.id, [{ exerciseId: bike.id, sets: [{ targetReps: null, weightKg: "0", durationSeconds: 5400 }] }]);
    const [c] = await db
      .insert(trainingCycles)
      .values({ userId: me.id, name: "IM", durationWeeks: 24, status: "active", startDate: "2026-09-01", raceDistance: "half" })
      .returning();
    await db.insert(trainingCycleSlots).values({ trainingCycleId: c.id, programId: program.id, dayOfWeek: 6 });

    const v = await getVolumeData(me.id, today);
    const week = v.weeks.at(-1)!;
    expect(week.weekStart).toBe("2026-11-09");
    expect(week.hours.bike).toBe(2);
    expect(week.hours.run).toBe(0.5);
    expect(v.bricks).toEqual([expect.objectContaining({ rideId: 11, runId: 12, gapMin: 5 })]);
    expect(v.planned).toEqual({ swim: 0, bike: 1.5, run: 0 });
    expect(v.distance).toBe("half");
    expect(v.checklist.find((r) => r.key === "bike")?.best).toBe("2:00 h");
  });
});

describe("getTrendsData", () => {
  it("reads only the user's own activities with efforts, and their Garmin VO2 max and weight", async () => {
    const me = await createUser();
    const other = await createUser();
    const efforts = { power: { 1200: 250 }, speed: {}, distance: {}, vo2: null, hr30: 160, dynamics: [] };
    for (const [userId, id] of [[me.id, 21], [other.id, 22]] as const) {
      await db.insert(garminActivities).values({ userId, garminActivityId: id, startTimeLocal: new Date("2026-11-01T07:00:00Z"), activityType: "cycling", data: {} });
      await db.insert(garminActivityMetrics).values({ userId, garminActivityId: id, modelVersion: 6, sport: "bike", day: "2026-11-01", load: 50, loadMethod: "trimp", metrics: { efforts, indoor: false, durationS: 3600, decoupling: null, thresholds: { lthr: 168 } } });
      await db.insert(garminActivityStreams).values({ userId, garminActivityId: id, parserVersion: 3, streams: {}, laps: [], sets: [], timeInZone: [], session: { garminVo2Max: userId === me.id ? 51 : 60 } });
    }
    await db.insert(garminDays).values({ userId: me.id, calendarDate: "2026-11-02", kind: "weight", data: { latestWeight: { weight: 80500 } } });

    const t = await getTrendsData(me.id, "2026-11-11");
    expect(t.acts).toEqual([expect.objectContaining({ id: 21, sport: "bike", watchLthr: 168, efforts })]);
    expect(t.garminVo2).toEqual([{ day: "2026-11-01", value: 51, sport: "bike" }]);
    expect(t.weight).toEqual([{ day: "2026-11-02", kg: 80.5 }]);
  });
});

describe("Garmin's own numbers", () => {
  async function days(userId: string, date: string, extra: Partial<Record<GarminDayKind, object>>) {
    for (const [kind, data] of Object.entries(extra) as [GarminDayKind, object][]) await db.insert(garminDays).values({ userId, calendarDate: date, kind, data });
  }

  it("Overview reads sleep score, breathing, fitness age, HRV status and intensity minutes for the user only", async () => {
    const me = await createUser();
    const other = await createUser();
    await days(me.id, "2026-11-10", { user_summary: { moderateIntensityMinutes: 30, vigorousIntensityMinutes: 10 } });
    await days(me.id, "2026-11-11", {
      sleep: { sleepScores: { overall: { value: 81 } }, averageRespirationValue: 14.5 },
      fitness_age: { fitnessAge: 18, chronologicalAge: 23 },
      hrv: { status: "BALANCED", weeklyAvg: 89, lastNightAvg: 75 },
      user_summary: { moderateIntensityMinutes: 20, vigorousIntensityMinutes: 5, intensityMinutesGoal: 150 },
    });
    await days(other.id, "2026-11-11", {
      sleep: { sleepScores: { overall: { value: 40 } }, averageRespirationValue: 20 },
      fitness_age: { fitnessAge: 60 },
      hrv: { status: "LOW", weeklyAvg: 30 },
      user_summary: { moderateIntensityMinutes: 999, intensityMinutesGoal: 300 },
    });

    const d = await getOverviewData(me.id, "2026-11-11");
    expect(d.date).toBe("2026-11-11");
    expect(d.body.sleepScore.value).toBe(81);
    expect(d.body.respiration.value).toBe(14.5);
    expect(d.body.fitnessAge.value).toBe(18);
    expect(d.hrvStatus).toEqual({ label: "Balanced", weeklyAvg: 89 });
    expect(d.intensity).toMatchObject({ minutes: 30 + 20 + 20 + 10, goal: 150 });
  });

  it("Trends reads the newest fitness age with its parts and a year-old value", async () => {
    const me = await createUser();
    await days(me.id, "2025-11-03", { fitness_age: { fitnessAge: 21, chronologicalAge: 22 } });
    await days(me.id, "2026-11-11", { fitness_age: { fitnessAge: 18, chronologicalAge: 23, components: { bodyFat: { value: 21.2, priority: 1, targetValue: 13.6 } } } });
    await db.insert(garminDays).values({ userId: (await createUser()).id, calendarDate: "2026-11-11", kind: "fitness_age", data: { fitnessAge: 60 } });

    const t = await getTrendsData(me.id, "2026-11-11");
    expect(t.fitnessAge).toMatchObject({ age: 18, chronological: 23, date: "2026-11-11" });
    expect(t.fitnessAge?.parts.map((p) => p.key)).toEqual(["bodyFat"]);
    expect(t.fitnessAge?.history).toEqual([
      { day: "2025-11-03", age: 21 },
      { day: "2026-11-11", age: 18 },
    ]);
  });

  it("the activity detail reads Garmin's stamina from the stored detail", async () => {
    const me = await createUser();
    await db.insert(garminActivities).values({
      userId: me.id,
      garminActivityId: 31,
      startTimeLocal: new Date("2026-11-11T07:00:00Z"),
      activityType: "running",
      data: { duration: 1800 },
      detail: { summaryDTO: { beginPotentialStamina: 99, endPotentialStamina: 70.4, minAvailableStamina: 64 } },
    });
    await db.insert(garminActivities).values({ userId: me.id, garminActivityId: 32, startTimeLocal: new Date("2026-11-11T09:00:00Z"), activityType: "running", data: {} });

    expect((await getActivityDetail(me.id, 31))?.stamina).toEqual({ start: 99, end: 70, min: 64 });
    expect((await getActivityDetail(me.id, 32))?.stamina).toBeNull();
    expect(await getActivityDetail((await createUser()).id, 31)).toBeNull();
  });
});

describe("getOverviewData rating context", () => {
  it("takes sex and age from the profile, Garmin's HRV baseline and the newest weigh-in", async () => {
    const me = await createUser();
    await db.update(users).set({ gender: "female", birthYear: 1990 }).where(eq(users.id, me.id));
    await db.insert(garminDays).values([
      { userId: me.id, calendarDate: "2026-11-11", kind: "hrv", data: { status: "BALANCED", weeklyAvg: 60, baseline: { lowUpper: 45, balancedLow: 50, balancedUpper: 70 } } },
      { userId: me.id, calendarDate: "2026-11-10", kind: "weight", data: { latestWeight: { weight: 61000, bodyFat: 24.5, bmi: 21.94 } } },
      { userId: me.id, calendarDate: "2026-11-11", kind: "fitness_age", data: { fitnessAge: 30, chronologicalAge: 99 } },
    ]);

    const r = (await getOverviewData(me.id, "2026-11-11")).rating;
    expect(r).toEqual({ sex: "female", age: 36, hrvBaseline: { lowUpper: 45, balancedLow: 50, balancedUpper: 70, weeklyAvg: 60 }, bodyFat: 24.5, bmi: 21.9, chronologicalAge: 99 });
  });

  it("falls back to Garmin's age and leaves sex unknown for other or no gender", async () => {
    const me = await createUser();
    await db.update(users).set({ gender: "prefer_not_to_say" }).where(eq(users.id, me.id));
    await db.insert(garminDays).values({ userId: me.id, calendarDate: "2026-11-11", kind: "fitness_age", data: { fitnessAge: 18, chronologicalAge: 23 } });

    const r = (await getOverviewData(me.id, "2026-11-11")).rating;
    expect(r).toMatchObject({ sex: null, age: 23, hrvBaseline: null, bodyFat: null, bmi: null });
  });
});
