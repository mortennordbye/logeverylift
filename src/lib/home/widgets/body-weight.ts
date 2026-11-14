import type { WidgetDef } from "./types";

export const bodyWeight = {
  id: "bodyWeight",
  kind: "widget",
  group: "stats",
  title: "Body weight",
  description: "Your latest weight and the 30-day trend.",
  sizes: ["s", "m"],
  defaultSize: "s",
  critical: false,
  source: "stream",
  available: () => true,
  defaultVisible: () => false,
} as const satisfies WidgetDef;
