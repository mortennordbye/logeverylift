/**
 * The five sports the load model keeps apart (docs/plans/garmin-insights-design.md, 2.3).
 */
export const SPORTS = ["swim", "bike", "run", "strength", "other"] as const;
export type Sport = (typeof SPORTS)[number];

/** Garmin activityType.typeKey to our sport. */
export function sportOf(typeKey: string): Sport {
  const k = typeKey.toLowerCase();
  if (k.includes("swim")) return "swim";
  if (k.includes("cycling") || k.includes("biking") || k.includes("bike") || k === "virtual_ride") return "bike";
  if (k.includes("running") || k === "run" || k.includes("trail") || k.includes("track_running")) return "run";
  if (k.includes("strength")) return "strength";
  return "other";
}

/** Treadmill pace is not trusted (2.2), and an indoor ride has no route. */
export function isIndoor(typeKey: string): boolean {
  const k = typeKey.toLowerCase();
  return k.includes("treadmill") || k.includes("indoor") || k.includes("virtual");
}
