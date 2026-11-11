import { db } from "@/db";
import {
  garminActivities,
  garminActivityFiles,
  garminActivityStreams,
  garminConnections,
  garminDays,
  garminSyncRuns,
} from "@/db/schema";
import { env } from "@/lib/env";
import { decryptSecret } from "@/lib/utils/crypto";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { GarminError, exchangeKey, fetchActivityList, garminGet, garminGetBytes, type GarminToken } from "./client";
import {
  DAY_ENDPOINTS,
  RANGE_ENDPOINTS,
  SNAPSHOT_ENDPOINTS,
  isEmptyAnswer,
  type DayRow,
  type GarminDayKind,
} from "./endpoints";
import { addDays, chunkRange, isoDate } from "./dates";
import { parseFit } from "./fit";
import { stripActivityLocation } from "./location";
import { readZipEntry } from "./zip";

/**
 * Reading Garmin and saving what comes back.
 *
 * syncGarmin runs when the Garmin page opens (and on connect): the range
 * endpoints, snapshots and the activity list for recent days. It is quick, so
 * the page can wait for it. Per-day endpoints, activity files and history are
 * slower and run in the background worker (worker.ts), with the helpers below.
 */

/** Days fetched on the first sync after connecting. */
export const BACKFILL_DAYS = 30;
/** Later syncs go back this far before the last sync, for data a watch uploads late. */
const OVERLAP_DAYS = 3;
const STALE_MS = 10 * 60_000;
const RUNS_KEPT = 200;

// Access tokens last 24 h. Kept in memory per user so a sync doesn't swap the
// key for a new token every time; lost on restart, which only costs one call.
const tokens = new Map<string, GarminToken>();

export function rememberToken(userId: string, token: GarminToken) {
  tokens.set(userId, token);
}

export function forgetToken(userId: string) {
  tokens.delete(userId);
}

export async function tokenFor(userId: string, encryptedKey: string): Promise<string> {
  const cached = tokens.get(userId);
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
  const fresh = await exchangeKey(decryptSecret(encryptedKey, env.GARMIN_KEY_ENCRYPTION_KEY!));
  tokens.set(userId, fresh);
  return fresh.token;
}

/** Counts per kind written in one run, plus error tags of calls that failed without stopping the run. */
export class RunLog {
  counts: Record<string, number> = {};
  errors: string[] = [];
  add(kind: string, n: number) {
    this.counts[kind] = (this.counts[kind] ?? 0) + n;
  }
}

async function saveDays(userId: string, kind: GarminDayKind, rows: DayRow[], now: Date) {
  if (!rows.length) return;
  await db
    .insert(garminDays)
    .values(rows.map((r) => ({ userId, calendarDate: r.date, kind, data: r.data, fetchedAt: now })))
    .onConflictDoUpdate({
      target: [garminDays.userId, garminDays.calendarDate, garminDays.kind],
      set: { data: sql`excluded.data`, fetchedAt: sql`excluded.fetched_at` },
    });
}

/** Errors that must stop a run: the key is gone or Garmin wants us to slow down. */
export function isFatal(e: unknown): e is GarminError {
  return e instanceof GarminError && (e.tag === "key_rejected" || e.tag.startsWith("unauthorized") || e.tag.startsWith("rate_limited"));
}

async function each(log: RunLog, tag: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    if (isFatal(e) || !(e instanceof GarminError)) throw e;
    log.errors.push(e.tag.includes(":") ? e.tag : `${e.tag}:${tag}`);
  }
}

/** Every range endpoint for start..end. Rows outside the range are dropped (Garmin sometimes pads). */
export async function fetchRangeKinds(token: string, userId: string, start: string, end: string, log: RunLog, now = new Date()) {
  for (const ep of RANGE_ENDPOINTS) {
    for (const [s, e] of chunkRange(start, end, ep.maxDays)) {
      await each(log, ep.kind, async () => {
        const json = await garminGet(token, ep.path(s, e), ep.kind);
        const rows = isEmptyAnswer(json) ? [] : ep.split(json, s, e).filter((r) => r.date >= s && r.date <= e);
        await saveDays(userId, ep.kind, rows, now);
        log.add(ep.kind, rows.length);
      });
    }
  }
}

/** Every per-day endpoint for one date. */
export async function fetchDayKinds(token: string, userId: string, date: string, log: RunLog, now = new Date()) {
  const today = isoDate(now);
  for (const ep of DAY_ENDPOINTS) {
    await each(log, ep.kind, async () => {
      const json = await garminGet(token, ep.path(date, today), ep.kind);
      if (isEmptyAnswer(json) || ep.empty?.(json)) return;
      await saveDays(userId, ep.kind, [{ date, data: json }], now);
      log.add(ep.kind, 1);
    });
  }
}

export async function fetchSnapshots(token: string, userId: string, log: RunLog, now = new Date()) {
  for (const ep of SNAPSHOT_ENDPOINTS) {
    await each(log, ep.kind, async () => {
      const json = await garminGet(token, ep.path(), ep.kind);
      if (isEmptyAnswer(json)) return;
      await saveDays(userId, ep.kind, [{ date: isoDate(now), data: json }], now);
      log.add(ep.kind, 1);
    });
  }
}

/** The activity list for start..end. New activities get files_fetched_at null, so the worker fetches their files. */
export async function fetchActivities(token: string, userId: string, start: string, end: string, log: RunLog, now = new Date()) {
  await each(log, "activities", async () => {
    const list = await fetchActivityList(token, start, end);
    if (!list.length) return;
    await db
      .insert(garminActivities)
      .values(
        list.map((a) => ({
          userId,
          garminActivityId: a.activityId,
          startTimeLocal: new Date(`${a.startTimeLocal.replace(" ", "T")}Z`),
          activityType: a.activityType.typeKey,
          data: stripActivityLocation(a),
          fetchedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [garminActivities.userId, garminActivities.garminActivityId],
        set: {
          startTimeLocal: sql`excluded.start_time_local`,
          activityType: sql`excluded.activity_type`,
          data: sql`excluded.data`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
    log.add("activities", list.length);
  });
}

/**
 * Detail, planned workout and FIT file for one activity, with the FIT parsed
 * into streams. A failure is stored as files_error so the worker moves on.
 */
export async function fetchActivityFiles(token: string, userId: string, activityId: number, log: RunLog) {
  const where = and(eq(garminActivities.userId, userId), eq(garminActivities.garminActivityId, activityId));
  try {
    const detail = await garminGet(token, `/activity-service/activity/${activityId}`, "activity");
    const workouts = await garminGet(token, `/activity-service/activity/${activityId}/workouts`, "workouts");
    const zip = await garminGetBytes(token, `/download-service/files/activity/${activityId}`, "fit");
    const fit = readZipEntry(zip, ".fit");
    const parsed = fit ? parseFit(fit) : null;

    await db.transaction(async (tx) => {
      await tx
        .insert(garminActivityFiles)
        .values({ userId, garminActivityId: activityId, zip, sizeBytes: zip.length })
        .onConflictDoUpdate({
          target: [garminActivityFiles.userId, garminActivityFiles.garminActivityId],
          set: { zip, sizeBytes: zip.length, fetchedAt: new Date() },
        });
      if (parsed) {
        const values = {
          parserVersion: parsed.parserVersion,
          sport: parsed.sport,
          subSport: parsed.subSport,
          streams: parsed.streams,
          laps: parsed.laps,
          sets: parsed.sets,
          timeInZone: parsed.timeInZone,
          session: parsed.session,
          lengths: parsed.lengths,
          events: parsed.events,
          parsedAt: new Date(),
        };
        await tx
          .insert(garminActivityStreams)
          .values({ userId, garminActivityId: activityId, ...values })
          .onConflictDoUpdate({ target: [garminActivityStreams.userId, garminActivityStreams.garminActivityId], set: values });
      }
      await tx
        .update(garminActivities)
        .set({ detail: detail ?? null, workouts: workouts ?? null, filesFetchedAt: new Date(), filesError: null })
        .where(where);
    });
    log.add("activity_files", 1);
  } catch (e) {
    if (isFatal(e)) throw e;
    const tag = e instanceof GarminError ? e.tag : "parse_failed";
    if (!(e instanceof GarminError)) console.error("[fetchActivityFiles] failed", { userId, activityId }, e);
    await db.update(garminActivities).set({ filesError: tag, filesFetchedAt: new Date() }).where(where);
    log.errors.push(`${tag}:${activityId}`);
  }
}

/** Start a garmin_sync_runs row. */
export async function startRun(userId: string, trigger: "sync" | "worker", rangeStart: string, rangeEnd: string) {
  const [run] = await db
    .insert(garminSyncRuns)
    .values({ userId, trigger, rangeStart, rangeEnd, status: "running" })
    .returning({ id: garminSyncRuns.id });
  return run.id;
}

export async function finishRun(runId: number, userId: string, startedAt: Date, log: RunLog, fatal: string | null) {
  await db
    .update(garminSyncRuns)
    .set({
      status: fatal ? "error" : "ok",
      counts: { ...log.counts, ...(log.errors.length ? { failedCalls: log.errors.length } : {}) },
      error: fatal ?? (log.errors.length ? log.errors.slice(0, 5).join(", ") : null),
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    })
    .where(eq(garminSyncRuns.id, runId));
  // New rows mean the derived metrics are out of date (metrics-job.ts rebuilds them).
  if (Object.values(log.counts).some((n) => n > 0)) {
    await db.update(garminConnections).set({ metricsComputedAt: null }).where(eq(garminConnections.userId, userId));
  }
  const keep = db
    .select({ id: garminSyncRuns.id })
    .from(garminSyncRuns)
    .where(eq(garminSyncRuns.userId, userId))
    .orderBy(desc(garminSyncRuns.startedAt), desc(garminSyncRuns.id))
    .limit(RUNS_KEPT);
  await db.delete(garminSyncRuns).where(and(eq(garminSyncRuns.userId, userId), notInArray(garminSyncRuns.id, keep)));
}

export function fatalTag(e: unknown, userId: string, where: string): string {
  if (e instanceof GarminError) {
    if (e.tag === "key_rejected" || e.tag.startsWith("unauthorized")) forgetToken(userId);
    return e.tag;
  }
  console.error(`[${where}] unexpected`, { userId }, e);
  return "unexpected";
}

export type SyncResult = { status: "ok" | "skipped" | "not_connected" } | { status: "error"; error: string };

/** Recent data the Garmin page needs now: range endpoints, snapshots and the activity list. */
export async function syncGarmin(userId: string, { force = false } = {}): Promise<SyncResult> {
  const [conn] = await db.select().from(garminConnections).where(eq(garminConnections.userId, userId));
  if (!conn) return { status: "not_connected" };
  const now = new Date();
  if (!force && conn.lastSyncedAt && now.getTime() - conn.lastSyncedAt.getTime() < STALE_MS) return { status: "skipped" };

  // Garmin's calendar dates are the user's local dates; ending a day after
  // today's UTC date makes sure "today" is in range in every time zone.
  const rangeStart = isoDate(new Date((conn.lastSyncedAt ?? now).getTime() - (conn.lastSyncedAt ? OVERLAP_DAYS : BACKFILL_DAYS - 1) * 86_400_000));
  const rangeEnd = addDays(isoDate(now), 1);
  const runId = await startRun(userId, "sync", rangeStart, rangeEnd);
  const log = new RunLog();

  try {
    const token = await tokenFor(userId, conn.encryptedKey);
    await fetchRangeKinds(token, userId, rangeStart, rangeEnd, log, now);
    await fetchSnapshots(token, userId, log, now);
    await fetchActivities(token, userId, rangeStart, rangeEnd, log, now);
    await db.update(garminConnections).set({ lastSyncedAt: now }).where(eq(garminConnections.userId, userId));
    await finishRun(runId, userId, now, log, null);
    return log.errors.length ? { status: "error", error: log.errors[0] } : { status: "ok" };
  } catch (e) {
    const tag = fatalTag(e, userId, "syncGarmin");
    await finishRun(runId, userId, now, log, tag);
    return { status: "error", error: tag };
  }
}
