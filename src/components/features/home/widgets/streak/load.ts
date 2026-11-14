import { getHeatmapData } from "@/lib/actions/metrics";
import type { HomeContext } from "@/lib/home/core";
import { streakWeeks, weekCounts } from "@/lib/home/widget-data";

/** The streak in weeks, and sessions per week for the last 8 (the M size's bars). */
export type StreakData = { weeks: number; perWeek: number[] };

/**
 * Reads the heatmap's days through the user's own action (it runs
 * requireSession). Both the streak and the bars count Monday-to-Sunday weeks
 * of the sessions' own dates, around `ctx.today`, so the weeks are the user's
 * and not the server's UTC weeks. Null without a streak, for the empty state.
 */
export async function loadStreak(ctx: HomeContext): Promise<StreakData | null> {
  const heatmap = await getHeatmapData();
  if (!heatmap.success) throw new Error("streak read failed");
  const weeks = streakWeeks(heatmap.data, ctx.today);
  if (weeks === 0) return null;
  return { weeks, perWeek: weekCounts(heatmap.data, ctx.today, 8) };
}
