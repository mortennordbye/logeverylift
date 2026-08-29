/**
 * Progression presets.
 *
 * A preset is a *named set of axis values*, nothing more. It is deliberately
 * not a column: a stored preset would be display-only state the engine does
 * not read, derivable from the axes it duplicates, and free to drift out of
 * step with them. That is exactly how `target_rir` sat dead in the schema for
 * a year. The label is derived at render time by matching the live axis values
 * against this table, and anything that matches nothing is **Custom**.
 *
 * The table is section 3 of docs/progression-revamp-plan.md.
 */

import {
  DELOAD_PCT,
  DELOAD_THRESHOLD,
  REQUIRED_HITS,
  toAdvance,
  toReadiness,
  toRegress,
  toScope,
  type ProgressionAdvance,
  type ProgressionReadiness,
  type ProgressionRegress,
  type ProgressionScope,
} from "@/lib/utils/progression";

/** The axis values a preset fixes. Everything else is per-exercise detail. */
export type ProgressionAxes = {
  advance: ProgressionAdvance;
  scope: ProgressionScope;
  requiredHits: number;
  regress: ProgressionRegress;
  backoffPct: number;
  backoffAfter: number;
  readiness: ProgressionReadiness;
  /** Whether the sets carry a rep range. Presets require one, forbid one, or don't care. */
  hasRange: boolean;
  /** Whether the deciding set carries an effort cap. */
  hasEffortCap: boolean;
};

export type ProgressionPreset = {
  id: string;
  label: string;
  description: string;
  /**
   * The axis values picking this preset writes. `hasRange` and `hasEffortCap`
   * are not written here — a range lives on the set and is the lifter's to
   * enter — but they are matched, so a preset that needs a range does not
   * claim an exercise that has none.
   */
  axes: Omit<ProgressionAxes, "hasRange" | "hasEffortCap">;
  /** null = the preset does not care either way. */
  requiresRange: boolean | null;
  requiresEffortCap: boolean | null;
  /** Which measures this preset makes sense for. */
  measures: readonly ("reps" | "duration" | "distance")[];
};

const BACKOFF = {
  regress: "backoff" as const,
  backoffPct: DELOAD_PCT,
  backoffAfter: DELOAD_THRESHOLD,
};
const HOLD = {
  regress: "hold" as const,
  backoffPct: DELOAD_PCT,
  backoffAfter: DELOAD_THRESHOLD,
};

export const PROGRESSION_PRESETS: readonly ProgressionPreset[] = [
  {
    id: "linear-load",
    label: "Linear load",
    description: "Add weight every session you clear it. StrongLifts-style.",
    axes: { advance: "load", scope: "all", requiredHits: 1, ...BACKOFF, readiness: "hold" },
    requiresRange: false,
    requiresEffortCap: false,
    measures: ["reps"],
  },
  {
    id: "load-confirmed",
    label: "Load, confirmed",
    description: "Fixed reps. Prove it twice before the weight moves.",
    axes: { advance: "load", scope: "all", requiredHits: REQUIRED_HITS, ...BACKOFF, readiness: "hold" },
    requiresRange: false,
    requiresEffortCap: false,
    measures: ["reps"],
  },
  {
    id: "double",
    label: "Double progression",
    description: "Work a rep range: climb to the top, then add weight and drop back.",
    axes: { advance: "double", scope: "all", requiredHits: 1, ...BACKOFF, readiness: "hold" },
    requiresRange: true,
    requiresEffortCap: false,
    measures: ["reps"],
  },
  {
    id: "double-top-set",
    label: "Double progression, top set",
    description: "Same, but the first set decides and the back-offs follow it.",
    axes: { advance: "double", scope: "first", requiredHits: 1, ...BACKOFF, readiness: "hold" },
    requiresRange: true,
    requiresEffortCap: false,
    measures: ["reps"],
  },
  {
    id: "autoregulated",
    label: "Autoregulated",
    description: "Only moves when the reps came with the reps in reserve you asked for.",
    axes: { advance: "load", scope: "all", requiredHits: REQUIRED_HITS, ...BACKOFF, readiness: "hold" },
    requiresRange: null,
    requiresEffortCap: true,
    measures: ["reps"],
  },
  {
    id: "rep-ladder",
    label: "Rep ladder",
    description: "No weight to add — the reps climb instead. Chin-ups, push-ups.",
    axes: { advance: "reps", scope: "all", requiredHits: 1, ...HOLD, readiness: "hold" },
    requiresRange: null,
    requiresEffortCap: false,
    measures: ["reps"],
  },
  {
    id: "duration",
    label: "Duration",
    description: "Hold it longer. Planks, carries, steady cardio.",
    axes: { advance: "duration", scope: "all", requiredHits: REQUIRED_HITS, ...HOLD, readiness: "hold" },
    requiresRange: false,
    requiresEffortCap: false,
    measures: ["duration"],
  },
  {
    id: "distance",
    label: "Distance",
    description: "Go further. Running, rowing, endurance.",
    axes: { advance: "distance", scope: "all", requiredHits: REQUIRED_HITS, ...HOLD, readiness: "hold" },
    requiresRange: false,
    requiresEffortCap: false,
    measures: ["distance"],
  },
  {
    id: "manual",
    label: "Manual",
    description: "Shows what you did last time and proposes nothing.",
    axes: { advance: "manual", scope: "all", requiredHits: REQUIRED_HITS, ...HOLD, readiness: "hold" },
    requiresRange: null,
    requiresEffortCap: null,
    measures: ["reps", "duration", "distance"],
  },
  {
    id: "off",
    label: "Off",
    description: "No suggestions, no chips, no dots.",
    axes: { advance: "none", scope: "all", requiredHits: REQUIRED_HITS, ...HOLD, readiness: "hold" },
    requiresRange: null,
    requiresEffortCap: null,
    measures: ["reps", "duration", "distance"],
  },
] as const;

/**
 * Which preset an exercise is on, or null for **Custom**.
 *
 * `manual` and `off` are matched on the advance alone: they suggest nothing, so
 * the gate, the scope and the back-off numbers underneath them describe a rule
 * that never runs, and letting stale values there relabel the exercise Custom
 * would be a distinction with no behaviour behind it.
 */
export function matchPreset(axes: ProgressionAxes): ProgressionPreset | null {
  for (const preset of PROGRESSION_PRESETS) {
    const a = preset.axes;
    if (a.advance !== axes.advance) continue;
    if (a.advance === "manual" || a.advance === "none") return preset;
    if (
      a.scope !== axes.scope ||
      a.requiredHits !== axes.requiredHits ||
      a.regress !== axes.regress ||
      a.readiness !== axes.readiness
    ) {
      continue;
    }
    if (a.regress === "backoff" && (a.backoffPct !== axes.backoffPct || a.backoffAfter !== axes.backoffAfter)) {
      continue;
    }
    if (preset.requiresRange != null && preset.requiresRange !== axes.hasRange) continue;
    if (preset.requiresEffortCap != null && preset.requiresEffortCap !== axes.hasEffortCap) continue;
    return preset;
  }
  return null;
}

/** The label for the badge and the sheet header. */
export function presetLabel(axes: ProgressionAxes): string {
  return matchPreset(axes)?.label ?? "Custom";
}

/** Narrow raw column values into the shape the matcher wants. */
export function toAxes(input: {
  advance: string | null;
  scope: string | null;
  requiredHits: number | null;
  regress: string | null;
  backoffPct: number | null;
  backoffAfter: number | null;
  readiness: string | null;
  hasRange: boolean;
  hasEffortCap: boolean;
}): ProgressionAxes {
  return {
    advance: toAdvance(input.advance),
    scope: toScope(input.scope),
    requiredHits: input.requiredHits ?? REQUIRED_HITS,
    regress: toRegress(input.regress),
    backoffPct: input.backoffPct ?? DELOAD_PCT,
    backoffAfter: input.backoffAfter ?? DELOAD_THRESHOLD,
    readiness: toReadiness(input.readiness),
    hasRange: input.hasRange,
    hasEffortCap: input.hasEffortCap,
  };
}
