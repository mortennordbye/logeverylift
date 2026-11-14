import type { WidgetDef } from "./types";

export const weeklySets = {
  id: "weeklySets",
  kind: "widget",
  group: "stats",
  title: "Weekly sets",
  description: "Sets this week per muscle group.",
  sizes: ["s"],
  defaultSize: "s",
  critical: false,
  source: "stream",
  available: () => true,
  defaultVisible: () => false,
} as const satisfies WidgetDef;
