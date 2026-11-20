/**
 * Grade-adjusted pace (docs/plans/run-logger.md, 4.9): the speed on the flat
 * that costs the same energy per metre, from Minetti et al. 2002 (the energy
 * cost of running and of walking on a gradient, J/kg/m). On a treadmill an
 * incline of 0 to 1% counts as flat (Jones and Doust 1996), so only the part
 * above 1% is adjusted. Under 7 km/h the walking curve applies.
 *
 * Pure: the run numbers and the run pace load both read it.
 */

/** A treadmill incline up to this counts as flat (Jones and Doust 1996). */
export const FLAT_INCLINE_PCT = 1;
/** Under this speed the walking curve applies (4.9). */
export const WALK_UNDER_KMH = 7;
/** Minetti's curves were measured from -45% to +45%. */
const MAX_GRADE = 0.45;

// Minetti et al. 2002: cost in J/kg/m as a fifth-degree polynomial of the gradient (a fraction), highest power first.
const RUN_COST = [155.4, -30.4, -43.3, 46.3, 19.5, 3.6];
const WALK_COST = [280.5, -58.7, -76.8, 51.9, 19.6, 2.5];
const cost = (c: number[], i: number) => c.reduce((a, k) => a * i + k, 0);

/** The grade GAP adjusts for, in %: on a treadmill 0 to 1% is flat and only the part above 1% counts. */
export function adjustedGrade(gradePct: number, treadmill: boolean): number {
  if (!treadmill || gradePct <= 0) return gradePct;
  return Math.max(0, gradePct - FLAT_INCLINE_PCT);
}

/** Grade-adjusted speed in m/s: the flat speed with the same energy cost per metre. */
export function gapSpeed(speedMs: number, gradePct: number | null | undefined, treadmill: boolean): number {
  if (!(speedMs > 0)) return 0;
  const i = Math.min(MAX_GRADE, Math.max(-MAX_GRADE, adjustedGrade(gradePct ?? 0, treadmill) / 100));
  const c = speedMs * 3.6 < WALK_UNDER_KMH ? WALK_COST : RUN_COST;
  return (speedMs * cost(c, i)) / cost(c, 0);
}
