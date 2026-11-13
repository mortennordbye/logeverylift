import type { WidgetDef } from "./types";

export const friendsActivity = {
  id: "friendsActivity",
  kind: "widget",
  group: "friends",
  title: "Friends' activity",
  description: "Your friends' latest workouts from the last two weeks.",
  sizes: ["s", "m", "l"],
  defaultSize: "m",
  critical: false,
  source: "stream",
  available: () => true,
  defaultVisible: () => false,
} as const satisfies WidgetDef;
