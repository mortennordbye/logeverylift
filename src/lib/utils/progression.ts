/**
 * Progressive Overload Utilities
 *
 * Pure functions for calculating progressive overload suggestions.
 * No database calls — receives pre-fetched data and returns suggestions.
 *
 * Extracted from getProgressiveSuggestions for testability and reuse.
 */

import type { SetSuggestion } from "@/types/workout";

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * Number of recent sessions to consider when evaluating progression readiness.
 * The "window" we look back through for each exercise+setNumber combo.
 */
export const CONSENSUS_WINDOW = 5;

/**
 * Minimum number of confident hits required within CONSENSUS_WINDOW to trigger
 * a weight/rep progression. Prevents one-lucky-session advances.
 */
export const REQUIRED_HITS = 2;

/**
 * Number of consecutive session failures required to trigger a deload suggestion.
 * All DELOAD_THRESHOLD most-recent sessions must have missed the target.
 */
export const DELOAD_THRESHOLD = 3;

/**
 * Fraction to reduce weight by when a deload is detected (10% reduction).
 */
export const DELOAD_FACTOR = 0.9;


// ─── Input types ────────────────────────────────────────────────────────────

/**
 * A single logged set from workout history, shaped for progression analysis.
 * Matches what the DB returns from workoutSets joined with workoutSessions.
 */
export type HistoryRow = {
  exerciseId: number;
  setNumber: number;
  actualReps: number;
  targetReps: number | null;
  weightKg: string; // decimal returned as string from Drizzle
  durationSeconds: number | null;
  distanceMeters?: number | null;
  feeling: string | null;
  date: string;
  rpe: number;
};

/**
 * Program set data merged with its parent program exercise settings.
 * Shaped for buildSuggestion input.
 */
export type ProgramSetData = {
  programSetId: number;
  setNumber: number;
  targetReps: number | null;
  durationSeconds: number | null;
  distanceMeters?: number | null;
  exerciseId: number;
  overloadIncrementKg: string | null;
  overloadIncrementReps: number | null;
  progressionMode: string | null;
  /** "working" | "warmup" — non-working sets get no progression suggestions. */
  setType?: string | null;
  /** Exercise movement pattern — used for adaptive increment sizing. Optional for backwards compatibility. */
  movementPattern?: string | null;
  /** Resolved exercise type (program override ?? exercise default) — refines increment sizing. */
  exerciseType?: string | null;
  /** Exercise name — optional, passed through to the suggestion for insight bucketing. */
  exerciseName?: string;
};

/**
 * Relevant user profile fields for default increment calculation.
 * Null values mean the user has not set a profile.
 */
export type UserProfile = {
  experienceLevel: string | null;
  goal: string | null;
};

// ─── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Epley 1RM estimation formula.
 * Accurate for 2–12 reps; unreliable above 12. Caller must guard weight > 0.
 */
export function estimate1RM(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}

/**
 * Estimate reps achievable at a given weight from a known 1RM.
 * Returns at least 1 (never negative).
 */
export function estimateRepsAt(oneRepMax: number, weightKg: number): number {
  return Math.max(1, Math.floor(30 * (oneRepMax / weightKg - 1)));
}

/**
 * Round a value to the nearest multiple of increment.
 * Returns value unchanged when increment is 0.
 */
export function roundToNearest(value: number, increment: number): number {
  if (increment <= 0) return value;
  return Math.round(value / increment) * increment;
}

/**
 * Compute the effective kg increment using load-zone scaling.
 *
 * Priority:
 *  1. User-configured increment (non-null) — always respected
 *  2. goal=endurance — 1kg regardless of load
 *  3. experienceLevel profile override (beginner=5kg, advanced=1.25kg)
 *  4. Load-zone scaling by movement pattern + current weight
 *
 * Compound movements: squat, hinge (deadlift), push (bench/OHP), pull (rows/pullups)
 */
export function adaptiveIncrementKg(
  storedIncrement: number | null,
  currentWeightKg: number,
  movementPattern: string | null | undefined,
  goal: string | null | undefined,
  experienceLevel?: string | null,
  exerciseType?: string | null,
): number {
  // User has an explicit increment — always respect it
  if (storedIncrement !== null) return storedIncrement;

  // Endurance goal prioritizes small, precise increments regardless of load
  if (goal === "endurance") return 1.0;

  // Profile-based overrides (preserve existing behavior for users with set profiles)
  if (experienceLevel === "beginner") return 5.0;
  if (experienceLevel === "advanced") return 1.25;

  // Prefer the explicit exercise type when set (only "compound" gets large jumps);
  // fall back to the movement-pattern heuristic for unclassified exercises.
  const isCompound =
    exerciseType != null
      ? exerciseType === "compound"
      : ["squat", "hinge", "push", "pull"].includes(movementPattern ?? "");

  // Load-zone increments for users without an experience level set:
  //   < 30kg   — small loads; isolation: 1kg, compound: 2.5kg
  //   30–60kg  — moderate; isolation: 1.25kg, compound: 2.5kg
  //   60–100kg — standard: 2.5kg for both
  //   > 100kg  — heavy; compound: 5kg, isolation stays 2.5kg
  if (currentWeightKg < 30) return isCompound ? 2.5 : 1.0;
  if (currentWeightKg < 60) return isCompound ? 2.5 : 1.25;
  if (currentWeightKg < 100) return 2.5;
  return isCompound ? 5.0 : 2.5;
}

// ─── RPE confidence gate ────────────────────────────────────────────────────

/**
 * Returns true when a logged set qualifies as a "confident hit" —
 * the lifter both hit the target rep count AND had sufficient reserve.
 *
 * For sets logged with Reps In Reserve, rpe is the RIR-derived value
 * (rpe = 10 − rir), so this gate reasons in RIR terms transitively:
 * RIR ≥ 3 → confident, RIR 2 → confident only with an extra rep, RIR 0-1 → not.
 *
 * Gate:
 *   RPE null → treated as 7 (neutral; old sessions without RPE data)
 *   RPE ≤ 7  → confident if target reps met            (RIR ≥ 3)
 *   RPE 8    → confident only if actual > target        (RIR 2; had a rep in reserve)
 *   RPE 9-10 → not confident regardless                 (RIR 0-1; near max effort)
 */
export function isConfidentHit(row: HistoryRow, programTargetReps: number | null): boolean {
  const target = row.targetReps ?? programTargetReps;
  if (target == null) return row.actualReps > 0; // no defined target → any completed rep counts
  if (row.actualReps < target) return false;

  const rpe = row.rpe ?? 7;
  if (rpe <= 7) return true;
  if (rpe === 8) return row.actualReps > target; // needed at least one extra rep
  return false; // rpe 9-10
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Count how many sessions at the front of the array missed the target reps
 * consecutively (most-recent first). Stops at the first success.
 */
function countConsecutiveFails(rows: HistoryRow[], targetReps: number | null): number {
  let count = 0;
  for (const row of rows) {
    const target = row.targetReps ?? targetReps;
    if (target != null && row.actualReps < target) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// ─── Core suggestion builder ────────────────────────────────────────────────

/**
 * Build a progressive overload suggestion for one program set.
 *
 * @param rows     Recent history rows for this exerciseId+setNumber, sorted
 *                 by date DESC (most-recent first). Pass up to CONSENSUS_WINDOW.
 * @param ps       Program set + exercise settings.
 * @param profile  User profile for default increment fallback. May be null.
 * @param readiness Pre-workout readiness score (1–5). When ≤ 2, a progression
 *                 suggestion is downgraded to "held-readiness".
 * @returns        A SetSuggestion, or null if there is no history to base one on.
 */
export function buildSuggestion(
  rows: HistoryRow[],
  ps: ProgramSetData,
  profile: UserProfile | null,
  readiness?: number | null,
): SetSuggestion | null {
  if (rows.length === 0) return null;

  const latest = rows[0]; // most recent session — used for "Last: 75kg" display
  const baseWeight = Number(latest.weightKg); // raw, no rounding

  const incrementKg = adaptiveIncrementKg(
    ps.overloadIncrementKg != null ? Number(ps.overloadIncrementKg) : null,
    baseWeight,
    ps.movementPattern,
    profile?.goal,
    profile?.experienceLevel,
    ps.exerciseType,
  );
  // For "time" mode, overloadIncrementReps encodes seconds increment.
  // (overloadIncrementReps is unused for timed exercises in all other modes.)
  const incrementReps = Number(ps.overloadIncrementReps ?? 0);
  const mode = ps.progressionMode ?? "manual";

  const roundToInc = (kg: number) => roundToNearest(kg, incrementKg);

  // ── Estimated 1RM from latest set ──────────────────────────────────────────
  const estimated1RM: number | null =
    baseWeight > 0 &&
    latest.actualReps >= 2 &&
    latest.actualReps <= 12
      ? Math.round(estimate1RM(baseWeight, latest.actualReps) * 10) / 10
      : null;

  // ── Consensus: count confident hits across the window ──
  const hitsWithConfidence = mode === "time"
    ? rows.filter((r) => {
        const target = ps.durationSeconds ?? r.durationSeconds;
        if (target == null || (r.durationSeconds ?? 0) < target) return false;
        const rpe = r.rpe ?? 7;
        return rpe <= 8; // RPE 9–10 = not confident (near-max effort)
      })
    : mode === "distance"
    ? rows.filter((r) => {
        const target = ps.distanceMeters ?? r.distanceMeters;
        if (target == null || (r.distanceMeters ?? 0) < target) return false;
        const rpe = r.rpe ?? 7;
        return rpe <= 8;
      })
    : rows.filter((r) => isConfidentHit(r, ps.targetReps));

  const hitsAchieved = hitsWithConfidence.length;
  const shouldProgress = hitsAchieved >= REQUIRED_HITS;

  // ── Deload detection: last DELOAD_THRESHOLD sessions all missed ──
  // Only applies to weight-bearing modes (not manual, not time).
  const canDeload = mode === "weight" || mode === "smart" || mode === "reps";
  const recentSlice = rows.slice(0, DELOAD_THRESHOLD);
  const allRecentFailed =
    recentSlice.length >= DELOAD_THRESHOLD &&
    recentSlice.every((r) => {
      const target = r.targetReps ?? ps.targetReps;
      return target != null && r.actualReps < target;
    });
  const isStuck = canDeload && allRecentFailed && hitsWithConfidence.length === 0;

  // ── Sessions until deload warning ──────────────────────────────────────────
  let sessionsUntilDeload: number | null = null;
  if (canDeload) {
    if (isStuck) {
      sessionsUntilDeload = 0;
    } else {
      const consecutiveFails = countConsecutiveFails(rows, ps.targetReps);
      sessionsUntilDeload = consecutiveFails === 0
        ? null
        : DELOAD_THRESHOLD - consecutiveFails;
    }
  }

  // ── Shared "basedOn" fields ──
  const basedOn = {
    basedOnWeightKg: baseWeight,
    basedOnReps: latest.actualReps ?? 0,
    basedOnFeeling: latest.feeling ?? "OK",
    basedOnDate: latest.date,
    basedOnRpe: latest.rpe ?? undefined,
    basedOnHitCount: hitsAchieved,
    // Enriched fields
    hitsAchieved,
    hitsRequired: REQUIRED_HITS,
    sessionsUntilDeload,
    estimated1RM,
    readinessModulated: false,
    exerciseName: ps.exerciseName,
  };

  // ── Deload takes priority over all mode-specific logic ──
  if (isStuck) {
    return {
      suggestedWeightKg: roundToInc(baseWeight * DELOAD_FACTOR),
      ...basedOn,
      reason: "deload",
    };
  }

  // ── Recovery: last session was lower weight or fewer reps than the one before ─
  // Suggest returning to the previous value before progressing further.
  // Only applies to weight-bearing modes; deload already handled above.
  // Guard: if the weight drop was preceded by consecutive failures (an intentional
  // deload), do NOT suggest going back up immediately.
  if (rows.length >= 2 && (mode === "weight" || mode === "smart" || mode === "reps")) {
    const prev = rows[1];
    const prevWeight = Number(prev.weightKg);

    if (prevWeight > baseWeight) {
      // Weight decreased — only retry if the drop was a one-off, not a deload
      const prevFailStreak = countConsecutiveFails(rows.slice(1), ps.targetReps);
      const wasIntentionalDeload = prevFailStreak >= DELOAD_THRESHOLD - 1;
      if (!wasIntentionalDeload) {
        return {
          suggestedWeightKg: prevWeight,
          ...basedOn,
          reason: "retry",
        };
      }
    }

    if (prevWeight === baseWeight && prev.actualReps > latest.actualReps && prev.actualReps > 0) {
      // Same weight but fewer reps — suggest matching previous rep count
      return {
        suggestedWeightKg: baseWeight,
        suggestedReps: prev.actualReps,
        ...basedOn,
        reason: "retry",
      };
    }
  }

  // ── Build mode-specific suggestion ──────────────────────────────────────────
  let suggestion: SetSuggestion;

  switch (mode) {
    case "none":
      return null;

    case "manual":
      suggestion = { suggestedWeightKg: baseWeight, ...basedOn, reason: "manual" };
      break;

    case "weight":
      // Bodyweight exercises (weight=0) can't progress by adding kg — fall back to reps.
      if (baseWeight === 0) {
        const bwTarget = ps.targetReps ?? latest.targetReps;
        if (shouldProgress && incrementReps > 0 && bwTarget != null) {
          suggestion = {
            suggestedWeightKg: 0,
            suggestedReps: bwTarget + incrementReps,
            ...basedOn,
            reason: "progressed-reps",
          };
        } else {
          suggestion = { suggestedWeightKg: 0, ...basedOn, reason: "held" };
        }
        break;
      }
      if (shouldProgress && incrementKg > 0) {
        suggestion = {
          suggestedWeightKg: roundToInc(baseWeight + incrementKg),
          ...basedOn,
          reason: "progressed",
        };
      } else {
        suggestion = { suggestedWeightKg: baseWeight, ...basedOn, reason: "held" };
      }
      break;

    case "smart": {
      // Bodyweight exercises (weight=0) can't use 1RM logic — fall back to reps.
      if (baseWeight === 0) {
        const bwTarget = ps.targetReps ?? latest.targetReps;
        if (shouldProgress && incrementReps > 0 && bwTarget != null) {
          suggestion = {
            suggestedWeightKg: 0,
            suggestedReps: bwTarget + incrementReps,
            ...basedOn,
            reason: "progressed-reps",
          };
        } else {
          suggestion = { suggestedWeightKg: 0, ...basedOn, reason: "held" };
        }
        break;
      }
      if (shouldProgress && incrementKg > 0) {
        const newWeight = roundToInc(baseWeight + incrementKg);
        let adjustedRepsForWeight: number | undefined;
        // 1RM estimation: only valid for weight > 0, 2–12 reps, and a near-max
        // last set (RPE ≥ 7). Sub-max sets aren't on the Epley curve, so an
        // estimated rep cut would be meaningless.
        const canComputeRM =
          baseWeight > 0 &&
          latest.actualReps != null &&
          latest.actualReps >= 2 &&
          latest.actualReps <= 12 &&
          latest.rpe != null &&
          latest.rpe >= 7;
        if (canComputeRM && newWeight > baseWeight) {
          const oneRM = estimate1RM(baseWeight, latest.actualReps);
          const adj = estimateRepsAt(oneRM, newWeight);
          const currentTarget = ps.targetReps ?? latest.targetReps ?? latest.actualReps;
          if (currentTarget != null && adj < currentTarget) {
            adjustedRepsForWeight = adj;
          }
        }
        suggestion = {
          suggestedWeightKg: newWeight,
          adjustedRepsForWeight,
          ...basedOn,
          reason: "progressed",
        };
      } else {
        suggestion = { suggestedWeightKg: baseWeight, ...basedOn, reason: "held" };
      }
      break;
    }

    case "reps": {
      const targetReps = ps.targetReps ?? latest.targetReps;
      if (shouldProgress && incrementReps > 0 && targetReps != null) {
        suggestion = {
          suggestedWeightKg: baseWeight,
          suggestedReps: targetReps + incrementReps,
          ...basedOn,
          reason: "progressed-reps",
        };
      } else {
        suggestion = { suggestedWeightKg: baseWeight, ...basedOn, reason: "held" };
      }
      break;
    }

    case "time": {
      const targetDuration = ps.durationSeconds ?? latest.durationSeconds;
      const actualDuration = latest.durationSeconds ?? 0;
      // overloadIncrementReps doubles as seconds increment for time mode;
      // fall back to 10s if not configured.
      const incrementSecs = incrementReps > 0 ? incrementReps : 10;
      const basedOnWithDuration = {
        ...basedOn,
        basedOnDurationSeconds: actualDuration > 0 ? actualDuration : undefined,
      };
      if (targetDuration != null && actualDuration >= targetDuration && shouldProgress) {
        suggestion = {
          suggestedWeightKg: baseWeight,
          suggestedDurationSeconds: actualDuration + incrementSecs,
          ...basedOnWithDuration,
          reason: "progressed-time",
        };
      } else {
        suggestion = { suggestedWeightKg: baseWeight, ...basedOnWithDuration, reason: "held" };
      }
      break;
    }

    case "distance": {
      const targetDistance = ps.distanceMeters ?? latest.distanceMeters;
      const actualDistance = latest.distanceMeters ?? 0;
      // overloadIncrementReps doubles as meters increment for distance mode;
      // fall back to 500m (+0.5km) if not configured.
      const incrementMeters = incrementReps > 0 ? incrementReps : 500;
      const basedOnWithDistance = {
        ...basedOn,
        basedOnDistanceMeters: actualDistance > 0 ? actualDistance : undefined,
      };
      if (targetDistance != null && actualDistance >= targetDistance && shouldProgress) {
        suggestion = {
          suggestedWeightKg: 0,
          suggestedDistanceMeters: actualDistance + incrementMeters,
          ...basedOnWithDistance,
          reason: "progressed-distance",
        };
      } else {
        suggestion = { suggestedWeightKg: 0, ...basedOnWithDistance, reason: "held" };
      }
      break;
    }

    default:
      suggestion = { suggestedWeightKg: baseWeight, ...basedOn, reason: "manual" };
  }

  // ── Readiness modulation: low energy → hold all progressions ────────────
  if (
    readiness != null &&
    readiness <= 2 &&
    (suggestion.reason === "progressed" ||
      suggestion.reason === "progressed-reps" ||
      suggestion.reason === "progressed-time" ||
      suggestion.reason === "progressed-distance")
  ) {
    suggestion = {
      ...suggestion,
      reason: "held-readiness",
      suggestedWeightKg: baseWeight,
      suggestedReps: undefined,
      suggestedDurationSeconds: undefined,
      suggestedDistanceMeters: undefined,
      readinessModulated: true,
    };
  }

  return suggestion;
}
