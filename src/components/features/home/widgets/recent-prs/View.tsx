import { defineWidget } from "@/components/features/home/define-widget";
import { PreviewBox, WidgetCard, WidgetSkeleton } from "@/components/features/home/widget-ui";
import { Trophy } from "lucide-react";
import Link from "next/link";
import { loadRecentPrs, type RecentPr } from "./load";

/** Recent PRs: S the newest, M the last 3, L the last 6. Links to the Records tab. */

const COUNT = { s: 1, m: 3, l: 6 } as const;
const HREF = "/more/metrics?tab=records";

export const recentPrsWidget = defineWidget<RecentPr[]>({
  load: loadRecentPrs,
  View: ({ data, size }) => {
    if (size === "s") {
      const pr = data[0];
      return (
        <Link href={HREF} className="rounded-2xl bg-muted p-3 h-full flex flex-col justify-between gap-1 active:opacity-70" data-testid="recent-prs">
          <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Trophy className="h-3.5 w-3.5 text-yellow-600" aria-hidden />
            Latest PR
          </span>
          <span className="text-sm font-semibold truncate">{pr.exercise}</span>
          <span className="text-base font-bold tabular-nums truncate">{pr.value}</span>
          <span className="text-[11px] text-muted-foreground">{pr.date}</span>
        </Link>
      );
    }
    return (
      <WidgetCard title="Recent PRs" href={HREF} linkLabel="All records →" testId="recent-prs">
        <ul className="flex flex-col divide-y divide-border/40">
          {data.slice(0, COUNT[size]).map((pr) => (
            <li key={pr.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{pr.exercise}</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {pr.kind} · {pr.date}
                </span>
              </span>
              <span className="text-sm font-semibold tabular-nums shrink-0">{pr.value}</span>
            </li>
          ))}
        </ul>
      </WidgetCard>
    );
  },
  Empty: () => (
    <WidgetCard title="Recent PRs" testId="recent-prs">
      <p className="text-sm text-muted-foreground py-1">No PRs yet. Log a workout to set your first.</p>
    </WidgetCard>
  ),
  Skeleton: WidgetSkeleton,
  Preview: ({ size }) => <PreviewBox title="Recent PRs" size={size} lines={3} />,
});
