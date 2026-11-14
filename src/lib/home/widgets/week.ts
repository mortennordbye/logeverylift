import type { WidgetDef } from "./types";

export const week = {
  id: "week",
  kind: "widget",
  group: "training",
  title: "Week",
  description: "This week's days. Large adds the weekly goal ring.",
  sizes: ["m", "l"],
  defaultSize: "l",
  critical: false,
  source: "core",
  available: () => true,
  defaultVisible: () => true,
} as const satisfies WidgetDef;
