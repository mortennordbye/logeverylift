import type { WidgetDef } from "./types";

export const raceCountdown = {
  id: "raceCountdown",
  kind: "widget",
  group: "training",
  title: "Race countdown",
  description: "Days to your next A race.",
  sizes: ["s"],
  defaultSize: "s",
  critical: false,
  source: "stream",
  // Races are an endurance feature (src/lib/seasons.ts, RACES_OFF).
  available: (a) => a.endurance,
  defaultVisible: () => false,
} as const satisfies WidgetDef;
