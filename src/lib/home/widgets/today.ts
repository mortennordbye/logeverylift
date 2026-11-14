import type { WidgetDef } from "./types";

export const today = {
  id: "today",
  kind: "widget",
  group: "training",
  title: "Today",
  description: "Today's workout and the buttons that start it.",
  sizes: ["s", "m", "l"],
  defaultSize: "l",
  critical: true,
  source: "core",
  available: () => true,
  defaultVisible: () => true,
} as const satisfies WidgetDef;
