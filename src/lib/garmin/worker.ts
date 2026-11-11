import { db } from "@/db";
import { garminActivities, garminConnections, users } from "@/db/schema";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { GarminError } from "./client";
import { addDays, isoDate } from "./dates";
import {
  RunLog,
  fatalTag,
  fetchActivities,
  fetchActivityFiles,
  fetchDayKinds,
  fetchRangeKinds,
  finishRun,
  startRun,
  tokenFor,
} from "./sync";

/**
 * Background import of everything the quick sync leaves out: per-day data
 * (all-day heart rate, overnight HRV, SpO2, ...), activity files, and history.
 *
 * Started from src/instrumentation.ts. Each tick claims one connection that
 * has work, with a lease so two app replicas never run the same user, and
 * does a bounded amount of work for it:
 *
 * 1. Today and yesterday's per-day data again, at most every RECENT_EVERY_MS.
 * 2. Up to FILES_PER_TICK activities still without files, newest first.
 * 3. One HISTORY_CHUNK_DAYS chunk of history, going back from historyCursor.
 *
 * History stops HISTORY_DAYS_USER days back for a normal user, and for an
 * admin after EMPTY_CHUNKS_TO_STOP chunks in a row with nothing in them.
 */

export const TICK_MS = 60_000;
const LEASE_MS = 5 * 60_000;
const RECENT_EVERY_MS = 30 * 60_000;
const FILES_PER_TICK = 5;
export const HISTORY_CHUNK_DAYS = 7;
export const HISTORY_DAYS_USER = 90;
const EMPTY_CHUNKS_TO_STOP = 8;
/** Pause after a 429 when Garmin gives no retryInSeconds. */
const RATE_LIMIT_PAUSE_MS = 2 * 60_000;
const KEY_REJECTED_PAUSE_MS = 24 * 3600_000;

/** Oldest date history goes back to for this user; null means no limit. */
export function historyFloor(role: string | null, today: string): string | null {
  return role === "admin" ? null : addDays(today, -(HISTORY_DAYS_USER - 1));
}

/** Claim one connection with work to do. Null when there is none. */
async function claim(now: Date) {
  const free = and(
    or(isNull(garminConnections.leaseUntil), lt(garminConnections.leaseUntil, now)),
    or(isNull(garminConnections.pausedUntil), lt(garminConnections.pausedUntil, now)),
  );
  const hasPendingFiles = sql`exists (select 1 from ${garminActivities} a where a.user_id = ${garminConnections.userId} and a.files_fetched_at is null)`;
  const recentDue = or(isNull(garminConnections.recentDetailAt), lt(garminConnections.recentDetailAt, new Date(now.getTime() - RECENT_EVERY_MS)));
  const [candidate] = await db
    .select({ id: garminConnections.id })
    .from(garminConnections)
    .where(and(free, or(eq(garminConnections.historyDone, false), hasPendingFiles, recentDue)))
    .orderBy(garminConnections.leaseUntil)
    .limit(1);
  if (!candidate) return null;
  // Conditional update: only one replica wins the lease.
  const [claimed] = await db
    .update(garminConnections)
    .set({ leaseUntil: new Date(now.getTime() + LEASE_MS) })
    .where(and(eq(garminConnections.id, candidate.id), free))
    .returning();
  return claimed ?? null;
}

export type TickResult = { status: "idle" } | { status: "ran"; userId: string; error: string | null };

export async function runGarminWorkerTick(now = new Date()): Promise<TickResult> {
  const conn = await claim(now);
  if (!conn) return { status: "idle" };
  const userId = conn.userId;
  const today = isoDate(now);
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  const floor = historyFloor(user?.role ?? null, today);

  // The chunk this tick imports, if any: HISTORY_CHUNK_DAYS days ending the day before the cursor.
  const chunkEnd = conn.historyDone ? null : conn.historyCursor ? addDays(conn.historyCursor, -1) : today;
  const chunkStartRaw = chunkEnd ? addDays(chunkEnd, -(HISTORY_CHUNK_DAYS - 1)) : null;
  const chunkStart = chunkStartRaw && floor && chunkStartRaw < floor ? floor : chunkStartRaw;
  const runId = await startRun(userId, "worker", chunkStart ?? today, chunkEnd ?? today);
  const log = new RunLog();
  let fatal: string | null = null;

  try {
    const token = await tokenFor(userId, conn.encryptedKey);

    if (!conn.recentDetailAt || now.getTime() - conn.recentDetailAt.getTime() > RECENT_EVERY_MS) {
      for (const date of [addDays(today, -1), today]) await fetchDayKinds(token, userId, date, log, now);
      await db.update(garminConnections).set({ recentDetailAt: now }).where(eq(garminConnections.id, conn.id));
    }

    const pending = await db
      .select({ id: garminActivities.garminActivityId })
      .from(garminActivities)
      .where(and(eq(garminActivities.userId, userId), isNull(garminActivities.filesFetchedAt)))
      .orderBy(desc(garminActivities.startTimeLocal))
      .limit(FILES_PER_TICK);
    for (const a of pending) await fetchActivityFiles(token, userId, a.id, log);

    if (chunkStart && chunkEnd && (!floor || chunkEnd >= floor)) {
      const before = Object.values(log.counts).reduce((a, b) => a + b, 0);
      await fetchRangeKinds(token, userId, chunkStart, chunkEnd, log, now);
      await fetchActivities(token, userId, chunkStart, chunkEnd, log, now);
      for (let d = chunkEnd; d >= chunkStart; d = addDays(d, -1)) await fetchDayKinds(token, userId, d, log, now);
      const found = Object.values(log.counts).reduce((a, b) => a + b, 0) - before;

      const reachedFloor = floor !== null && chunkStart <= floor;
      const emptyStreak = found > 0 ? 0 : (conn.historyEmptyChunks ?? 0) + 1;
      await db
        .update(garminConnections)
        .set({
          historyCursor: chunkStart,
          historyEmptyChunks: emptyStreak,
          historyDone: reachedFloor || (floor === null && emptyStreak >= EMPTY_CHUNKS_TO_STOP),
        })
        .where(eq(garminConnections.id, conn.id));
    } else if (!conn.historyDone) {
      await db.update(garminConnections).set({ historyDone: true }).where(eq(garminConnections.id, conn.id));
    }
  } catch (e) {
    fatal = fatalTag(e, userId, "runGarminWorkerTick");
    const retry = e instanceof GarminError && e.retryInSeconds !== null ? (e.retryInSeconds + 5) * 1000 : RATE_LIMIT_PAUSE_MS;
    const pause = fatal.startsWith("rate_limited") ? retry : fatal === "key_rejected" ? KEY_REJECTED_PAUSE_MS : 0;
    if (pause) await db.update(garminConnections).set({ pausedUntil: new Date(Date.now() + pause) }).where(eq(garminConnections.id, conn.id));
  } finally {
    await db.update(garminConnections).set({ leaseUntil: null }).where(eq(garminConnections.id, conn.id));
    await finishRun(runId, userId, now, log, fatal);
  }
  return { status: "ran", userId, error: fatal };
}

let running = false;

/** One tick at a time per process; errors are logged, never thrown into the timer. */
export async function garminWorkerLoop() {
  if (running) return;
  running = true;
  try {
    // Keep going while there is work, so an import doesn't wait a minute between chunks.
    for (let i = 0; i < 10; i++) {
      const r = await runGarminWorkerTick();
      if (r.status === "idle") break;
    }
  } catch (e) {
    console.error("[garminWorkerLoop] failed", e instanceof Error ? e.message : "unknown");
  } finally {
    running = false;
  }
}
