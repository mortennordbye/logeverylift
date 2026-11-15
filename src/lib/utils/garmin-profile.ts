/**
 * The fields the Garmin sync reads from the Garmin profile snapshot
 * (garmin_days kind "profile", /userprofile-service/userprofile/settings).
 * Each returns null when Garmin has no usable value.
 */

import type { Units } from "./units";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

type Profile = Record<string, unknown> | null | undefined;

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
