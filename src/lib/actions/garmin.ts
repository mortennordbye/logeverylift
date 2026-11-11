"use server";

import { db } from "@/db";
import { garminActivities, garminConnections, garminDays, garminSyncRuns } from "@/db/schema";
import { env } from "@/lib/env";
import { GarminError, exchangeKey } from "@/lib/garmin/client";
import { buildGarminMetrics, type GarminMetrics } from "@/lib/garmin/metrics";
import { forgetToken, rememberToken, syncGarmin } from "@/lib/garmin/sync";
import { encryptSecret } from "@/lib/utils/crypto";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { and, desc, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const DISABLED = "Garmin is not enabled on this server";

/** Days of stored data the Garmin tab shows: four weeks of dailies, eight weeks of load. */
const VIEW_DAYS = 56;

const connectSchema = z.object({ apiKey: z.string().trim().min(20).max(1000) });

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
    revalidatePath("/settings");
    revalidatePath("/more/metrics");
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
        await tx.delete(garminActivities).where(eq(garminActivities.userId, userId));
        await tx.delete(garminSyncRuns).where(eq(garminSyncRuns.userId, userId));
      }
    });
    forgetToken(userId);
    revalidatePath("/settings");
    revalidatePath("/more/metrics");
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

export type GarminTabData = {
  connected: boolean;
  lastSyncedAt: string | null;
  syncError: string | null;
  metrics: GarminMetrics;
  runs: GarminSyncRunView[];
};

const metricsSchema = z.object({ refresh: z.boolean().default(false) });

/**
 * Sync from Garmin when connected (skipped if the last sync is under ten
 * minutes old, unless refresh), then return the stored days and activities.
 * Stored data is returned even after a disconnect, so history stays visible.
 */
export async function getGarminMetrics(data: unknown): Promise<ActionResult<GarminTabData>> {
  const auth = await requireSession();
  if (!env.GARMIN_KEY_ENCRYPTION_KEY) return { success: false, error: DISABLED };
  const parsed = metricsSchema.safeParse(data ?? {});
  if (!parsed.success) return { success: false, error: "Invalid input" };
  const userId = auth.user.id;

  try {
    const sync = await syncGarmin(userId, { force: parsed.data.refresh });

    const today = new Date();
    const end = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
    const start = new Date(today.getTime() - (VIEW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);

    const [conn] = await db
      .select({ lastSyncedAt: garminConnections.lastSyncedAt })
      .from(garminConnections)
      .where(eq(garminConnections.userId, userId));
    const dayRows = await db
      .select({ calendarDate: garminDays.calendarDate, kind: garminDays.kind, data: garminDays.data })
      .from(garminDays)
      .where(and(eq(garminDays.userId, userId), gte(garminDays.calendarDate, start)));
    const activityRows = await db
      .select({ garminActivityId: garminActivities.garminActivityId, data: garminActivities.data })
      .from(garminActivities)
      .where(and(eq(garminActivities.userId, userId), gte(garminActivities.startTimeLocal, new Date(`${start}T00:00:00Z`))));
    const runs = await db
      .select()
      .from(garminSyncRuns)
      .where(eq(garminSyncRuns.userId, userId))
      .orderBy(desc(garminSyncRuns.startedAt), desc(garminSyncRuns.id))
      .limit(10);

    return {
      success: true,
      data: {
        connected: Boolean(conn),
        lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
        syncError: sync.status === "error" ? sync.error : null,
        // Drop the padding day after today unless Garmin already has data for it.
        metrics: trimFuture(buildGarminMetrics(dayRows, activityRows, start, end)),
        runs: runs.map((r) => ({
          startedAt: r.startedAt.toISOString(),
          status: r.status,
          rangeStart: r.rangeStart,
          rangeEnd: r.rangeEnd,
          counts: (r.counts as Record<string, number> | null) ?? null,
          error: r.error,
          durationMs: r.durationMs,
        })),
      },
    };
  } catch (e) {
    console.error("[getGarminMetrics] failed", { userId }, e);
    return { success: false, error: "Failed to load Garmin data" };
  }
}

function trimFuture(m: GarminMetrics): GarminMetrics {
  const last = m.days.at(-1);
  const empty = last && Object.entries(last).every(([k, v]) => k === "date" || v === null);
  return empty ? { ...m, days: m.days.slice(0, -1) } : m;
}
