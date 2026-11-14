import { getHeatmapData, getSummaryStats } from "@/lib/actions/metrics";
import type { HomeContext } from "@/lib/home/core";
import { weekCounts } from "@/lib/home/widget-data";

/** The streak in weeks, and sessions per week for the last 8 (the M size's bars). */
export type StreakData = { weeks: number; perWeek: number[] };

/**
 * Reads through the user's own actions (each runs requireSession): the
 * streak from getSummaryStats, the weekly bars from the heatmap's days.
 * Null without a streak, for the empty state.
 */
export async function loadStreak(ctx: HomeContext): Promise<StreakData | null> {
  const [stats, heatmap] = await Promise.all([getSummaryStats(), getHeatmapData()]);
  if (!stats.success || !heatmap.success) throw new Error("streak read failed");
  if (stats.data.currentStreakWeeks === 0) return null;
  return { weeks: stats.data.currentStreakWeeks, perWeek: weekCounts(heatmap.data, ctx.today, 8) };
}
