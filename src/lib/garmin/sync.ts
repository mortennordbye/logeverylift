import { db } from "@/db";
import { garminActivities, garminConnections, garminDays, garminSyncRuns } from "@/db/schema";
import { env } from "@/lib/env";
import { decryptSecret } from "@/lib/utils/crypto";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { GarminError, exchangeKey, fetchGarminRange, type GarminToken } from "./client";
import { stripActivityLocation } from "./metrics";

/**
 * Pull a user's recent Garmin data and save it (garmin_days,
 * garmin_activities), with one garmin_sync_runs row per attempt.
 *
 * Called when the Garmin tab opens. A sync within STALE_MS of the last one is
 * skipped unless forced (the tab's Refresh button), so switching tabs doesn't
 * call Garmin each time.
 */

/** Days fetched on the first sync after connecting. */
export const BACKFILL_DAYS = 30;
/** Later syncs go back this far before the last sync, for data a watch uploads late. */
const OVERLAP_DAYS = 3;
const STALE_MS = 10 * 60_000;
const RUNS_KEPT = 50;

// Access tokens last 24 h. Kept in memory per user so a sync doesn't swap the
// key for a new token every time; lost on restart, which only costs one call.
const tokens = new Map<string, GarminToken>();

export function rememberToken(userId: string, token: GarminToken) {
  tokens.set(userId, token);
}

export function forgetToken(userId: string) {
  tokens.delete(userId);
}

async function tokenFor(userId: string, encryptedKey: string): Promise<string> {
  const cached = tokens.get(userId);
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
  const fresh = await exchangeKey(decryptSecret(encryptedKey, env.GARMIN_KEY_ENCRYPTION_KEY!));
  tokens.set(userId, fresh);
  return fresh.token;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysBefore(d: Date, n: number) {
  return new Date(d.getTime() - n * 86_400_000);
}

export type SyncResult = { status: "ok" | "skipped" | "not_connected" } | { status: "error"; error: string };

export async function syncGarmin(userId: string, { force = false } = {}): Promise<SyncResult> {
  const [conn] = await db.select().from(garminConnections).where(eq(garminConnections.userId, userId));
  if (!conn) return { status: "not_connected" };
  const now = new Date();
  if (!force && conn.lastSyncedAt && now.getTime() - conn.lastSyncedAt.getTime() < STALE_MS) return { status: "skipped" };

  // Garmin's calendar dates are the user's local dates; ending a day after
  // today's UTC date makes sure "today" is in range in every time zone.
  const rangeStart = isoDate(conn.lastSyncedAt ? daysBefore(conn.lastSyncedAt, OVERLAP_DAYS) : daysBefore(now, BACKFILL_DAYS - 1));
  const rangeEnd = isoDate(daysBefore(now, -1));

  const [run] = await db
    .insert(garminSyncRuns)
    .values({ userId, rangeStart, rangeEnd, status: "running" })
    .returning({ id: garminSyncRuns.id });

  try {
    const range = await fetchGarminRange(await tokenFor(userId, conn.encryptedKey), rangeStart, rangeEnd);

    const dayRows = (["hrv", "sleep", "daily"] as const).flatMap((kind) =>
      range[kind]
        .filter((d): d is typeof d & { calendarDate: string } => typeof d.calendarDate === "string")
        .map((d) => ({ userId, calendarDate: d.calendarDate, kind, data: d, fetchedAt: now })),
    );
    const activityRows = range.activities.map((a) => ({
      userId,
      garminActivityId: a.activityId,
      startTimeLocal: new Date(`${a.startTimeLocal.replace(" ", "T")}Z`),
      activityType: a.activityType.typeKey,
      data: stripActivityLocation(a),
      fetchedAt: now,
    }));

    await db.transaction(async (tx) => {
      if (dayRows.length) {
        await tx
          .insert(garminDays)
          .values(dayRows)
          .onConflictDoUpdate({
            target: [garminDays.userId, garminDays.calendarDate, garminDays.kind],
            set: { data: sql`excluded.data`, fetchedAt: sql`excluded.fetched_at` },
          });
      }
      if (activityRows.length) {
        await tx
          .insert(garminActivities)
          .values(activityRows)
          .onConflictDoUpdate({
            target: [garminActivities.userId, garminActivities.garminActivityId],
            set: {
              startTimeLocal: sql`excluded.start_time_local`,
              activityType: sql`excluded.activity_type`,
              data: sql`excluded.data`,
              fetchedAt: sql`excluded.fetched_at`,
            },
          });
      }
      await tx.update(garminConnections).set({ lastSyncedAt: now }).where(eq(garminConnections.userId, userId));
    });

    const counts = {
      hrv: dayRows.filter((r) => r.kind === "hrv").length,
      sleep: dayRows.filter((r) => r.kind === "sleep").length,
      daily: dayRows.filter((r) => r.kind === "daily").length,
      activities: activityRows.length,
    };
    await finishRun(run.id, userId, now, { status: "ok", counts });
    return { status: "ok" };
  } catch (e) {
    const tag = e instanceof GarminError ? e.tag : "unexpected";
    if (tag === "key_rejected" || tag.startsWith("unauthorized")) forgetToken(userId);
    if (!(e instanceof GarminError)) console.error("[syncGarmin] unexpected", { userId, runId: run.id }, e);
    await finishRun(run.id, userId, now, { status: "error", error: tag });
    return { status: "error", error: tag };
  }
}

async function finishRun(
  runId: number,
  userId: string,
  startedAt: Date,
  result: { status: "ok"; counts: Record<string, number> } | { status: "error"; error: string },
) {
  await db
    .update(garminSyncRuns)
    .set({ ...result, finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() })
    .where(eq(garminSyncRuns.id, runId));
  const keep = db
    .select({ id: garminSyncRuns.id })
    .from(garminSyncRuns)
    .where(eq(garminSyncRuns.userId, userId))
    .orderBy(desc(garminSyncRuns.startedAt), desc(garminSyncRuns.id))
    .limit(RUNS_KEPT);
  await db.delete(garminSyncRuns).where(and(eq(garminSyncRuns.userId, userId), notInArray(garminSyncRuns.id, keep)));
}
