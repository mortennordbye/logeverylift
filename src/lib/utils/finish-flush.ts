/**
 * The plan writes a finished workout sends: each set's session override goes
 * back to the program, so the next session starts from it. Each write carries
 * the program version the workout started on, so the server keeps a field the
 * plan changed in the meantime instead of overwriting it, and records the
 * conflict (docs/plans/revisions.md, 2.7).
 */
export function finishFlushPayloads(
  overrides: Record<number, { targetReps: number; weightKg: number; durationSeconds?: number }>,
  planVersion: number | null,
) {
  return Object.entries(overrides).map(([setId, ov]) => ({
    id: Number(setId),
    targetReps: ov.targetReps,
    weightKg: ov.weightKg,
    ...(ov.durationSeconds != null ? { durationSeconds: ov.durationSeconds } : {}),
    ...(planVersion != null ? { baseVersion: planVersion } : {}),
  }));
}
