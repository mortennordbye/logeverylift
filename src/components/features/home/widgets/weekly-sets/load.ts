import { getWeeklyMuscleVolume } from "@/lib/actions/metrics";
import type { HomeContext } from "@/lib/home/core";

/** Sets this week in total, and the top muscle groups against their lower target. */
export type WeeklySetsData = { total: number; muscles: { name: string; sets: number; target: number }[] };

/**
 * From the user's own weekly volume (getWeeklyMuscleVolume runs
 * requireSession). Null with no sets this week, for the empty state.
 */
export async function loadWeeklySets(_ctx: HomeContext): Promise<WeeklySetsData | null> {
  const result = await getWeeklyMuscleVolume();
  if (!result.success) throw new Error("weekly volume read failed");
  if (result.data.length === 0) return null;
  return {
    total: result.data.reduce((sum, m) => sum + m.setCount, 0),
    muscles: result.data.slice(0, 4).map((m) => ({ name: m.muscleGroup, sets: m.setCount, target: m.targetMin })),
  };
}
