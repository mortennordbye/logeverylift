import type { SetOverride } from "@/contexts/workout-session-context";
import type { ProgramSet } from "@/types/workout";

/**
 * The values a set is logged with, from its plan and whatever the session
 * recorded for it (an applied suggestion, a weight corrected in the editor, the
 * reps a miss sheet captured, a note).
 *
 * One function for every way a set gets logged: tapping it, tapping a later set
 * (which catches up the earlier ones), and ticking the whole exercise. Those
 * were three copies, and they drifted: the catch-up ignored a set marked
 * failed, so it was logged as a clean hit at the full target.
 *
 * Strength and timed sets only; a run is logged through its own modal.
 */
export function buildSetLog(
  set: Pick<ProgramSet, "targetReps" | "weightKg" | "durationSeconds" | "distanceMeters">,
  ov: SetOverride | undefined,
  {
    restTimeSeconds,
    recorded,
  }: {
    restTimeSeconds: number;
    /** Reps and effort the lifter entered in the act of logging (the effort prompt). */
    recorded?: { actualReps?: number; rir?: number };
  },
) {
  const target = ov?.targetReps ?? set.targetReps ?? 0;
  const failed = ov?.isFailed ?? false;
  return {
    // Zod requires a positive target when one is sent; a timed set's is 0.
    targetReps: target > 0 ? target : undefined,
    // A recorded count wins; a set taken to failure with nothing recorded is
    // 0; otherwise the tap claims the target.
    actualReps: recorded?.actualReps ?? ov?.actualReps ?? (failed ? 0 : target),
    weightKg: ov?.weightKg ?? Number(set.weightKg ?? 0),
    durationSeconds: ov?.durationSeconds ?? set.durationSeconds ?? undefined,
    distanceMeters: ov?.distanceMeters ?? set.distanceMeters ?? undefined,
    // A failed set was taken to failure, so RIR 0. Otherwise only a value the
    // lifter gave: a tap says the set is done, not how hard it was.
    rir: failed ? 0 : (recorded?.rir ?? ov?.rir),
    restTimeSeconds,
    notes: ov?.notes ?? null,
    isCompleted: true,
    isFailed: failed,
    // A failed set can't also have been easy.
    wasEasy: !failed && (ov?.wasEasy ?? false),
  };
}
