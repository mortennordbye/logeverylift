import { defineWidget } from "@/components/features/home/define-widget";
import { PreviewBox } from "@/components/features/home/widget-ui";
import type { HomeCore } from "@/lib/home/core";
import Link from "next/link";

/** Cycle progress: S the week, M the name, week, bar and end date (the old card's header). */

type CycleData = { name: string; currentWeek: number; durationWeeks: number; progressPct: number; endFormatted: string };

export const cycleWidget = defineWidget<CycleData>({
  select: (core: HomeCore) =>
    core.info
      ? {
          name: core.info.cycle.name,
          currentWeek: core.info.currentWeek,
          durationWeeks: core.info.cycle.durationWeeks,
          progressPct: core.progressPct,
          endFormatted: core.endFormatted ?? "",
        }
      : null,
  View: ({ data, size }) =>
    size === "s" ? (
      <Link href="/cycles" className="rounded-2xl bg-muted p-3 h-full flex flex-col justify-between active:opacity-70" data-testid="cycle-widget">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">{data.name}</span>
        <span className="text-2xl font-bold tabular-nums">
          Week {data.currentWeek}/{data.durationWeeks}
        </span>
      </Link>
    ) : (
      <Link href="/cycles" className="block rounded-2xl bg-muted px-4 py-3 active:opacity-70" data-testid="cycle-widget">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-semibold">{data.name}</span>
          <span className="text-xs text-muted-foreground">Week {data.currentWeek}/{data.durationWeeks}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full" style={{ width: `${data.progressPct}%` }} />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">ends {data.endFormatted}</span>
        </div>
      </Link>
    ),
  Empty: () => (
    <div className="rounded-2xl bg-muted p-3 h-full" data-testid="cycle-widget">
      <p className="text-sm text-muted-foreground">No training cycle.</p>
      <Link href="/cycles" className="min-h-11 inline-flex items-center text-sm font-semibold text-primary active:opacity-70">
        Set up a Cycle →
      </Link>
    </div>
  ),
  Skeleton: ({ size }) => <PreviewBox title="Cycle progress" size={size} />,
  Preview: ({ size }) => <PreviewBox title="Cycle progress" size={size} />,
});
