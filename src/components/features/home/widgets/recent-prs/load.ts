import { formatPrValue, prTypeLabel } from "@/components/features/PrFeedList";
import { getRecentPRs } from "@/lib/actions/metrics";
import type { HomeContext } from "@/lib/home/core";
import { dayMonth } from "@/lib/home/labels";
import { getUserSettings } from "@/lib/user-settings";
import { localDateStr } from "@/lib/utils/user-date";

/** One PR as the widget shows it: formatted strings only. */
export type RecentPr = { id: number; exercise: string; value: string; kind: string; date: string };

/** The newest PRs, up to the L size's six. Reads only, through the user's own action. */
export async function loadRecentPrs(ctx: HomeContext): Promise<RecentPr[] | null> {
  const [result, { timeZone, units }] = await Promise.all([getRecentPRs(6), getUserSettings(ctx.userId)]);
  if (!result.success) throw new Error("recent PRs read failed");
  if (result.data.length === 0) return null;
  return result.data.map((pr) => ({
    id: pr.id,
    exercise: pr.exerciseName,
    value: formatPrValue(pr, units),
    kind: prTypeLabel(pr),
    date: dayMonth(localDateStr(new Date(pr.achievedAt), timeZone)),
  }));
}
