"use client";

import { Num, Ring } from "@/components/features/home/widget-ui";
import { useTheme } from "@/components/ui/theme-provider";

/**
 * The weekly goal as a ring: workouts this week against the goal, which is
 * still kept per device (decision 8 moves it to the account later), so this
 * part renders on the client.
 */
export function GoalRing({ done, size, stroke }: { done: number; size: number; stroke: number }) {
  const { weeklyGoal } = useTheme();
  return (
    <Ring size={size} stroke={stroke} pct={weeklyGoal > 0 ? done / weeklyGoal : 0}>
      <Num size={size >= 90 ? 38 : 26}>{done}</Num>
      <span className="text-[11px] font-medium text-muted-foreground">of {weeklyGoal}</span>
    </Ring>
  );
}

/** What is left to the goal, in words. */
function goalLeft(done: number, goal: number): string {
  const remaining = Math.max(goal - done, 0);
  return remaining === 0 ? "Weekly goal reached" : `${remaining} more to reach your goal`;
}

export function GoalLeft({ done, short = false }: { done: number; short?: boolean }) {
  const { weeklyGoal } = useTheme();
  if (short) {
    const remaining = Math.max(weeklyGoal - done, 0);
    return <>{remaining === 0 ? "Goal reached" : `${remaining} to go`}</>;
  }
  return <>{goalLeft(done, weeklyGoal)}</>;
}
