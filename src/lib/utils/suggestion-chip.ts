import type { SetSuggestion } from "@/types/workout";

type ChipSuggestion = Pick<
  SetSuggestion,
  | "reason"
  | "suggestedWeightKg"
  | "suggestedReps"
  | "suggestedDurationSeconds"
  | "suggestedDistanceMeters"
>;

/** The planned values a chip compares against to know whether it was taken. */
export type ChipSet = {
  weightKg: string | number | null;
  targetReps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
};

/**
 * Whether the suggestion still has something to apply to this set. False once
 * the set already carries the suggested values, which is what turns a chip's
 * arrow into a tick. Reasons that render no chip (held, manual, the labels)
 * are never pending.
 */
export function suggestionPending(s: ChipSuggestion, set: ChipSet): boolean {
  const weight = Number(set.weightKg ?? 0);
  const reps = set.targetReps ?? 0;
  switch (s.reason) {
    case "progressed":
    case "deload":
    case "re-approach":
      return weight !== s.suggestedWeightKg;
    case "retry":
      return s.suggestedReps === undefined
        ? weight !== s.suggestedWeightKg
        : s.suggestedReps !== reps;
    // A reset moves two numbers at once, so it is outstanding while either of
    // them is still to be taken.
    case "reset":
      return (
        weight !== s.suggestedWeightKg ||
        (s.suggestedReps !== undefined && s.suggestedReps !== reps)
      );
    case "progressed-reps":
      return s.suggestedReps !== undefined && s.suggestedReps > reps;
    case "progressed-time":
      return (
        s.suggestedDurationSeconds !== undefined &&
        s.suggestedDurationSeconds !== (set.durationSeconds ?? 0)
      );
    case "progressed-distance":
      return (
        s.suggestedDistanceMeters !== undefined &&
        s.suggestedDistanceMeters !== (set.distanceMeters ?? 0)
      );
    default:
      return false;
  }
}

/** Two suggestions propose the same move. */
export function sameSuggestion(a: ChipSuggestion, b: ChipSuggestion): boolean {
  return (
    a.reason === b.reason &&
    a.suggestedWeightKg === b.suggestedWeightKg &&
    a.suggestedReps === b.suggestedReps &&
    a.suggestedDurationSeconds === b.suggestedDurationSeconds &&
    a.suggestedDistanceMeters === b.suggestedDistanceMeters
  );
}

const CHIP_REASONS: ReadonlySet<SetSuggestion["reason"]> = new Set([
  "progressed",
  "deload",
  "re-approach",
  "retry",
  "reset",
  "progressed-reps",
  "progressed-time",
  "progressed-distance",
]);

/**
 * The sets that should share one chip: every set with a suggestion, when there
 * are at least two of them and they all propose the same move. Null otherwise,
 * and each set keeps its own chip.
 *
 * Decided from the suggestions alone, never from what has been logged or
 * applied, so the grouping cannot change mid-workout and move a chip from one
 * row to another under the lifter's finger.
 */
export function sharedSuggestionSets(
  setIds: readonly number[],
  suggestions: Record<number, ChipSuggestion> | undefined,
): number[] | null {
  if (!suggestions) return null;
  const withSuggestion = setIds.filter((id) => suggestions[id] != null);
  if (withSuggestion.length < 2) return null;
  const first = suggestions[withSuggestion[0]];
  if (!CHIP_REASONS.has(first.reason)) return null;
  return withSuggestion.every((id) => sameSuggestion(suggestions[id], first))
    ? withSuggestion
    : null;
}
