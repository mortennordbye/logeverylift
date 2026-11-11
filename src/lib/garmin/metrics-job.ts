import { db } from "@/db";
import {
  exercises,
  garminActivities,
  garminActivityFiles,
  garminActivityMetrics,
  garminActivityStreams,
  garminConnections,
  garminDailyMetrics,
  garminDays,
  users,
  workoutSessions,
  workoutSets,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { ACTIVITY_MODEL_VERSION, computeActivityMetrics, type ActivityMetrics } from "./analytics/activity";
import { DAILY_MODEL_VERSION, buildDailyMetrics, type DayInputs, type StrengthSessionInput } from "./analytics/daily";
import type { Sport } from "./analytics/sport";
import { isoDate } from "./dates";
import { FIT_PARSER_VERSION, parseFit } from "./fit";
import { readZipEntry } from "./zip";

/**
 * The worker's metric steps (docs/plans/garmin-insights-design.md, 6.2).
 * No Garmin calls: everything is read from stored rows.
 *
 * 1. Re-parse stored FIT files after a parser change.
 * 2. Compute metrics for activities without a row at ACTIVITY_MODEL_VERSION.
 * 3. When all activities are done, rebuild the whole daily series. It reads
 *    small rows and runs in milliseconds, so there is no partial update.
 *
 * garmin_connections.metrics_computed_at is cleared whenever new data is
 * stored (finishRun in sync.ts); null means "rebuild".
 */

const REPARSE_PER_TICK = 20;
const ACTIVITIES_PER_TICK = 50;
/** A LogEveryLift session left running longer than this counts as this long. */
const MAX_STRENGTH_MINUTES = 180;

async function reparse(userId: string) {
  const stale = await db
    .select({ id: garminActivityStreams.garminActivityId, zip: garminActivityFiles.zip })
    .from(garminActivityStreams)
    .innerJoin(
      garminActivityFiles,
      and(eq(garminActivityFiles.userId, garminActivityStreams.userId), eq(garminActivityFiles.garminActivityId, garminActivityStreams.garminActivityId)),
    )
    .where(and(eq(garminActivityStreams.userId, userId), lt(garminActivityStreams.parserVersion, FIT_PARSER_VERSION)))
    .limit(REPARSE_PER_TICK);
  for (const row of stale) {
    try {
      const fit = readZipEntry(row.zip, ".fit");
      if (!fit) continue;
      const p = parseFit(fit);
      await db
        .update(garminActivityStreams)
        .set({
          parserVersion: p.parserVersion,
          sport: p.sport,
          subSport: p.subSport,
          streams: p.streams,
          laps: p.laps,
          sets: p.sets,
          timeInZone: p.timeInZone,
          session: p.session,
          lengths: p.lengths,
          events: p.events,
          parsedAt: new Date(),
        })
        .where(and(eq(garminActivityStreams.userId, userId), eq(garminActivityStreams.garminActivityId, row.id)));
    } catch (e) {
      console.error("[garminMetrics] reparse failed", { userId, activityId: row.id }, e instanceof Error ? e.message : "unknown");
    }
  }
  return stale.length;
}

/** Activities whose metrics are missing or from an older model, and whose files are done or failed. */
function pendingActivities(userId: string, limit: number) {
  return db
    .select({
      id: garminActivities.garminActivityId,
      type: garminActivities.activityType,
      start: garminActivities.startTimeLocal,
      data: garminActivities.data,
    })
    .from(garminActivities)
    .leftJoin(
      garminActivityMetrics,
      and(eq(garminActivityMetrics.userId, garminActivities.userId), eq(garminActivityMetrics.garminActivityId, garminActivities.garminActivityId)),
    )
    .where(
      and(
        eq(garminActivities.userId, userId),
        isNotNull(garminActivities.filesFetchedAt),
        or(isNull(garminActivityMetrics.id), ne(garminActivityMetrics.modelVersion, ACTIVITY_MODEL_VERSION)),
      ),
    )
    .orderBy(asc(garminActivities.startTimeLocal))
    .limit(limit);
}

async function computeActivities(userId: string, female: boolean) {
  const todo = await pendingActivities(userId, ACTIVITIES_PER_TICK);
  if (!todo.length) return 0;
  const [snapshot] = await db
    .select({ data: garminDays.data })
    .from(garminDays)
    .where(and(eq(garminDays.userId, userId), eq(garminDays.kind, "hr_zones")))
    .orderBy(desc(garminDays.calendarDate))
    .limit(1);
  const streams = await db
    .select({ id: garminActivityStreams.garminActivityId, streams: garminActivityStreams.streams, timeInZone: garminActivityStreams.timeInZone })
    .from(garminActivityStreams)
    .where(and(eq(garminActivityStreams.userId, userId), inArray(garminActivityStreams.garminActivityId, todo.map((a) => a.id))));
  const byId = new Map(streams.map((s) => [s.id, s]));

  for (const a of todo) {
    const s = byId.get(a.id);
    const m: ActivityMetrics = computeActivityMetrics({
      typeKey: a.type,
      summary: (a.data ?? {}) as Record<string, unknown>,
      streams: (s?.streams ?? null) as Record<string, (number | null)[]> | null,
      timeInZone: s?.timeInZone ?? null,
      hrZonesSnapshot: snapshot?.data ?? null,
      female,
    });
    const values = {
      modelVersion: ACTIVITY_MODEL_VERSION,
      sport: m.sport,
      day: isoDate(a.start),
      load: m.load,
      loadMethod: m.loadMethod,
      metrics: m,
      computedAt: new Date(),
    };
    await db
      .insert(garminActivityMetrics)
      .values({ userId, garminActivityId: a.id, ...values })
      .onConflictDoUpdate({ target: [garminActivityMetrics.userId, garminActivityMetrics.garminActivityId], set: values });
  }
  return todo.length;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function strengthSessions(userId: string): Promise<StrengthSessionInput[]> {
  const rows = await db
    .select({
      id: workoutSessions.id,
      day: workoutSessions.date,
      start: workoutSessions.startTime,
      end: workoutSessions.endTime,
      feeling: workoutSessions.feeling,
      rpe: workoutSets.rpe,
      setType: workoutSets.setType,
    })
    .from(workoutSessions)
    .innerJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.isCompleted, true),
        eq(workoutSessions.source, "app"),
        eq(exercises.category, "strength"),
      ),
    );
  const sessions = new Map<number, StrengthSessionInput>();
  for (const r of rows) {
    const startMs = r.start.getTime();
    const endMs = r.end ? Math.min(r.end.getTime(), startMs + MAX_STRENGTH_MINUTES * 60_000) : null;
    const s = sessions.get(r.id) ?? { sessionId: r.id, day: r.day, startMs, endMs, setRpes: [], feeling: r.feeling };
    if (r.setType === "working") s.setRpes.push(r.rpe);
    sessions.set(r.id, s);
  }
  return [...sessions.values()];
}

/** Garmin's *Local timestamps are local wall-clock time written as if UTC. */
function dayInputs(rows: { date: string; kind: string; data: unknown }[]): DayInputs[] {
  const days = new Map<string, DayInputs>();
  const get = (date: string) => {
    let d = days.get(date);
    if (!d) {
      d = { date, hrvMs: null, garminHrvLow: null, garminHrvHigh: null, restingHr: null, sleep: null };
      days.set(date, d);
    }
    return d;
  };
  for (const r of rows) {
    const j = (r.data ?? {}) as Record<string, unknown>;
    const d = get(r.date);
    if (r.kind === "hrv") {
      d.hrvMs = num(j.lastNightAvg);
      const baseline = (j.baseline ?? {}) as Record<string, unknown>;
      d.garminHrvLow = num(baseline.balancedLow);
      d.garminHrvHigh = num(baseline.balancedUpper);
    } else if (r.kind === "heart_rate") {
      d.restingHr = num(j.restingHeartRate) ?? d.restingHr;
    } else if (r.kind === "daily") {
      d.restingHr = d.restingHr ?? num((j.heartRate as Record<string, unknown> | undefined)?.restingValue);
    } else if (r.kind === "sleep") {
      const need = num((j.sleepNeed as Record<string, unknown> | undefined)?.actual);
      d.sleep = {
        date: r.date,
        start: num(j.sleepStartTimestampLocal),
        end: num(j.sleepEndTimestampLocal),
        sleepSeconds: num(j.sleepTimeSeconds),
        needSeconds: need !== null ? need * 60 : null,
        napSeconds: num(j.napTimeSeconds),
      };
    }
  }
  return [...days.values()];
}

/** Add each day's logged readiness, including days with no Garmin row. */
function withFeel(days: DayInputs[], feel: Map<string, number>): DayInputs[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const [date, value] of feel) {
    const d = byDate.get(date) ?? { date, hrvMs: null, garminHrvLow: null, garminHrvHigh: null, restingHr: null, sleep: null };
    d.feel = value;
    byDate.set(date, d);
  }
  return [...byDate.values()];
}

async function buildDaily(userId: string, today: string) {
  const activityRows = await db
    .select({ id: garminActivityMetrics.garminActivityId, day: garminActivityMetrics.day, sport: garminActivityMetrics.sport, metrics: garminActivityMetrics.metrics })
    .from(garminActivityMetrics)
    .where(eq(garminActivityMetrics.userId, userId));
  const dayRows = await db
    .select({ date: garminDays.calendarDate, kind: garminDays.kind, data: garminDays.data })
    .from(garminDays)
    .where(and(eq(garminDays.userId, userId), inArray(garminDays.kind, ["hrv", "sleep", "daily", "heart_rate"])));
  const sessions = await strengthSessions(userId);
  const feelRows = await db
    .select({ day: workoutSessions.date, feel: sql<number>`avg(${workoutSessions.readiness})::float` })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), isNotNull(workoutSessions.readiness)))
    .groupBy(workoutSessions.date);
  const feelByDay = new Map(feelRows.map((r) => [r.day, r.feel]));

  const firstDays = [...dayRows.map((r) => r.date), ...activityRows.map((a) => a.day)].sort();
  const start = firstDays[0];
  if (!start || start > today) return 0;

  const daily = buildDailyMetrics({
    start,
    end: today,
    activities: activityRows.map((a) => {
      const m = a.metrics as ActivityMetrics;
      return { garminActivityId: a.id, day: a.day, sport: a.sport as Sport, load: m.load, loadMethod: m.loadMethod, startMs: m.startMs, endMs: m.endMs, bands: m.bands };
    }),
    strengthSessions: sessions,
    days: withFeel(dayInputs(dayRows), feelByDay),
  });

  await db.transaction(async (tx) => {
    await tx.delete(garminDailyMetrics).where(eq(garminDailyMetrics.userId, userId));
    for (let i = 0; i < daily.length; i += 200) {
      await tx.insert(garminDailyMetrics).values(
        daily.slice(i, i + 200).map((d) => ({ userId, day: d.date, modelVersion: DAILY_MODEL_VERSION, metrics: d })),
      );
    }
  });
  return daily.length;
}

export type MetricsStepResult = { reparsed: number; activities: number; days: number };

/** Run the metric steps for one user. Returns what it did; the caller records it. */
export async function runGarminMetricsStep(userId: string, now = new Date()): Promise<MetricsStepResult> {
  const [conn] = await db.select().from(garminConnections).where(eq(garminConnections.userId, userId));
  if (!conn) return { reparsed: 0, activities: 0, days: 0 };
  const [user] = await db.select({ gender: users.gender }).from(users).where(eq(users.id, userId));

  const reparsed = await reparse(userId);
  const activities = await computeActivities(userId, user?.gender === "female");
  const stillPending = (await pendingActivities(userId, 1)).length > 0;
  const upToDate = conn.metricsComputedAt !== null && conn.metricsVersion === DAILY_MODEL_VERSION && activities === 0 && reparsed === 0;
  if (stillPending || upToDate) return { reparsed, activities, days: 0 };

  const days = await buildDaily(userId, isoDate(now));
  await db
    .update(garminConnections)
    .set({ metricsComputedAt: now, metricsVersion: DAILY_MODEL_VERSION })
    .where(eq(garminConnections.userId, userId));
  return { reparsed, activities, days };
}

/** SQL condition: this connection has metric work to do. Used by the worker's claim. */
export const metricsDue = or(
  isNull(garminConnections.metricsComputedAt),
  sql`${garminConnections.metricsVersion} is distinct from ${DAILY_MODEL_VERSION}`,
);
