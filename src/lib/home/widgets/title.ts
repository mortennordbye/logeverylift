import type { WidgetDef } from "./types";

export const title = {
  id: "title",
  kind: "header",
  group: "training",
  title: "Title",
  description: "The LogEveryLift title. Large adds the date and the cycle week.",
  sizes: ["m", "l"],
  defaultSize: "m",
  critical: false,
  source: "core",
  available: () => true,
  defaultVisible: () => true,
} as const satisfies WidgetDef;
