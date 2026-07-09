"use client";

import { useTheme } from "@/components/ui/theme-provider";

export function WeeklyGoalProgress({
  thisWeekWorkouts,
  size = "sm",
}: {
  thisWeekWorkouts: number;
  size?: "sm" | "lg";
}) {
  const { weeklyGoal } = useTheme();
  const progress = Math.min((thisWeekWorkouts / weeklyGoal) * 100, 100);
  const remaining = Math.max(weeklyGoal - thisWeekWorkouts, 0);
  const label = remaining === 0 ? "Weekly goal reached 🎉" : `${remaining} more to reach your goal`;

  if (size === "lg") {
    const r = 58;
    const circ = 2 * Math.PI * r;
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-40 h-40">
          <svg className="w-40 h-40 -rotate-90" viewBox="0 0 160 160">
            <circle cx="80" cy="80" r={r} stroke="currentColor" strokeWidth="10" fill="none" className="text-muted-foreground/20" />
            <circle
              cx="80" cy="80" r={r}
              stroke="currentColor" strokeWidth="10" fill="none"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - progress / 100)}
              className="text-primary"
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span className="text-4xl font-bold tabular-nums leading-none">{thisWeekWorkouts}</span>
            <span className="text-sm text-muted-foreground">/ {weeklyGoal} workouts</span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground text-center">{label}</p>
      </div>
    );
  }

  const r = 26;
  const circ = 2 * Math.PI * r;
  return (
    <div className="w-full flex flex-col items-center gap-2">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">
        Workouts Per Week
      </div>
      <div className="relative w-16 h-16">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} stroke="currentColor" strokeWidth="5" fill="none" className="text-border/40" />
          <circle
            cx="32" cy="32" r={r}
            stroke="currentColor" strokeWidth="5" fill="none"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - progress / 100)}
            className="text-primary"
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold tabular-nums">{thisWeekWorkouts}/{weeklyGoal}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground text-center">{label}</p>
    </div>
  );
}
