import { defineWidget } from "@/components/features/home/define-widget";
import { Card, Cap, Label, Num, PreviewBox, WidgetSkeleton } from "@/components/features/home/widget-ui";
import { bars, slotLine } from "@/lib/home/charts";
import { Layers } from "lucide-react";
import { loadTrainingLoad, type TrainingLoadData } from "./load";

/**
 * Training load (endurance or Garmin): today's form and this week's load,
 * with four weeks of daily load as bars and the 7-day fatigue as a line.
 * M a short chart, L a tall one with a legend. Opens the week page.
 */

const HREF = "/week";
const H = 100;
const RAMP: Record<NonNullable<TrainingLoadData["ramp"]>, string> = { normal: "Steady build", fast: "Fast build", warning: "Too fast" };

function Chart({ data, tall }: { data: TrainingLoadData; tall: boolean }) {
  const max = Math.max(...data.loads, ...data.fatigue) * 1.1;
  const n = data.loads.length;
  return (
    <div className={`relative mt-2.5 ${tall ? "h-[210px]" : "h-16"}`} role="img" aria-label={`Daily load for ${n} days and the 7-day trend`}>
      <svg className="home-reveal absolute inset-0 block h-full w-full" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden>
        {bars(data.loads, H, max).map((b) => (
          <rect
            key={b.i}
            className="home-grow"
            style={{ ["--i" as string]: b.i }}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.height}
            rx=".8"
            fill="var(--brand)"
            opacity={b.i >= n - 7 ? 0.9 : 0.38}
          />
        ))}
        <path d={slotLine(data.fatigue, H, max)} fill="none" stroke="var(--foreground)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export const trainingLoadWidget = defineWidget<TrainingLoadData>({
  load: loadTrainingLoad,
  View: ({ data, size }) => (
    <Card href={HREF} testId="training-load">
      <Label icon={<Layers />} more="4 weeks">
        Training load
      </Label>
      <div className="mt-2 flex items-center gap-2.5">
        <Num size={38}>{data.form > 0 ? `+${data.form}` : data.form}</Num>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">Form · {data.formLabel}</p>
          <Cap>Load {data.weekLoad} this week</Cap>
        </div>
        {data.ramp && (
          <span
            className={`ml-auto inline-flex shrink-0 items-center gap-[5px] rounded-full px-[9px] py-[3px] text-xs font-bold ${
              data.ramp === "normal" ? "bg-widget-2 text-foreground" : "bg-widget-2 text-muted-foreground"
            }`}
          >
            <i className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
            {RAMP[data.ramp]}
          </span>
        )}
      </div>
      <Chart data={data} tall={size === "l"} />
      {size === "l" && (
        <div className="mt-2.5 flex gap-3" aria-hidden>
          <span className="flex items-center gap-[5px] text-[11px] font-medium text-muted-foreground">
            <i className="h-2 w-2 rounded-full bg-brand" />
            Daily load
          </span>
          <span className="flex items-center gap-[5px] text-[11px] font-medium text-muted-foreground">
            <i className="h-2 w-2 rounded-full bg-foreground" />
            7-day trend
          </span>
        </div>
      )}
    </Card>
  ),
  Empty: () => (
    <Card href={HREF} testId="training-load">
      <Label icon={<Layers />}>Training load</Label>
      <p className="mt-auto text-sm text-muted-foreground">No training load in the last 4 weeks.</p>
    </Card>
  ),
  Skeleton: WidgetSkeleton,
  Preview: ({ size }) => <PreviewBox title="Training load" size={size} />,
});
