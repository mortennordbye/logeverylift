import type { WidgetDef } from "./types";

export const enduranceToday = {
  id: "enduranceToday",
  kind: "widget",
  group: "training",
  title: "Endurance today",
  description: "Today's swim, bike and run sessions, with the guided start.",
  sizes: ["m"],
  defaultSize: "m",
  critical: true,
  source: "core",
  available: (a) => a.endurance,
  defaultVisible: (a) => a.endurance,
} as const satisfies WidgetDef;
