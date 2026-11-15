/**
 * The fields the Garmin sync reads from the Garmin profile snapshot
 * (garmin_days kind "profile", /userprofile-service/userprofile/settings).
 * Each returns null when Garmin has no usable value.
 */

import { isLocked, sourceLine, type FieldSources, type SyncedField } from "./field-sources";
import type { Units } from "./units";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

export type Profile = Record<string, unknown> | null | undefined;

/** "MONDAY" is 1, "SUNDAY" 7, as availableDays stores them. */
function days(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out = value.map((d) => DAYS.indexOf(String(d).toUpperCase()) + 1).filter((n) => n > 0);
  return [...new Set(out)].sort((a, b) => a - b);
}

export function garminAvailability(p: Profile): { availableDays: number[]; longDay: number | null } | null {
  const availableDays = days(p?.availableTrainingDays);
  if (availableDays.length === 0) return null;
  return { availableDays, longDay: days(p?.preferredLongTrainingDays)[0] ?? null };
}

export function garminUnits(p: Profile): Units | null {
  const system = String(p?.measurementSystem ?? "").toLowerCase();
  if (system === "metric") return { distance: "km", swim: "m" };
  if (system === "statute_us") return { distance: "mi", swim: "yd" };
  if (system === "statute_uk") return { distance: "mi", swim: "m" };
  return null;
}

export function garminTimeZone(p: Profile): string | null {
  const zone = p?.timeZone;
  if (typeof zone !== "string" || !zone) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Availability = { availableDays: number[] | null; longDay: number | null };

/** Garmin's days match ours; the long day counts only when Garmin has one. */
export function sameAvailability(garmin: { availableDays: number[]; longDay: number | null }, stored: Availability): boolean {
  return JSON.stringify(garmin.availableDays) === JSON.stringify(stored.availableDays ?? []) && (garmin.longDay === null || garmin.longDay === stored.longDay);
}

export type SyncLine = { note: string | null; says: string | null };

/**
 * Per synced field, from data the page already loaded: its source line, and
 * Garmin's value when the field is locked and Garmin differs. `availability`
 * null leaves that field out (endurance off).
 */
export function fieldSyncLines(
  profile: Profile,
  stored: { sources: FieldSources; availability: Availability | null; timeZone: string | null; units: Units },
): Partial<Record<SyncedField, SyncLine>> {
  const line = (field: SyncedField, says: string | null): SyncLine => {
    const source = stored.sources[field];
    return { note: source ? sourceLine(source) : null, says: isLocked(stored.sources, field) ? says : null };
  };
  const days = garminAvailability(profile);
  const zone = garminTimeZone(profile);
  const units = garminUnits(profile);
  const out: Partial<Record<SyncedField, SyncLine>> = {
    timeZone: line("timeZone", zone && zone !== stored.timeZone ? zone.replace(/_/g, " ") : null),
    units: line(
      "units",
      units && (units.distance !== stored.units.distance || units.swim !== stored.units.swim)
        ? `${units.distance === "km" ? "km" : "miles"}, swim in ${units.swim === "m" ? "meters" : "yards"}`
        : null,
    ),
  };
  if (stored.availability) {
    out.availability = line(
      "availability",
      days && !sameAvailability(days, stored.availability)
        ? `${days.availableDays.map((d) => DAY_NAMES[d]).join(" ")}${days.longDay ? ` · long day ${DAY_NAMES[days.longDay]}` : ""}`
        : null,
    );
  }
  return out;
}
