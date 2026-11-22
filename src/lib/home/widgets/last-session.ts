import type { WidgetDef } from "./types";

export const lastSession = {
  id: "lastSession",
  kind: "widget",
  group: "training",
  title: "Last session",
  description: "Your last ride or run against its plan, matched to Garmin.",
  sizes: ["m"],
  defaultSize: "m",
  critical: false,
  source: "stream",
  available: (a) => a.endurance,
  // On for every endurance home (docs/plans/session-check.md, decision 9).
  defaultVisible: (a) => a.endurance,
} as const satisfies WidgetDef;
