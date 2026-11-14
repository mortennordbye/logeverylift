import { defineWidget } from "@/components/features/home/define-widget";
import { Card, Cap, Label, Num, PreviewBox, WidgetSkeleton } from "@/components/features/home/widget-ui";
import { Flag } from "lucide-react";
import { loadRaceCountdown, type RaceCountdownData } from "./load";

/** Race countdown (S, endurance): days to the next A race. Opens its season. */

export const raceCountdownWidget = defineWidget<RaceCountdownData>({
  load: loadRaceCountdown,
  View: ({ data }) => (
    <Card href={`/seasons/${data.seasonId}`} testId="race-countdown">
      <Label icon={<Flag />}>Next race</Label>
      <div className="mt-auto min-w-0">
        <Num size={54}>{data.days}</Num>
        <p className="text-sm font-semibold">{data.days === 0 ? "race day" : data.days === 1 ? "day to go" : "days to go"}</p>
        <Cap className="truncate">
          {data.name} · {data.dateLabel}
        </Cap>
      </div>
    </Card>
  ),
  Empty: () => (
    <Card href="/seasons" testId="race-countdown">
      <Label icon={<Flag />}>Next race</Label>
      <p className="mt-auto text-sm text-muted-foreground">No race planned. Add one to a season.</p>
    </Card>
  ),
  Skeleton: WidgetSkeleton,
  Preview: ({ size }) => <PreviewBox title="Race countdown" size={size} />,
});
