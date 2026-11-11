import { db } from "@/db";
import { garminConnections, garminDailyMetrics } from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import { TRACKS, type PmcPoint, type Track } from "./analytics/pmc";
import { SPORTS, type Sport } from "./analytics/sport";
import type { LoadSeries } from "./charts/load";

/**
 * Reads for the Garmin page's Server Components. Each takes a userId the
 * page already resolved with requireSession(); every query filters by it.
 */

const r1 = (n: number | null | undefined) => (typeof n === "number" ? Math.round(n * 10) / 10 : 0);

/** The daily series for the Load tab, as columns. Only the JSON paths the tab uses are read. */
export async function getLoadSeries(userId: string): Promise<{ series: LoadSeries; computedAt: string | null }> {
  const rows = await db
    .select({
      day: garminDailyMetrics.day,
      pmc: sql<Record<Track, PmcPoint>>`${garminDailyMetrics.metrics}->'pmc'`,
      bands: sql<{ low: number; mid: number; high: number }>`${garminDailyMetrics.metrics}->'bands'`,
      calibrating: sql<boolean>`(${garminDailyMetrics.metrics}->>'calibrating')::boolean`,
    })
    .from(garminDailyMetrics)
    .where(eq(garminDailyMetrics.userId, userId))
    .orderBy(asc(garminDailyMetrics.day));
  const [conn] = await db
    .select({ computedAt: garminConnections.metricsComputedAt })
    .from(garminConnections)
    .where(eq(garminConnections.userId, userId));

  const tracks = Object.fromEntries(TRACKS.map((t) => [t, { ctl: [] as number[], atl: [] as number[], tsb: [] as number[] }])) as LoadSeries["tracks"];
  const loads = Object.fromEntries(SPORTS.map((s) => [s, [] as number[]])) as Record<Sport, number[]>;
  const series: LoadSeries = { dates: [], calibrating: [], tracks, loads, bands: { low: [], mid: [], high: [] } };
  for (const row of rows) {
    series.dates.push(row.day);
    series.calibrating.push(Boolean(row.calibrating));
    for (const t of TRACKS) {
      const p = row.pmc?.[t];
      tracks[t].ctl.push(r1(p?.ctl));
      tracks[t].atl.push(r1(p?.atl));
      tracks[t].tsb.push(r1(p?.tsb));
    }
    for (const s of SPORTS) loads[s].push(r1(row.pmc?.[s]?.load));
    series.bands.low.push(Math.round(row.bands?.low ?? 0));
    series.bands.mid.push(Math.round(row.bands?.mid ?? 0));
    series.bands.high.push(Math.round(row.bands?.high ?? 0));
  }
  return { series, computedAt: conn?.computedAt?.toISOString() ?? null };
}
