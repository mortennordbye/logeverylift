import { defineWidget, type Renderer } from "@/components/features/home/define-widget";
import { SAMPLE_WORKOUTS_THIS_WEEK } from "@/components/features/home/samples";
import { Card, Label, PreviewBox } from "@/components/features/home/widget-ui";
import { Target } from "lucide-react";
import { GoalLeft, GoalRing } from "../week/GoalRing";

/**
 * Weekly goal: the ring from the week card on its own. The goal itself is
 * still per device (localStorage, decision 8 moves it to the account later).
 */

export const weeklyGoalWidget: Renderer<{ thisWeekWorkouts: number }> = defineWidget<{ thisWeekWorkouts: number }>({
  select: (core) => ({ thisWeekWorkouts: core.stats.thisWeekWorkouts }),
  View: ({ data, size }) => (
    <Card testId="weekly-goal">
      <Label icon={<Target />}>Weekly goal</Label>
      {size === "s" ? (
        <div className="mt-2 flex flex-1 flex-col items-start justify-between gap-2">
          <GoalRing done={data.thisWeekWorkouts} size={62} stroke={7} />
          <p className="text-xs font-medium text-muted-foreground">
            <GoalLeft done={data.thisWeekWorkouts} />
          </p>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-1 items-center gap-4">
          <GoalRing done={data.thisWeekWorkouts} size={96} stroke={9} />
          <div>
            <p className="text-sm font-semibold">Workouts this week</p>
            <p className="text-xs font-medium text-muted-foreground">
              <GoalLeft done={data.thisWeekWorkouts} />
            </p>
          </div>
        </div>
      )}
    </Card>
  ),
  Empty: ({ size }) => <PreviewBox title="Weekly goal" size={size} />,
  Skeleton: ({ size }) => <PreviewBox title="Weekly goal" size={size} />,
  Preview: ({ size }) => <PreviewBox title="Weekly goal" size={size} />,
  Sample: ({ size }) => weeklyGoalWidget.View({ data: { thisWeekWorkouts: SAMPLE_WORKOUTS_THIS_WEEK }, size }),
});
