"use server";

import { db } from "@/db";
import {
  garminActivities,
  garminActivityFiles,
  garminActivityMetrics,
  garminActivityStreams,
  garminConnections,
  garminDailyMetrics,
  garminDays,
  garminFuelLogs,
  garminSyncRuns,
  users,
} from "@/db/schema";
import { env } from "@/lib/env";
import { GarminError, exchangeKey } from "@/lib/garmin/client";
import { forgetToken, rememberToken, syncGarmin } from "@/lib/garmin/sync";
import { GARMIN_DAY_KINDS, endpointLabel } from "@/lib/garmin/endpoints";
import { runGarminMetricsStep } from "@/lib/garmin/metrics-job";
import { garminWorkerLoop, historyFloor } from "@/lib/garmin/worker";
import { encryptSecret } from "@/lib/utils/crypto";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const DISABLED = "Garmin is not enabled on this server";


const connectSchema = z.object({ apiKey: z.string().trim().min(20).max(1000) });

/**
 * Pull recent data from Garmin now (the refresh button), then rebuild the
 * derived metrics. The background worker does the same every 30 minutes.
 */
export async function refreshGarmin(): Promise<ActionResult<{ syncError: string | null }>> {
  const auth = await requireSession();
  if (!env.GARMIN_KEY_ENCRYPTION_KEY) return { success: false, error: DISABLED };
  try {
    const sync = await syncGarmin(auth.user.id, { force: true });
    if (sync.status === "not_connected") return { success: false, error: "Garmin is not connected" };
    await runGarminMetricsStep(auth.user.id);
    revalidatePath("/more/garmin");
    return { success: true, data: { syncError: sync.status === "error" ? sync.error : null } };
  } catch (e) {
    console.error("[refreshGarmin] failed", { userId: auth.user.id }, e);
    return { success: false, error: "Failed to refresh from Garmin" };
  }
}

/** Check a Personal API key with Garmin, store it encrypted and run the first sync. */
export async function connectGarmin(data: unknown): Promise<ActionResult<{ syncError: string | null }>> {
  const auth = await requireSession();
  if (!env.GARMIN_KEY_ENCRYPTION_KEY) return { success: false, error: DISABLED };
  const parsed = connectSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Paste the whole key", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const token = await exchangeKey(parsed.data.apiKey);
    const encryptedKey = encryptSecret(parsed.data.apiKey, env.GARMIN_KEY_ENCRYPTION_KEY);
    await db
      .insert(garminConnections)
      .values({ userId: auth.user.id, encryptedKey })
      .onConflictDoUpdate({ target: garminConnections.userId, set: { encryptedKey } });
    rememberToken(auth.user.id, token);
    const sync = await syncGarmin(auth.user.id, { force: true });
    // Start the background import now instead of at the next timer tick.
    void garminWorkerLoop();
    revalidatePath("/settings");
    revalidatePath("/more/garmin");
    return { success: true, data: { syncError: sync.status === "error" ? sync.error : null } };
  } catch (e) {
    if (e instanceof GarminError) {
      return {
        success: false,
        error: e.tag === "key_rejected" ? "Garmin did not accept this key. Check that it is complete and not expired." : "Could not reach Garmin. Try again.",
      };
    }
    console.error("[connectGarmin] failed", { userId: auth.user.id }, e);
    return { success: false, error: "Failed to connect Garmin" };
  }
}

const disconnectSchema = z.object({ deleteData: z.boolean() });

/** Remove the stored key. With deleteData, also every stored Garmin row for this user. */
export async function disconnectGarmin(data: unknown): Promise<ActionResult> {
  const auth = await requireSession();
  const parsed = disconnectSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  const userId = auth.user.id;

  try {
    await db.transaction(async (tx) => {
      await tx.delete(garminConnections).where(eq(garminConnections.userId, userId));
      if (parsed.data.deleteData) {
        await tx.delete(garminDays).where(eq(garminDays.userId, userId));
        await tx.delete(garminDailyMetrics).where(eq(garminDailyMetrics.userId, userId));
        await tx.delete(garminActivityMetrics).where(eq(garminActivityMetrics.userId, userId));
        await tx.delete(garminActivityStreams).where(eq(garminActivityStreams.userId, userId));
        await tx.delete(garminActivityFiles).where(eq(garminActivityFiles.userId, userId));
        await tx.delete(garminActivities).where(eq(garminActivities.userId, userId));
        await tx.delete(garminSyncRuns).where(eq(garminSyncRuns.userId, userId));
        await tx.delete(garminFuelLogs).where(eq(garminFuelLogs.userId, userId));
      }
    });
    forgetToken(userId);
    revalidatePath("/settings");
    revalidatePath("/more/garmin");
    return { success: true, data: undefined };
  } catch (e) {
    console.error("[disconnectGarmin] failed", { userId }, e);
    return { success: false, error: "Failed to disconnect Garmin" };
  }
}

export type GarminSyncRunView = {
  startedAt: string;
  status: "running" | "ok" | "error";
  rangeStart: string;
  rangeEnd: string;
  counts: Record<string, number> | null;
  error: string | null;
  durationMs: number | null;
};

export type GarminImportStatus = {
  connected: boolean;
  historyCursor: string | null;
  historyDone: boolean;
  historyFloor: string | null;
  pausedUntil: string | null;
  daysStored: number;
  oldestDay: string | null;
  activities: number;
  activitiesWithFiles: number;
  activitiesPending: number;
  activitiesFailed: number;
  storedBytes: number;
};

export type GarminExplorerKind = { kind: string; label: string; fetchedAt: string; bytes: number; fields: number; data: unknown };
export type GarminExplorerActivity = {
  id: number;
  type: string;
  startTimeLocal: string;
  filesError: string | null;
  hasDetail: boolean;
  fileBytes: number | null;
  streamPoints: Record<string, number> | null;
  sets: number;
  laps: number;
};

export type GarminExplorerDay = {
  date: string;
  status: GarminImportStatus;
  kinds: GarminExplorerKind[];
  activities: GarminExplorerActivity[];
  runs: (GarminSyncRunView & { trigger: string })[];
};

const explorerSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Everything stored for one date, with import status. Read only: never calls Garmin. */
export async function getGarminDay(data: unknown): Promise<ActionResult<GarminExplorerDay>> {
  const auth = await requireSession();
  if (!env.GARMIN_KEY_ENCRYPTION_KEY) return { success: false, error: DISABLED };
  const parsed = explorerSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  const userId = auth.user.id;
  const { date } = parsed.data;

  try {
    const [conn] = await db.select().from(garminConnections).where(eq(garminConnections.userId, userId));
    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
    const [days] = await db
      .select({
        count: sql<number>`count(distinct ${garminDays.calendarDate})::int`,
        oldest: sql<string | null>`min(${garminDays.calendarDate})::text`,
        bytes: sql<number>`coalesce(sum(pg_column_size(${garminDays.data})), 0)::bigint`,
      })
      .from(garminDays)
      .where(eq(garminDays.userId, userId));
    const [acts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        withFiles: sql<number>`count(*) filter (where ${garminActivities.filesFetchedAt} is not null and ${garminActivities.filesError} is null)::int`,
        pending: sql<number>`count(*) filter (where ${garminActivities.filesFetchedAt} is null)::int`,
        failed: sql<number>`count(*) filter (where ${garminActivities.filesError} is not null)::int`,
        bytes: sql<number>`coalesce(sum(pg_column_size(${garminActivities.data}) + coalesce(pg_column_size(${garminActivities.detail}), 0)), 0)::bigint`,
      })
      .from(garminActivities)
      .where(eq(garminActivities.userId, userId));
    const [files] = await db
      .select({ bytes: sql<number>`coalesce(sum(${garminActivityFiles.sizeBytes}), 0)::bigint` })
      .from(garminActivityFiles)
      .where(eq(garminActivityFiles.userId, userId));
    const [streams] = await db
      .select({ bytes: sql<number>`coalesce(sum(pg_column_size(${garminActivityStreams.streams})), 0)::bigint` })
      .from(garminActivityStreams)
      .where(eq(garminActivityStreams.userId, userId));

    const kindRows = await db
      .select({
        kind: garminDays.kind,
        fetchedAt: garminDays.fetchedAt,
        data: garminDays.data,
        bytes: sql<number>`pg_column_size(${garminDays.data})::int`,
      })
      .from(garminDays)
      .where(and(eq(garminDays.userId, userId), eq(garminDays.calendarDate, date)));

    const dayStart = new Date(`${date}T00:00:00Z`);
    const activityRows = await db
      .select({
        id: garminActivities.garminActivityId,
        type: garminActivities.activityType,
        start: garminActivities.startTimeLocal,
        filesError: garminActivities.filesError,
        hasDetail: sql<boolean>`${garminActivities.detail} is not null`,
        fileBytes: garminActivityFiles.sizeBytes,
        streamPoints: sql<Record<string, number> | null>`(select jsonb_object_agg(k, jsonb_array_length(v)) from jsonb_each(${garminActivityStreams.streams}) as s(k, v))`,
        sets: sql<number>`coalesce(jsonb_array_length(${garminActivityStreams.sets}), 0)::int`,
        laps: sql<number>`coalesce(jsonb_array_length(${garminActivityStreams.laps}), 0)::int`,
      })
      .from(garminActivities)
      .leftJoin(
        garminActivityFiles,
        and(eq(garminActivityFiles.userId, garminActivities.userId), eq(garminActivityFiles.garminActivityId, garminActivities.garminActivityId)),
      )
      .leftJoin(
        garminActivityStreams,
        and(eq(garminActivityStreams.userId, garminActivities.userId), eq(garminActivityStreams.garminActivityId, garminActivities.garminActivityId)),
      )
      .where(
        and(
          eq(garminActivities.userId, userId),
          gte(garminActivities.startTimeLocal, dayStart),
          lt(garminActivities.startTimeLocal, new Date(dayStart.getTime() + 86_400_000)),
        ),
      )
      .orderBy(garminActivities.startTimeLocal);

    const runs = await db
      .select()
      .from(garminSyncRuns)
      .where(eq(garminSyncRuns.userId, userId))
      .orderBy(desc(garminSyncRuns.startedAt), desc(garminSyncRuns.id))
      .limit(20);

    const order = new Map<string, number>(GARMIN_DAY_KINDS.map((k, i) => [k, i]));
    return {
      success: true,
      data: {
        date,
        status: {
          connected: Boolean(conn),
          historyCursor: conn?.historyCursor ?? null,
          historyDone: conn?.historyDone ?? false,
          historyFloor: historyFloor(user?.role ?? null, new Date().toISOString().slice(0, 10)),
          pausedUntil: conn?.pausedUntil && conn.pausedUntil > new Date() ? conn.pausedUntil.toISOString() : null,
          daysStored: days.count,
          oldestDay: days.oldest,
          activities: acts.total,
          activitiesWithFiles: acts.withFiles,
          activitiesPending: acts.pending,
          activitiesFailed: acts.failed,
          storedBytes: Number(days.bytes) + Number(acts.bytes) + Number(files.bytes) + Number(streams.bytes),
        },
        kinds: kindRows
          .sort((a, b) => (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99))
          .map((r) => ({
            kind: r.kind,
            label: endpointLabel(r.kind),
            fetchedAt: r.fetchedAt.toISOString(),
            bytes: r.bytes,
            fields: r.data && typeof r.data === "object" ? Object.keys(r.data).length : 0,
            data: r.data,
          })),
        activities: activityRows.map((a) => ({
          id: a.id,
          type: a.type,
          startTimeLocal: a.start.toISOString().slice(0, 19).replace("T", " "),
          filesError: a.filesError,
          hasDetail: a.hasDetail,
          fileBytes: a.fileBytes,
          streamPoints: a.streamPoints,
          sets: a.sets,
          laps: a.laps,
        })),
        runs: runs.map((r) => ({
          startedAt: r.startedAt.toISOString(),
          status: r.status,
          trigger: r.trigger,
          rangeStart: r.rangeStart,
          rangeEnd: r.rangeEnd,
          counts: (r.counts as Record<string, number> | null) ?? null,
          error: r.error,
          durationMs: r.durationMs,
        })),
      },
    };
  } catch (e) {
    console.error("[getGarminDay] failed", { userId }, e);
    return { success: false, error: "Failed to load Garmin data" };
  }
}

const activityRawSchema = z.object({ id: z.number().int().positive() });

/** One activity's stored JSON: summary, detail, planned workout, FIT session, laps, sets, and the first stream points. */
export async function getGarminActivityRaw(data: unknown): Promise<ActionResult<Record<string, unknown>>> {
  const auth = await requireSession();
  if (!env.GARMIN_KEY_ENCRYPTION_KEY) return { success: false, error: DISABLED };
  const parsed = activityRawSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  const userId = auth.user.id;
  try {
    const [a] = await db
      .select()
      .from(garminActivities)
      .where(and(eq(garminActivities.userId, userId), eq(garminActivities.garminActivityId, parsed.data.id)));
    if (!a) return { success: false, error: "Not found" };
    const [s] = await db
      .select()
      .from(garminActivityStreams)
      .where(and(eq(garminActivityStreams.userId, userId), eq(garminActivityStreams.garminActivityId, parsed.data.id)));
    const streams = (s?.streams ?? {}) as Record<string, unknown[]>;
    return {
      success: true,
      data: {
        summary: a.data,
        detail: a.detail,
        workouts: a.workouts,
        fit: s
          ? {
              parserVersion: s.parserVersion,
              sport: s.sport,
              subSport: s.subSport,
              session: s.session,
              laps: s.laps,
              sets: s.sets,
              timeInZone: s.timeInZone,
              streamsFirst20: Object.fromEntries(Object.entries(streams).map(([k, v]) => [k, v.slice(0, 20)])),
            }
          : null,
      },
    };
  } catch (e) {
    console.error("[getGarminActivityRaw] failed", { userId }, e);
    return { success: false, error: "Failed to load activity" };
  }
}

const saveFuelLogSchema = z.object({
  activityId: z.number().int().positive(),
  carbsG: z.number().int().min(0).max(2000).nullable(),
  fluidMl: z.number().int().min(0).max(20000).nullable(),
});

/** Carbohydrate and fluid taken during one of the user's own Garmin sessions. Both null clears the log. */
export async function saveFuelLog(data: unknown): Promise<ActionResult<{ carbsG: number | null; fluidMl: number | null }>> {
  const auth = await requireSession();
  const parsed = saveFuelLogSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { activityId, carbsG, fluidMl } = parsed.data;
  try {
    const [owned] = await db
      .select({ id: garminActivities.id })
      .from(garminActivities)
      .where(and(eq(garminActivities.userId, auth.user.id), eq(garminActivities.garminActivityId, activityId)));
    if (!owned) return { success: false, error: "Activity not found" };
    if (carbsG === null && fluidMl === null) {
      await db.delete(garminFuelLogs).where(and(eq(garminFuelLogs.userId, auth.user.id), eq(garminFuelLogs.garminActivityId, activityId)));
    } else {
      await db
        .insert(garminFuelLogs)
        .values({ userId: auth.user.id, garminActivityId: activityId, carbsG, fluidMl })
        .onConflictDoUpdate({ target: [garminFuelLogs.userId, garminFuelLogs.garminActivityId], set: { carbsG, fluidMl, updatedAt: new Date() } });
    }
    revalidatePath(`/more/garmin/activity/${activityId}`);
    revalidatePath("/more/garmin/race");
    return { success: true, data: { carbsG, fluidMl } };
  } catch (e) {
    console.error("[saveFuelLog] failed", { activityId }, e instanceof Error ? e.message : "unknown");
    return { success: false, error: "Failed to save" };
  }
}
