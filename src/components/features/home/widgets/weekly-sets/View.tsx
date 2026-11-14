import { defineWidget, type Renderer } from "@/components/features/home/define-widget";
import { SAMPLE_SETS } from "@/components/features/home/samples";
import { Card, Label, Num, Track, WidgetSkeleton } from "@/components/features/home/widget-ui";
import { BarChart3 } from "lucide-react";
import { loadWeeklySets, type WeeklySetsData } from "./load";

/** Weekly sets (S): total sets this week and the top four muscle groups against 10 sets. Opens Progress. */

const HREF = "/more/metrics";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const weeklySetsWidget: Renderer<WeeklySetsData> = defineWidget<WeeklySetsData>({
  load: loadWeeklySets,
  View: ({ data }) => (
    <Card href={HREF} testId="weekly-sets">
      <Label icon={<BarChart3 />}>Weekly sets</Label>
      <Num size={38} unit="sets" className="mt-2">
        {data.total}
      </Num>
      <ul className="mt-auto flex flex-col gap-[7px] pt-2">
        {data.muscles.map((m) => (
          <li key={m.name} className="grid grid-cols-[52px_1fr] items-center gap-2 text-xs font-semibold" aria-label={`${cap(m.name)}: ${m.sets} of ${m.target} sets`}>
            <span className="truncate text-muted-foreground">{cap(m.name)}</span>
            <Track pct={m.sets / m.target} />
          </li>
        ))}
      </ul>
    </Card>
  ),
  Empty: () => (
    <Card href={HREF} testId="weekly-sets">
      <Label icon={<BarChart3 />}>Weekly sets</Label>
      <p className="mt-auto text-sm text-muted-foreground">No sets yet this week.</p>
    </Card>
  ),
  Skeleton: WidgetSkeleton,
  Preview: ({ size }) => weeklySetsWidget.View({ data: SAMPLE_SETS, size }),
});
