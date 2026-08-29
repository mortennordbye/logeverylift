/**
 * Which personal records were computed from reps nobody measured.
 *
 * Two of the three strength record types are *derived* from `actual_reps`:
 * `estimated_1rm` runs Epley over it, and `reps_at_weight` is the count
 * itself. Before honest rep logging shipped, tapping a set's toggle wrote
 * `actualReps = targetReps` unconditionally — so a lifter who ground out 6 of
 * a prescribed 8 was credited with 8, and could be shown a trophy and an
 * estimated 1RM they did not hit.
 *
 * Those records are kept and flagged, never deleted or recomputed (`D-10`).
 * Rewriting someone's record history to make the new engine look better would
 * be the same dishonesty the rebuild exists to remove, and an unbeatable
 * record with a visible reason is a great deal better than one that reads as a
 * plateau. The flag is display-only: the record still stands, and beating it
 * still counts normally.
 *
 * Heaviest-weight records carry no flag. They were never assumption-based —
 * the weight is what was on the bar either way.
 */

/**
 * The date honest rep logging reached users.
 *
 * **Set this to the release date, and check it at deploy.** Records achieved
 * before it are derived from claimed reps; records after it are derived from
 * reported ones. There is no column recording which, and there cannot be
 * retroactively, so a date is the only thing that separates them.
 *
 * Being a little late is the safe direction: it flags a few genuine records as
 * unverified, which understates the app's confidence. Being early is not — it
 * would present assumed numbers as measured ones, which is the thing being
 * fixed.
 */
export const HONEST_REPS_FROM = "2026-08-29";

/** The record types computed from `actual_reps` rather than from the load. */
const DERIVED_PR_TYPES = new Set(["estimated_1rm", "reps_at_weight"]);

/**
 * Was this record computed from reps the lifter never actually reported?
 *
 * @param prType     The record's type.
 * @param achievedAt When it was set, as an ISO timestamp or plain date.
 */
export function isUnverifiedPr(prType: string, achievedAt: string): boolean {
  if (!DERIVED_PR_TYPES.has(prType)) return false;
  return achievedAt.slice(0, 10) < HONEST_REPS_FROM;
}
