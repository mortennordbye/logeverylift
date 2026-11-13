import type { WidgetDef } from "./types";

export const weeklyGoal = {
  id: "weeklyGoal",
  kind: "widget",
  group: "stats",
  title: "Weekly goal",
  description: "Workouts this week against your weekly goal.",
  sizes: ["s", "m"],
  defaultSize: "s",
  critical: false,
  source: "core",
  // Week at L shows it already.
  available: () => true,
  defaultVisible: () => false,
} as const satisfies WidgetDef;
