import type { WidgetDef } from "./types";

export const trainingLoad = {
  id: "trainingLoad",
  kind: "widget",
  group: "training",
  title: "Training load",
  description: "Daily load and form over 4 weeks.",
  sizes: ["m", "l"],
  defaultSize: "m",
  critical: false,
  source: "stream",
  // From Garmin when connected, else from the endurance sessions (getTrainingLoad).
  available: (a) => a.endurance || a.garmin,
  defaultVisible: () => false,
} as const satisfies WidgetDef;
