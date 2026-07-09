/**
 * Reps In Reserve (RIR) ↔ RPE conversion.
 *
 * RIR is the primary effort signal the user logs (0 = taken to failure,
 * 5 = 5+ reps left in the tank). RPE is kept as a derived field for legacy
 * rows and downstream progression/adaptation logic: rpe = clamp(10 - rir, 1, 10).
 */

/** Derive the stored RPE (1-10) from a logged RIR value. */
export function rpeFromRir(rir: number): number {
  return Math.min(10, Math.max(1, 10 - rir));
}

/** Inverse, for legacy rows that only have rpe: rir = clamp(10 - rpe, 0, 5). */
export function rirFromRpe(rpe: number): number {
  return Math.min(5, Math.max(0, 10 - rpe));
}

/**
 * Effective RIR for a set, preferring the logged value and falling back to
 * the RPE-derived estimate for rows logged before RIR existed.
 */
export function effectiveRir(set: { rir?: number | null; rpe: number }): number {
  return set.rir ?? rirFromRpe(set.rpe);
}
