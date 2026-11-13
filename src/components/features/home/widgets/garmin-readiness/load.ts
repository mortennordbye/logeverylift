import { db } from "@/db";
import { garminConnections, garminDailyMetrics } from "@/db/schema";
import type { DailyMetrics } from "@/lib/garmin/analytics/daily";
import type { Readiness } from "@/lib/garmin/analytics/readiness";
import { garminAllowed } from "@/lib/garmin/access";
import type { HomeContext } from "@/lib/home/core";
import { and, desc, eq, lte } from "drizzle-orm";

export type GarminReadinessData = { connected: false } | { connected: true; readiness: Readiness | null };

/**
 * Today's readiness from the stored daily metrics, the same value the Garmin
 * Today tab shows (src/components/features/GarminTodayTab.tsx, ReadinessCard).
 * One indexed read of the newest row up to today, not the whole Today tab's
 * read. Garmin is for admin accounts only: the access is checked again here,
 * not only by the widget's audience.
 */
export async function loadGarminReadiness(ctx: HomeContext): Promise<GarminReadinessData | null> {
  if (!garminAllowed(ctx.role)) return null;
  const [connection] = await db
    .select({ id: garminConnections.id })
    .from(garminConnections)
    .where(eq(garminConnections.userId, ctx.userId));
  if (!connection) return { connected: false };
  const [row] = await db
    .select({ day: garminDailyMetrics.day, metrics: garminDailyMetrics.metrics })
    .from(garminDailyMetrics)
    .where(and(eq(garminDailyMetrics.userId, ctx.userId), lte(garminDailyMetrics.day, ctx.today)))
    .orderBy(desc(garminDailyMetrics.day))
    .limit(1);
  const readiness = row && row.day === ctx.today ? ((row.metrics as DailyMetrics).readiness ?? null) : null;
  return { connected: true, readiness };
}
