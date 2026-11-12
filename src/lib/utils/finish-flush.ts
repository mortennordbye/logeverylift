/**
 * The plan write a finished workout sends: each set's session override goes
 * back to the program, so the next session starts from it. One payload for the
 * whole workout, so the server writes it in one transaction and one revision,
 * with the program version the workout started on: a field an assistant
 * changed in the meantime is kept, not overwritten (docs/plans/revisions.md,
 * 2.7). Null when there is nothing to write.
 */
export function finishFlushPayload(
  programId: number,
  overrides: Record<number, { targetReps: number; weightKg: number; durationSeconds?: number }>,
  planVersion: number | null,
) {
  const sets = Object.entries(overrides).map(([setId, ov]) => ({
    id: Number(setId),
    targetReps: ov.targetReps,
    weightKg: ov.weightKg,
    ...(ov.durationSeconds != null ? { durationSeconds: ov.durationSeconds } : {}),
  }));
  if (sets.length === 0) return null;
  return { programId, ...(planVersion != null ? { baseVersion: planVersion } : {}), sets };
}
