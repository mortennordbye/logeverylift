/**
 * Who set each field Garmin can sync (docs/plans/account-profile.md, 6.4).
 * A field the user set is locked: the Garmin sync leaves it alone until the
 * user takes the Garmin value. To sync a new field, add its name here.
 */

import { shortDay } from "./seasons";

export const SYNCED_FIELDS = ["availability", "timeZone", "units"] as const;
export type SyncedField = (typeof SYNCED_FIELDS)[number];
export type FieldSource = { by: "garmin" | "you"; on: string };
export type FieldSources = Partial<Record<SyncedField, FieldSource>>;

export const isLocked = (sources: FieldSources, field: SyncedField) => sources[field]?.by === "you";

/** "From Garmin · Sun 15 Nov" or "Set by you · Sun 15 Nov". */
export function sourceLine(source: FieldSource): string {
  return `${source.by === "garmin" ? "From Garmin" : "Set by you"} · ${shortDay(source.on)}`;
}
