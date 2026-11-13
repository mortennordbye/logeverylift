import { WeeklyGoalProgress } from "@/components/features/WeeklyGoalProgress";
import { defineWidget } from "@/components/features/home/define-widget";
import { PreviewBox } from "@/components/features/home/widget-ui";

/**
 * Weekly goal: the ring from the week card on its own. The goal itself is
 * still per device (localStorage, decision 8 moves it to the account later).
 */

export const weeklyGoalWidget = defineWidget<{ thisWeekWorkouts: number }>({
  select: (core) => ({ thisWeekWorkouts: core.stats.thisWeekWorkouts }),
  View: ({ data }) => (
    <div className="rounded-2xl bg-muted p-3 h-full flex items-center justify-center" data-testid="weekly-goal">
      <WeeklyGoalProgress thisWeekWorkouts={data.thisWeekWorkouts} />
    </div>
  ),
  Empty: ({ size }) => <PreviewBox title="Weekly goal" size={size} />,
  Skeleton: ({ size }) => <PreviewBox title="Weekly goal" size={size} />,
  Preview: ({ size }) => <PreviewBox title="Weekly goal" size={size} />,
});
