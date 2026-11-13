import type { WidgetDef } from "./types";

export const recentPrs = {
  id: "recentPrs",
  kind: "widget",
  group: "prs",
  title: "Recent PRs",
  description: "Your newest personal records.",
  sizes: ["s", "m", "l"],
  defaultSize: "m",
  critical: false,
  source: "stream",
  available: () => true,
  defaultVisible: () => false,
} as const satisfies WidgetDef;
