import { db } from "@/db";
import { garminActivities, garminActivityMetrics, garminConnections, garminDailyMetrics, garminDays, workoutSets } from "@/db/schema";
import { ACTIVITY_MODEL_VERSION } from "@/lib/garmin/analytics/activity";
import type { DailyMetrics } from "@/lib/garmin/analytics/daily";
import { addDays } from "@/lib/garmin/dates";
import { runGarminMetricsStep } from "@/lib/garmin/metrics-job";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createExercise, createSession, createUser } from "./factories";

const today = "2026-11-10";
const now = new Date(`${today}T12:00:00Z`);

async function setup() {
  const user = await createUser();
  await db.insert(garminConnections).values({ userId: user.id, encryptedKey: "v1.x.y.z" });
  // Two weeks of HRV and resting HR, one hr_zones snapshot.
  for (let i = 13; i >= 0; i--) {
    const date = addDays(today, -i);
    await db.insert(garminDays).values([
      { userId: user.id, calendarDate: date, kind: "hrv", data: { lastNightAvg: 70, baseline: { balancedLow: 60, balancedUpper: 80 } } },
      { userId: user.id, calendarDate: date, kind: "daily", data: { heartRate: { restingValue: 45 } } },
    ]);
  }
  await db.insert(garminDays).values({
    userId: user.id,
    calendarDate: today,
    kind: "hr_zones",
    data: [{ sport: "DEFAULT", maxHeartRateUsed: 200, restingHeartRateUsed: 50, lactateThresholdHeartRateUsed: 170, zone1Floor: 100, zone2Floor: 120, zone3Floor: 140, zone4Floor: 160, zone5Floor: 180 }],
  });
  return user.id;
}

async function addActivity(userId: string, id: number, typeKey: string, startGmt: string, extra: Record<string, unknown> = {}) {
  await db.insert(garminActivities).values({
    userId,
    garminActivityId: id,
    startTimeLocal: new Date(`${startGmt.replace(" ", "T")}Z`),
    activityType: typeKey,
    data: { activityId: id, startTimeGMT: startGmt, activityType: { typeKey }, duration: 3600, ...extra },
    filesFetchedAt: new Date(),
  });
}

async function daily(userId: string) {
  const rows = await db.select().from(garminDailyMetrics).where(eq(garminDailyMetrics.userId, userId)).orderBy(garminDailyMetrics.day);
  return rows.map((r) => r.metrics as DailyMetrics);
}

describe("runGarminMetricsStep", () => {
  it("computes activity metrics and a daily series from the oldest stored day to today", async () => {
    const userId = await setup();
    // An hour in zone 4 (midpoint 170 bpm = LTHR): about 100 load.
    await addActivity(userId, 1, "treadmill_running", "2026-11-09 06:00:00", { hrTimeInZone_4: 3600 });

    const r = await runGarminMetricsStep(userId, now);
    expect(r).toMatchObject({ activities: 1, days: 14 });

    const [m] = await db.select().from(garminActivityMetrics).where(eq(garminActivityMetrics.userId, userId));
    expect(m).toMatchObject({ sport: "run", day: "2026-11-09", loadMethod: "zones", modelVersion: ACTIVITY_MODEL_VERSION });
    expect(m.load!).toBeCloseTo(100, -1);

    const series = await daily(userId);
    expect(series[0].date).toBe(addDays(today, -13));
    expect(series.at(-1)!.date).toBe(today);
    const run = series.find((d) => d.date === "2026-11-09")!;
    expect(run.pmc.run.load).toBeCloseTo(100, -1);
    expect(run.hrv.bandSource).toBe("garmin");
    expect(series.at(-1)!.restingHr.mean7).toBe(45);

    const [conn] = await db.select().from(garminConnections).where(eq(garminConnections.userId, userId));
    expect(conn.metricsComputedAt).not.toBeNull();
  });

  it("does nothing on a second run until new data arrives", async () => {
    const userId = await setup();
    await runGarminMetricsStep(userId, now);
    expect(await runGarminMetricsStep(userId, now)).toEqual({ reparsed: 0, activities: 0, days: 0 });
    await db.update(garminConnections).set({ metricsComputedAt: null }).where(eq(garminConnections.userId, userId));
    expect((await runGarminMetricsStep(userId, now)).days).toBe(14);
  });

  it("counts a LogEveryLift strength session once when Garmin also recorded it", async () => {
    const userId = await setup();
    await addActivity(userId, 2, "strength_training", "2026-11-08 16:00:00", { hrTimeInZone_2: 3600 });
    const squat = await createExercise({ name: "Metrics Squat", category: "strength" });
    const session = await createSession(userId, null, {
      date: "2026-11-08",
      startTime: new Date("2026-11-08T16:02:00Z"),
      endTime: new Date("2026-11-08T17:00:00Z"),
      isCompleted: true,
    });
    await db.insert(workoutSets).values([
      { sessionId: session.id, exerciseId: squat.id, setNumber: 1, actualReps: 5, weightKg: "100", rpe: 8, restTimeSeconds: 120 },
      { sessionId: session.id, exerciseId: squat.id, setNumber: 2, actualReps: 5, weightKg: "100", rpe: 9, restTimeSeconds: 120 },
    ]);
    // A separate, unmatched session another day counts on its own.
    const other = await createSession(userId, null, {
      date: "2026-11-06",
      startTime: new Date("2026-11-06T16:00:00Z"),
      endTime: new Date("2026-11-06T16:30:00Z"),
      isCompleted: true,
    });
    await db.insert(workoutSets).values({ sessionId: other.id, exerciseId: squat.id, setNumber: 1, actualReps: 5, weightKg: "100", rpe: 7, restTimeSeconds: 120 });

    await runGarminMetricsStep(userId, now);
    const series = await daily(userId);
    const matched = series.find((d) => d.date === "2026-11-08")!;
    expect(matched.entries).toHaveLength(1);
    expect(matched.entries[0]).toMatchObject({ source: "garmin", method: "srpe", matchedSessionId: session.id });
    expect(matched.entries[0].load).toBeCloseTo(60 * 8.5 * 0.22, 1);
    const alone = series.find((d) => d.date === "2026-11-06")!;
    expect(alone.entries).toEqual([{ source: "logeverylift", id: other.id, sport: "strength", load: 30 * 7 * 0.22, method: "srpe" }]);
  });

  it("only reads the user's own rows", async () => {
    const a = await setup();
    const b = await setup();
    await addActivity(b, 3, "running", "2026-11-09 06:00:00", { hrTimeInZone_4: 3600 });
    await runGarminMetricsStep(a, now);
    expect(await db.select().from(garminActivityMetrics).where(eq(garminActivityMetrics.userId, a))).toEqual([]);
    expect((await daily(a)).every((d) => d.entries.length === 0)).toBe(true);
    expect(await db.select().from(garminDailyMetrics).where(and(eq(garminDailyMetrics.userId, b)))).toEqual([]);
  });
});
