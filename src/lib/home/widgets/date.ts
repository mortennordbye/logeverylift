import type { WidgetDef } from "./types";

export const date = {
  id: "date",
  kind: "widget",
  group: "training",
  title: "Date",
  description: "Today's date, as a line above your widgets.",
  sizes: ["s", "m"],
  defaultSize: "m",
  critical: false,
  source: "core",
  available: () => true,
  // Owner decision B (2026-11-14): in the gallery, not on the default home.
  defaultVisible: () => false,
} as const satisfies WidgetDef;
