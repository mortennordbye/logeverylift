import { callAction, failedInTransit } from "@/lib/utils/stale-bundle";

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

type FlushPayload = NonNullable<ReturnType<typeof finishFlushPayload>>;

/**
 * Send the finish flush online. Through callAction, so a stale bundle starts
 * the reload; and a flush that never reached the server (that, or a dropped
 * connection) goes into the offline queue to replay, instead of being lost.
 * A flush the server refused is not queued: sending it again cannot help.
 */
export async function sendFinishFlush(
  payload: FlushPayload,
  send: (p: FlushPayload) => Promise<{ success: true; data: { applied: number; conflicts: number } } | { success: false; error: string }>,
  enqueue: (p: FlushPayload) => void,
): Promise<{ conflicts: number; queued: boolean }> {
  const result = await callAction(send(payload));
  if (result.success) return { conflicts: result.data.conflicts, queued: false };
  if (failedInTransit(result)) {
    enqueue(payload);
    return { conflicts: 0, queued: true };
  }
  return { conflicts: 0, queued: false };
}
