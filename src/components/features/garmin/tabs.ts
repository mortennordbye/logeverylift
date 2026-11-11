// The Garmin page's tabs, in a plain module: the server page reads them too,
// and a "use client" module hands the server a reference, not the array.
export const GARMIN_TABS = ["today", "load", "sleep", "activities", "data"] as const;
export type GarminTab = (typeof GARMIN_TABS)[number];
