// The Garmin page's tabs, in a plain module: the server page reads them too,
// and a "use client" module hands the server a reference, not the array.
export const GARMIN_TABS = ["overview", "day", "training", "recovery", "activities", "trends"] as const;
export type GarminTab = (typeof GARMIN_TABS)[number];

/** A pill tab, or the raw data explorer behind the header icon. */
export type GarminView = GarminTab | "data";

/** Old tab names (before the Overview tab), so saved links keep working. */
const ALIASES: Record<string, GarminTab> = { today: "day", load: "training", sleep: "recovery" };

export function garminView(param: string | undefined): GarminView {
  if (param === "data") return "data";
  if (param && (GARMIN_TABS as readonly string[]).includes(param)) return param as GarminTab;
  return (param && ALIASES[param]) || "overview";
}
