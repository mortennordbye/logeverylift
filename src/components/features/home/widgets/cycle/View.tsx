import { defineWidget, type Renderer } from "@/components/features/home/define-widget";
import { SAMPLE_CYCLE } from "@/components/features/home/samples";
import { Card, Cap, Label, Num, PreviewBox } from "@/components/features/home/widget-ui";
import type { HomeCore } from "@/lib/home/core";
import { Repeat } from "lucide-react";
import Link from "next/link";

/** Cycle progress: S the week as a big number, M the name, week, a segment per week and the end date. */

type CycleData = { name: string; currentWeek: number; durationWeeks: number; progressPct: number; endFormatted: string };

function Segments({ current, total }: { current: number; total: number }) {
  if (total > 16) {
    return (
      <div className="h-1.5 overflow-hidden rounded-full bg-widget-2" aria-hidden>
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, ((current - 0.5) / total) * 100)}%` }} />
      </div>
    );
  }
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={`relative h-1.5 flex-1 overflow-hidden rounded-full ${i < current - 1 ? "bg-brand" : "bg-widget-2"}`}>
          {i === current - 1 && <span className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-brand" />}
        </i>
      ))}
    </div>
  );
}

export const cycleWidget: Renderer<CycleData> = defineWidget<CycleData>({
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
      <Card href="/cycles" testId="cycle-widget" ariaLabel={`${data.name}, week ${data.currentWeek} of ${data.durationWeeks}`}>
        <Label icon={<Repeat />}>Cycle</Label>
        <div className="mt-auto">
          <p className="text-[13px] font-semibold text-muted-foreground">Week</p>
          <Num size={54} unit={`of ${data.durationWeeks}`}>
            {data.currentWeek}
          </Num>
          <p className="mt-1 truncate text-sm font-semibold">{data.name}</p>
        </div>
      </Card>
    ) : (
      <Card href="/cycles" testId="cycle-widget" className="gap-3">
        <Label icon={<Repeat />} more={`Week ${data.currentWeek} of ${data.durationWeeks}`}>
          Cycle
        </Label>
        <p className="home-display text-[26px] uppercase truncate">{data.name}</p>
        <Segments current={data.currentWeek} total={data.durationWeeks} />
        <Cap className="mt-auto">ends {data.endFormatted}</Cap>
      </Card>
    ),
  Empty: () => (
    <Card testId="cycle-widget">
      <Label icon={<Repeat />}>Cycle</Label>
      <p className="mt-2 text-sm text-muted-foreground">No training cycle.</p>
      <Link href="/cycles" className="mt-auto min-h-11 inline-flex items-center text-[15px] font-semibold text-brand active:opacity-60">
        Set up a Cycle →
      </Link>
    </Card>
  ),
  Skeleton: ({ size }) => <PreviewBox title="Cycle progress" size={size} />,
  Preview: ({ size }) => cycleWidget.View({ data: SAMPLE_CYCLE, size }),
});
