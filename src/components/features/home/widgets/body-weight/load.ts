import { getWeightHistory } from "@/lib/actions/profile";
import type { HomeContext } from "@/lib/home/core";
import { weightSummary, type WeightSummary } from "@/lib/home/widget-data";
import { getUserSettings } from "@/lib/user-settings";
import { localDateStr } from "@/lib/utils/user-date";

/**
 * The latest body weight and the last 30 days, from the user's own weight
 * log (getWeightHistory runs requireSession). Dates in the user's zone.
 * Null without any entry, for the empty state.
 */
export async function loadBodyWeight(ctx: HomeContext): Promise<WeightSummary | null> {
  const [result, { timeZone }] = await Promise.all([getWeightHistory(), getUserSettings(ctx.userId)]);
  if (!result.success) throw new Error("weight read failed");
  const entries = result.data.map((e) => {
    const at = new Date(e.recordedAt);
    return { kg: e.weightKg, date: localDateStr(at, timeZone), at: at.getTime() };
  });
  return weightSummary(entries, ctx.today, 30);
}
