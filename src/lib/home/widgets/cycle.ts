import type { WidgetDef } from "./types";

export const cycle = {
  id: "cycle",
  kind: "widget",
  group: "training",
  title: "Cycle progress",
  description: "Your training cycle: the week you are in and when it ends.",
  sizes: ["s", "m"],
  defaultSize: "m",
  critical: false,
  source: "core",
  // Today at L shows it already.
  available: () => true,
  defaultVisible: () => false,
} as const satisfies WidgetDef;
