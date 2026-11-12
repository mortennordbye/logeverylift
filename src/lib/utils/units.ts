/**
 * Display units for endurance numbers (decision D14). Storage, Server Actions,
 * MCP and export are metric everywhere; only what the app shows and takes as
 * typed input converts, at the edge. Run and ride distance, pace and speed
 * follow `distance`; swim distance and pace follow `swim`.
 *
 * Weight stays kg only for now (BACKLOG.md, "Pounds for weights").
 */

export type DistanceUnit = "km" | "mi";
export type SwimUnit = "m" | "yd";
export type Units = { distance: DistanceUnit; swim: SwimUnit };

export const DISTANCE_UNITS: readonly DistanceUnit[] = ["km", "mi"];
export const SWIM_UNITS: readonly SwimUnit[] = ["m", "yd"];
export const DEFAULT_UNITS: Units = { distance: "km", swim: "m" };

export const METERS_PER_MILE = 1609.344;
export const METERS_PER_YARD = 0.9144;

/**
 * The unit a typed distance field is in. `inputUnit` is the metric field unit
 * a discipline uses (`m` for swims, `km` for rides and runs, from
 * src/lib/utils/discipline.ts); the user's units swap it for its imperial pair.
 */
export type FieldUnit = "m" | "km" | "yd" | "mi";

export function fieldUnit(inputUnit: "m" | "km", units: Units = DEFAULT_UNITS): FieldUnit {
  if (inputUnit === "m") return units.swim === "yd" ? "yd" : "m";
  return units.distance === "mi" ? "mi" : "km";
}

const METERS_PER: Record<FieldUnit, number> = {
  m: 1,
  km: 1000,
  yd: METERS_PER_YARD,
  mi: METERS_PER_MILE,
};

/**
 * A stored distance as the number a field in `unit` shows. Metric is exact
 * (meters, or meters / 1000, as before units existed). Yards are whole, miles
 * have up to two decimals.
 */
export function metersToField(meters: number, unit: FieldUnit): number {
  const v = meters / METERS_PER[unit];
  if (unit === "yd") return Math.round(v);
  if (unit === "mi") return Math.round(v * 100) / 100;
  return v;
}

/**
 * A typed distance in `unit` as whole meters, the stored form. With
 * `previousMeters`, a value equal to what the field showed for it keeps the
 * stored meters: 5000 m shows as 3.11 mi, and saving that 3.11 back unchanged
 * must not turn the target into 5005 m.
 */
export function fieldToMeters(value: number, unit: FieldUnit, previousMeters?: number | null): number {
  if (previousMeters != null && metersToField(previousMeters, unit) === value) return previousMeters;
  return Math.round(value * METERS_PER[unit]);
}
