import type { WidgetDef } from "./types";

export const streak = {
  id: "streak",
  kind: "widget",
  group: "stats",
  title: "Streak",
  description: "Weeks in a row with a workout.",
  sizes: ["s", "m"],
  defaultSize: "s",
  critical: false,
  source: "stream",
  available: () => true,
  defaultVisible: () => false,
} as const satisfies WidgetDef;
