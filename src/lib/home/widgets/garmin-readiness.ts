import type { WidgetDef } from "./types";

export const garminReadiness = {
  id: "garminReadiness",
  kind: "widget",
  group: "garmin",
  title: "Garmin readiness",
  description: "Today's readiness score from your Garmin data.",
  sizes: ["s", "m"],
  defaultSize: "m",
  critical: false,
  source: "stream",
  // Garmin is for admin accounts with the key set (src/lib/garmin/access.ts).
  available: (a) => a.garmin,
  defaultVisible: () => false,
} as const satisfies WidgetDef;
