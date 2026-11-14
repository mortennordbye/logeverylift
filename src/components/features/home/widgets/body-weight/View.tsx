import { defineWidget, type Renderer } from "@/components/features/home/define-widget";
import { SAMPLE_WEIGHT } from "@/components/features/home/samples";
import { Card, Cap, Label, Num, Spark, WidgetSkeleton } from "@/components/features/home/widget-ui";
import type { WeightSummary } from "@/lib/home/widget-data";
import { Scale } from "lucide-react";
import { loadBodyWeight } from "./load";

/** Body weight: the latest entry and a 30-day sparkline; M adds the low and high. Opens Progress, where weight is logged. */

const HREF = "/more/metrics";
const kg = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

function change(c: number | null): string {
  if (c === null) return "No other entry in 30 days";
  if (c === 0) return "No change in 30 days";
  return `${c < 0 ? "↓" : "↑"} ${kg(Math.abs(c))} kg in 30 days`;
}

export const bodyWeightWidget: Renderer<WeightSummary> = defineWidget<WeightSummary>({
  load: loadBodyWeight,
  View: ({ data, size }) => (
    <Card href={HREF} testId="body-weight">
      <Label icon={<Scale />} more={size === "m" ? "30 days" : undefined}>
        Body weight
      </Label>
      <div className="mt-2 flex items-baseline gap-2">
        <Num size={38} unit="kg">
          {kg(data.latestKg)}
        </Num>
        {size === "m" && data.series.length >= 2 && (
          <Cap>
            Low {kg(data.lowKg)} · High {kg(data.highKg)}
          </Cap>
        )}
      </div>
      <Cap className="mt-1">{change(data.changeKg)}</Cap>
      <div className="h-2.5 shrink-0" />
      <Spark values={data.series} height={size === "m" ? 54 : 44} id={`home-weight-${size}`} />
    </Card>
  ),
  Empty: () => (
    <Card href={HREF} testId="body-weight">
      <Label icon={<Scale />}>Body weight</Label>
      <p className="mt-auto text-sm text-muted-foreground">No weight logged yet. Log it on the Progress page.</p>
    </Card>
  ),
  Skeleton: WidgetSkeleton,
  Preview: ({ size }) => bodyWeightWidget.View({ data: SAMPLE_WEIGHT, size }),
});
