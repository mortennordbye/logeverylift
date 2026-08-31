"use client";

import { WorkoutSetsList } from "@/components/features/WorkoutSetsList";
import {
  applyProgressionToPlan,
  deleteProgramSet,
  setProgramExerciseApplyToPlan,
  setProgramExerciseProgression,
  setProgramExerciseSetDefaults,
  setProgramExerciseType,
  updateProgramExerciseIncrement,
  updateProgramExerciseIncrementReps,
} from "@/lib/actions/programs";
import { useRenderedOverrides, useWorkoutSession } from "@/contexts/workout-session-context";
import {
  EXERCISE_TYPES,
  EXERCISE_TYPE_LABELS,
  resolveExerciseType,
  type ExerciseType,
} from "@/lib/utils/exercise-type";
import { sanitizeDecimalInput } from "@/lib/utils/format";
import {
  DELOAD_PCT,
  DELOAD_THRESHOLD,
  MAX_REQUIRED_HITS,
  REQUIRED_HITS,
  describeProgressionRule,
  pendingProgressions,
  type PendingProgression,
  type ProgressionAdvance,
  type ProgressionReadiness,
  type ProgressionRegress,
  toAdvance,
  toReadiness,
  toRegress,
  toScope,
  type ProgressionScope,
} from "@/lib/utils/progression";
import {
  PROGRESSION_PRESETS,
  REP_RANGE_PRESETS,
  defaultRepRangeFor,
  matchPreset,
  presetLabel,
  type ProgressionPreset,
} from "@/lib/utils/progression-presets";
import type { Discipline } from "@/lib/utils/discipline";
import type { ProgramSet } from "@/types/workout";
import {
  AlignEndVerticalIcon,
  CheckCheckIcon,
  ChevronLeftIcon,
  ChevronsUpIcon,
  CircleSlashIcon,
  DumbbellIcon,
  GaugeIcon,
  HandIcon,
  MoonIcon,
  Plus,
  Repeat2Icon,
  RulerIcon,
  TimerIcon,
  TrendingDownIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

// SetSuggestionDisplay is the canonical SetSuggestion type from types/workout.ts
export type { SetSuggestion as SetSuggestionDisplay } from "@/types/workout";
import type { SetSuggestion } from "@/types/workout";

const KG_INCREMENT_PRESETS = [0.5, 1, 2.5, 5, 10] as const;
/** Sessions-at-target presets. Beyond 3 the gate is slower than most cycles. */
const REQUIRED_HITS_PRESETS = [1, 2, 3] as const;
/** Stable identity so the pending-suggestion memo doesn't rerun every render. */
const EMPTY_SET_IDS: ReadonlySet<number> = new Set<number>();
const REP_INCREMENT_PRESETS = [1, 2, 3] as const;
const DISTANCE_INCREMENT_PRESETS_M = [500, 1000, 2000] as const;
const BACKOFF_PCT_PRESETS = [5, 10, 15, 20] as const;

const EFFORT_CAP_PRESETS = [0, 1, 2, 3, 4] as const;

/**
 * The glyph on a preset row says what *moves*, so it maps to the advance axis
 * rather than to the preset. Five glyphs cover eight schemes, which is the
 * point: three rows share the dumbbell because all three add weight, and the
 * list sorts itself into weight schemes, range schemes and no-suggestion
 * schemes before the labels are read. Keying it to the preset instead would
 * need a new entry per scheme and would group nothing.
 */
const ADVANCE_ICON: Record<ProgressionAdvance, typeof DumbbellIcon> = {
  load: DumbbellIcon,
  double: Repeat2Icon,
  reps: ChevronsUpIcon,
  duration: TimerIcon,
  distance: RulerIcon,
  manual: HandIcon,
  none: CircleSlashIcon,
};

/** Every axis the sheet writes, held together so the sentence can quote them all. */
type Axes = {
  advance: ProgressionAdvance;
  scope: ProgressionScope;
  requiredHits: number | null;
  regress: ProgressionRegress;
  backoffPct: number;
  backoffAfter: number;
  readiness: ProgressionReadiness;
};

const SCOPE_OPTIONS: { value: ProgressionScope; label: string }[] = [
  { value: "all", label: "Every set" },
  { value: "first", label: "First set" },
  { value: "last", label: "Last set" },
  { value: "set", label: "Each set alone" },
];

const READINESS_OPTIONS: { value: ProgressionReadiness; label: string }[] = [
  { value: "ignore", label: "Ignore" },
  { value: "hold", label: "Hold" },
  { value: "reduce", label: "Back off" },
];

type Props = {
  programId: number;
  programExerciseId: number;
  exerciseName: string;
  exerciseId?: number;
  sets: ProgramSet[];
  isWorkout?: boolean;
  exerciseCategory?: string;
  exerciseIsTimed?: boolean;
  exerciseDiscipline?: Discipline | null;
  suggestions?: Record<number, SetSuggestion>;
  overloadIncrementKg?: number | null;
  overloadIncrementReps?: number;
  /** Axis 6 — what moves when the gate is met. */
  progressionAdvance?: string | null;
  /** Sessions at target before a bump. Null = the shared REQUIRED_HITS default. */
  progressionRequiredHits?: number | null;
  /** Axis 4 — which sets have to clear for a session to count. */
  progressionScope?: string | null;
  /** Axis 7 and its two numbers. */
  progressionRegress?: string | null;
  progressionBackoffPct?: number | null;
  progressionBackoffAfter?: number | null;
  /** Axis 8 — what a low readiness score does. */
  progressionReadiness?: string | null;
  /** Opt-in: accepting a bump also rewrites the planned sets. */
  progressionApplyToPlan?: boolean;
  /** Exercise's intrinsic type (the default shown when there's no override). */
  exerciseTypeDefault?: string | null;
  /** Per-program override of the exercise type; null = inherit the default. */
  exerciseTypeOverride?: string | null;
  initialEditing?: boolean;
};

export function WorkoutSetsClient({
  programId,
  programExerciseId,
  exerciseName,
  exerciseId,
  sets: initial,
  isWorkout = false,
  exerciseCategory,
  exerciseIsTimed = false,
  exerciseDiscipline = null,
  suggestions,
  overloadIncrementKg: initialIncrement = null,
  overloadIncrementReps: initialIncrementReps = 0,
  progressionAdvance: initialAdvance = "manual",
  progressionRequiredHits: initialRequiredHits = null,
  progressionScope: initialScope = null,
  progressionRegress: initialRegress = null,
  progressionBackoffPct: initialBackoffPct = null,
  progressionBackoffAfter: initialBackoffAfter = null,
  progressionReadiness: initialReadiness = null,
  progressionApplyToPlan: initialApplyToPlan = false,
  exerciseTypeDefault = null,
  exerciseTypeOverride: initialTypeOverride = null,
  initialEditing = false,
}: Props) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(initialEditing);
  const [showProgressionPicker, setShowProgressionPicker] = useState(false);
  const [customKgInput, setCustomKgInput] = useState("");
  const [customRepInput, setCustomRepInput] = useState("");
  const [sets, setSets] = useState(initial);
  const [increment, setIncrement] = useState(initialIncrement);
  const [incrementReps, setIncrementReps] = useState(initialIncrementReps);
  const [typeOverride, setTypeOverride] = useState<string | null>(initialTypeOverride);
  const [applyToPlan, setApplyToPlan] = useState(initialApplyToPlan);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showCustomKg, setShowCustomKg] = useState(false);
  const [showCustomReps, setShowCustomReps] = useState(false);
  const [axes, setAxes] = useState<Axes>(() => {
    const isRunningEx =
      exerciseCategory === "cardio" && !exerciseIsTimed;
    // Snap a stale advance onto something the exercise can actually do. A
    // strength scheme on a plank has no measure to move.
    const advance = toAdvance(initialAdvance);
    const snapped: ProgressionAdvance =
      exerciseIsTimed && advance !== "manual" && advance !== "none" && advance !== "duration"
        ? "duration"
        : isRunningEx && advance !== "manual" && advance !== "none" && advance !== "distance"
          ? "manual"
          : advance;
    return {
      advance: snapped,
      scope: toScope(initialScope),
      requiredHits: initialRequiredHits,
      regress: toRegress(initialRegress),
      backoffPct: initialBackoffPct ?? DELOAD_PCT,
      backoffAfter: initialBackoffAfter ?? DELOAD_THRESHOLD,
      readiness: toReadiness(initialReadiness),
    };
  });
  const workoutSession = useWorkoutSession();
  // Rendered output only — applySuggestion et al. still write through
  // workoutSession.setOverride.
  const renderedOverrides = useRenderedOverrides();

  useEffect(() => {
    setSets(initial);
  }, [initial]);

  // Compute the best estimated 1RM across all sets for this exercise
  const bestEstimated1RM = useMemo(() => {
    if (!suggestions) return null;
    let best: number | null = null;
    for (const set of sets) {
      const sug = suggestions[set.id];
      if (sug?.estimated1RM != null) {
        if (best === null || sug.estimated1RM > best) best = sug.estimated1RM;
      }
    }
    return best;
  }, [suggestions, sets]);

  const displaySets = sets.map((s) => {
    const ov = renderedOverrides[s.id];
    if (!ov) return s;
    return {
      ...s,
      targetReps: ov.targetReps,
      weightKg: String(ov.weightKg) as typeof s.weightKg,
    };
  });

  const isRunning = (exerciseCategory === "cardio" && !exerciseIsTimed) || exerciseDiscipline != null;

  // The rule sentence quotes a rep target; the first working set is the one the
  // lifter thinks of as "the" target. Null when there is nothing to quote yet.
  const firstWorkingSet =
    sets.find((s) => (s.setType ?? "working") === "working" && s.targetReps != null) ??
    null;
  const firstWorkingTargetReps = firstWorkingSet?.targetReps ?? null;

  const workingSets = sets.filter((s) => (s.setType ?? "working") === "working");
  // The range the sheet edits and the sentence quotes. Read off the first
  // working set that carries one — the sheet writes them all together, so they
  // agree unless somebody edited one set by hand.
  const repRange =
    workingSets.find((s) => s.repRangeMin != null && s.repRangeMax != null) ?? null;
  // D-8: the cap that decides clearing is the one on the set the scope names,
  // and the server resolves it exactly this way. The sheet has to agree, or the
  // preset name and the sentence describe a cap the engine is not reading.
  const capSet =
    axes.scope === "first" ? workingSets[0] : workingSets[workingSets.length - 1];
  const effortCap = capSet?.targetRir ?? null;
  // The cycle owns an anchored set's target, so the sentence has to say so
  // rather than promising an advance the engine will refuse (SI-30a).
  const anchored = workingSets.some(
    (s) => s.peakDurationSeconds != null || s.peakDistanceMeters != null,
  );

  // Layer 1's list, filtered to the schemes this exercise's measure can run. A
  // plank has no reps to double-progress and a run has no weight to add.
  const measure = isRunning ? "distance" : exerciseIsTimed ? "duration" : "reps";
  const availablePresets = PROGRESSION_PRESETS.filter((p) =>
    p.measures.includes(measure),
  );
  const matchedAxes = {
    ...axes,
    requiredHits: axes.requiredHits ?? REQUIRED_HITS,
    hasRange: repRange != null,
    hasEffortCap: effortCap != null,
  };
  const matchedPreset = matchPreset(matchedAxes);
  const currentPresetId = matchedPreset?.id ?? null;
  /** The header quotes this, so it has to be the object and not just the id. */
  const selectedPreset = matchedPreset ?? null;

  /**
   * The per-set parameters a scheme cannot work without, surfaced beside the
   * scheme instead of under Advanced. They share one grid cell for the same
   * reason the increment sections do: only one can ever apply, and stacking
   * them keeps this area a constant height whichever is showing.
   *
   * Both are reps-only, so a timed or running exercise renders neither and the
   * slot collapses to nothing.
   */
  const showRepRange = axes.advance === "double";
  const showEffortCap = selectedPreset?.requiresEffortCap === true || effortCap != null;
  const hasConditionalSlot = showRepRange || showEffortCap;

  // Layer 2. Built from the live axis values every render, so it describes what
  // the engine will do rather than what the sheet last wrote.
  const ruleSentence = describeProgressionRule({
    advance: axes.advance,
    incrementKg: increment,
    incrementReps,
    targetReps: firstWorkingTargetReps,
    // Same set, same reasoning: the range the sentence quotes is the one on the
    // set the lifter thinks of as the target.
    repRangeMin: repRange?.repRangeMin,
    repRangeMax: repRange?.repRangeMax,
    requiredHits: axes.requiredHits ?? REQUIRED_HITS,
    scope: axes.scope,
    effortCap,
    regress: axes.regress,
    backoffPct: axes.backoffPct,
    backoffAfter: axes.backoffAfter,
    readiness: axes.readiness,
    anchored,
  });

  // Increment sections this exercise can ever reach, mirroring the mode filter
  // in the progression sheet. They all render into a single grid cell, so that
  // area is permanently as tall as the tallest one it could show and picking a
  // mode only swaps which is visible.
  //
  // The sheet is bottom-anchored (`items-end`), so anything that changes its
  // height moves every row upward — including the one the user just tapped.
  // Measured at 141px before this: tapping "Weight" mounted the increment
  // block and threw that row up under the user's finger onto "Smart weight".
  // Reserving per-exercise rather than fixing the sheet to 80vh keeps the
  // timed/running sheets (one reachable section) from becoming a mostly-empty
  // full-height card.
  const incrementSections: ("weight" | "reps" | "time" | "distance")[] =
    isRunning ? ["distance"] : exerciseIsTimed ? ["time"] : ["weight", "reps"];

  // Today's values with the blueprint carried alongside. The first decides
  // whether a suggestion has been taken yet, the second whether writing it
  // would lower the plan — see PendingSetInput.planned.
  //
  // Built once and shared: applySuggestion filters this same array down to one
  // set rather than assembling its own input. The per-set and apply-all paths
  // having separately-built inputs is what let them drift apart before.
  const pendingInputs = displaySets.map((s) => ({
    ...s,
    planned: sets.find((p) => p.id === s.id),
  }));
  const completedSetIds = workoutSession?.completedSetIds ?? EMPTY_SET_IDS;

  // Suggestions the lifter hasn't taken yet, in the values applying them would
  // write. Reads the override-folded sets so a set drops out the moment it is
  // already at the suggested numbers.
  const pending = isWorkout
    ? pendingProgressions(pendingInputs, suggestions, completedSetIds)
    : [];

  // Only label the chip with a weight when every pending set lands on the same
  // one — sets progress independently, so they can legitimately disagree.
  const pendingWeights = pending.map((p) => p.weightKg);
  const pendingWeight =
    pendingWeights.length > 0 &&
    !pendingWeights.some((w) => w === undefined) &&
    new Set(pendingWeights).size === 1
      ? (pendingWeights[0] as number)
      : null;
  // The arrow is derived from the comparison, never from the reason — the same
  // rule the per-set chip follows. A back-off and a re-approach both propose a
  // *lower* number, and this chip used to claim "↑" over either of them.
  const pendingHeaviest = Math.max(
    0,
    ...pending
      .filter((p) => p.weightKg !== undefined)
      .map((p) => Number(sets.find((s) => s.id === p.setId)?.weightKg ?? 0)),
  );
  const pendingArrow =
    pendingWeight != null && pendingWeight < pendingHeaviest ? "↓" : "↑";

  /**
   * Write accepted values into the plan, when this exercise has opted in.
   *
   * Best-effort by design: the session override has already landed, so the
   * lifter's current set is unaffected if this never reaches the server. A lost
   * write costs nothing permanent either — the next suggestion is recomputed
   * from logged history, so it comes back on its own.
   */
  function persistToPlan(updates: PendingProgression[]) {
    if (!applyToPlan || updates.length === 0) return;
    void applyProgressionToPlan({
      programExerciseId,
      updates: updates.map((u) => ({
        programSetId: u.setId,
        ...(u.weightKg !== undefined ? { weightKg: u.weightKg } : {}),
        ...(u.targetReps !== undefined ? { targetReps: u.targetReps } : {}),
        ...(u.durationSeconds !== undefined
          ? { durationSeconds: u.durationSeconds }
          : {}),
        ...(u.distanceMeters !== undefined
          ? { distanceMeters: u.distanceMeters }
          : {}),
      })),
    }).catch(() => {
      // Offline or a dropped request. Swallowed on purpose — surfacing an error
      // mid-set would interrupt a lift over a plan edit that self-heals.
    });
  }

  function applySuggestion(setId: number, suggestedWeightKg: number, adjustedReps?: number, durationSeconds?: number, distanceMeters?: number) {
    if (!workoutSession) return;
    const set = sets.find((s) => s.id === setId);
    workoutSession.setOverride(setId, {
      weightKg: suggestedWeightKg,
      targetReps: adjustedReps ?? workoutSession.overrides[setId]?.targetReps ?? set?.targetReps ?? 0,
      ...(durationSeconds != null ? { durationSeconds } : {}),
      ...(distanceMeters != null ? { distanceMeters } : {}),
    });
    // Derive the plan write from pendingProgressions over this one set, using
    // the same inputs the apply-all chip uses. This used to hand-build its own
    // payload, which drifted from the engine in two ways: it wrote the
    // carried-along weight for a rep retry, and it had no floor, so a
    // suggestion sitting below the plan rewrote the plan downward behind an
    // "↑" chip. One rule, one implementation, one input.
    const input = pendingInputs.find((s) => s.id === setId);
    persistToPlan(
      input ? pendingProgressions([input], suggestions, completedSetIds) : [],
    );
  }

  function applyRepSuggestion(setId: number, suggestedReps: number) {
    if (!workoutSession) return;
    const set = sets.find((s) => s.id === setId);
    const currentReps = workoutSession.overrides[setId]?.targetReps ?? set?.targetReps ?? 0;
    const targetReps = Math.max(suggestedReps, currentReps);
    workoutSession.setOverride(setId, {
      weightKg: workoutSession.overrides[setId]?.weightKg ?? Number(set?.weightKg ?? 0),
      targetReps,
    });
    persistToPlan([{ setId, targetReps }]);
  }

  /** Take every outstanding suggestion for this exercise in one tap. */
  function applyAllPending() {
    if (!workoutSession || pending.length === 0) return;
    for (const entry of pending) {
      const set = sets.find((s) => s.id === entry.setId);
      const current = workoutSession.overrides[entry.setId];
      workoutSession.setOverride(entry.setId, {
        weightKg: entry.weightKg ?? current?.weightKg ?? Number(set?.weightKg ?? 0),
        targetReps: entry.targetReps ?? current?.targetReps ?? set?.targetReps ?? 0,
        ...(entry.durationSeconds != null
          ? { durationSeconds: entry.durationSeconds }
          : {}),
        ...(entry.distanceMeters != null
          ? { distanceMeters: entry.distanceMeters }
          : {}),
      });
    }
    persistToPlan(pending);
  }

  /**
   * Write one or more axes, optimistically.
   *
   * Reverted on failure rather than left showing a setting the server does not
   * hold: the sentence underneath is the contract with the lifter, and a
   * sentence describing a rule that was never saved is worse than no sentence.
   */
  async function updateAxes(next: Partial<Axes>) {
    const previous = axes;
    const merged = { ...axes, ...next };
    setAxes(merged);
    const result = await setProgramExerciseProgression({ programExerciseId, ...next });
    if (!result.success) {
      setAxes(previous);
      return;
    }
    router.refresh();
  }

  /**
   * Layer 1: pick a named scheme and every axis moves together.
   *
   * Autoregulated is the one preset that needs something outside the axes —
   * a cap on the sets — so picking it supplies a default rather than landing
   * on a scheme whose defining feature is unset. Everything else is exactly
   * the axis values in the preset table.
   */
  async function handlePresetChange(preset: ProgressionPreset) {
    // Both per-set defaults go in one write, so the preset lands complete
    // rather than in a state its own name does not match.
    const defaults: {
      repRangeMin?: number | null;
      repRangeMax?: number | null;
      targetRir?: number | null;
    } = {};
    if (preset.requiresEffortCap === true && effortCap == null) {
      defaults.targetRir = 2;
    }
    if (preset.requiresRange === false && repRange != null) {
      defaults.repRangeMin = null;
      defaults.repRangeMax = null;
    }
    // A double-progression preset with no range is the scheme with its subject
    // missing: it behaves as plain load progression, and the badge would read
    // Custom the instant the lifter picked it by name. Seed a range around the
    // target they already have, from the same list the sheet offers, so one
    // tap produces the scheme — and they can change it in the row below.
    if (preset.requiresRange === true && repRange == null) {
      const [min, max] = defaultRepRangeFor(firstWorkingTargetReps);
      defaults.repRangeMin = min;
      defaults.repRangeMax = max;
    }
    await updateAxes(preset.axes);
    if (Object.keys(defaults).length > 0) await handleSetDefaults(defaults);
  }

  /** Rep range and effort cap, written across every working set of the slot. */
  async function handleSetDefaults(next: {
    repRangeMin?: number | null;
    repRangeMax?: number | null;
    targetRir?: number | null;
  }) {
    const result = await setProgramExerciseSetDefaults({ programExerciseId, ...next });
    if (result.success) router.refresh();
  }

  // null clears the override so the exercise's intrinsic type is inherited.
  async function handleTypeOverrideChange(next: ExerciseType | null) {
    setTypeOverride(next);
    await setProgramExerciseType({ programExerciseId, exerciseType: next });
    router.refresh();
  }

  async function handleIncrementChange(newIncrement: number) {
    setIncrement(newIncrement);
    setCustomKgInput("");
    await updateProgramExerciseIncrement(programExerciseId, newIncrement);
    router.refresh();
  }

  async function handleApplyToPlanChange(next: boolean) {
    setApplyToPlan(next);
    const result = await setProgramExerciseApplyToPlan({
      programExerciseId,
      applyToPlan: next,
    });
    if (!result.success) {
      setApplyToPlan(!next);
      return;
    }
    router.refresh();
  }

  async function handleIncrementRepsChange(newIncrement: number) {
    setIncrementReps(newIncrement);
    setCustomRepInput("");
    await updateProgramExerciseIncrementReps(programExerciseId, newIncrement);
    router.refresh();
  }

  async function handleDeleteSet(setId: number) {
    setSets((prev) => prev.filter((s) => s.id !== setId));
    await deleteProgramSet(setId, programId, programExerciseId);
    router.push(
      isWorkout
        ? `/programs/${programId}/workout/exercises/${programExerciseId}?edit=true`
        : `/programs/${programId}/exercises/${programExerciseId}?edit=true`,
    );
  }

  /**
   * The badge on the exercise header: the preset's name, or Custom.
   *
   * Derived from the live axis values every render rather than stored. A stored
   * label is a second copy of state the engine does not read, free to drift out
   * of step with the settings it claims to describe.
   */
  function progressionBadgeLabel(): string {
    return presetLabel(matchedAxes);
  }

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center px-4 pt-6 pb-4 shrink-0">
        {/* Left — fixed width so layout never shifts */}
        <div className="w-20 shrink-0 flex items-center">
          {isEditing ? (
            <button
              onClick={() => setIsEditing(false)}
              className="text-primary text-sm font-medium"
            >
              Done
            </button>
          ) : (
            <Link
              href={isWorkout ? `/programs/${programId}/workout` : `/programs/${programId}`}
              className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]"
            >
              <ChevronLeftIcon className="h-5 w-5" />
              <span className="text-sm font-medium">Back</span>
            </Link>
          )}
        </div>
        <div className="flex-1" />
        {/* Right — fixed width so layout never shifts */}
        <div className="w-20 shrink-0 flex items-center justify-end">
          {isEditing ? (
            <Link
              href={
                isWorkout
                  ? `/programs/${programId}/workout/exercises/${programExerciseId}/sets/new`
                  // The "+" only shows in edit mode; carry the flag so the flow stays in edit mode.
                  : `/programs/${programId}/exercises/${programExerciseId}/sets/new?edit=true`
              }
              className="w-7 h-7 rounded-full border-2 border-primary flex items-center justify-center"
            >
              <Plus className="w-4 h-4 text-primary" />
            </Link>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="text-primary text-sm font-medium"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Exercise title */}
      <div className="px-4 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">{exerciseName}</h1>
      </div>

      {/* Progression badge + 1RM badge + apply-to-all.
          min-h is load-bearing: the apply-all chip is a 44px touch target that
          comes and goes with the pending count, and without a floor under the
          row its arrival and departure would shove the set list up and down
          mid-workout. */}
      <div className="px-4 pb-4 shrink-0 flex items-center gap-2 min-h-[44px]">
        <button
          aria-label="Progression settings"
          onClick={() => setShowProgressionPicker(true)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-full bg-muted text-xs font-semibold active:scale-95 transition-all ${axes.advance === "none" ? "text-muted-foreground/40" : "text-muted-foreground"}`}
        >
          {axes.advance !== "none" && "↑ "}{progressionBadgeLabel()}
        </button>
        {isWorkout && bestEstimated1RM != null && (
          <span className="px-3 py-1.5 rounded-full bg-primary/10 text-xs font-semibold text-primary">
            1RM ~{Math.round(bestEstimated1RM)}kg
          </span>
        )}
        {/* One tap instead of one per set. Only worth showing when there is
            more than one set to take, otherwise the set's own chip is closer. */}
        {pending.length > 1 && (
          <button
            onClick={applyAllPending}
            className="ml-auto min-h-[44px] px-3.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold active:scale-95 transition-all"
          >
            {pendingArrow}{" "}
            {pendingWeight != null
              ? `${pendingWeight}kg · ${pending.length} sets`
              : `Apply ${pending.length} sets`}
          </button>
        )}
      </div>

      {/* Sets list or empty state */}
      <div className="flex-1 px-4 overflow-y-auto">
        {sets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 pb-16">
            <svg
              width="80"
              height="80"
              viewBox="0 0 80 80"
              fill="currentColor"
              className="text-primary opacity-40"
            >
              <rect x="30" y="36" width="20" height="8" rx="2" />
              <rect x="16" y="28" width="14" height="24" rx="4" />
              <rect x="50" y="28" width="14" height="24" rx="4" />
              <rect x="8" y="32" width="10" height="16" rx="3" />
              <rect x="62" y="32" width="10" height="16" rx="3" />
            </svg>
            <h2 className="text-primary text-lg font-semibold">
              Add Sets &amp; Rests
            </h2>
            <p className="text-muted-foreground text-sm text-center px-8">
              Tap the add button (+) at the top of the screen to add sets and rests
            </p>
          </div>
        ) : (
          <WorkoutSetsList
            sets={displaySets}
            programId={programId}
            programExerciseId={programExerciseId}
            isEditing={isEditing}
            isWorkout={isWorkout}
            isTimed={exerciseIsTimed && !isRunning}
            isRunning={isRunning}
            discipline={exerciseDiscipline}
            exerciseId={exerciseId}
            sessionId={workoutSession?.sessionId ?? undefined}
            onDeleteSet={handleDeleteSet}
            suggestions={suggestions}
            onApplySuggestion={isWorkout ? applySuggestion : undefined}
            onApplyRepSuggestion={isWorkout ? applyRepSuggestion : undefined}
          />
        )}
      </div>


      {/* Progression sheet — three layers.
          1. The preset: a named scheme, and where most people stop.
          2. The sentence: what the live axis values actually do, always visible.
          3. Advanced: every axis, collapsed.
          The sentence is the contract with the lifter, so it sits between the
          choice and the detail rather than at the bottom of either. */}
      {showProgressionPicker && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end"
          onClick={() => { setShowProgressionPicker(false); setCustomKgInput(""); setCustomRepInput(""); setShowCustomKg(false); setShowCustomReps(false); }}
        >
          <div
            className="w-full px-4 pb-8 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-card rounded-2xl overflow-hidden max-h-[80vh] flex flex-col">
              <p className="text-center text-sm font-semibold text-muted-foreground pt-4 pb-2 shrink-0">
                Progression
              </p>
              {/* Layer 2, pinned. The sentence is the contract with the lifter,
                  so it sits above the scroll rather than inside it — eight
                  preset rows are taller than the sheet, and in the list it was
                  never on screen without a scroll. Both lines reserve their
                  height: a header that grows moves the frame it exists to hold
                  still. */}
              <div className="px-4 pb-3 border-b border-border shrink-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground pb-1">
                  What this does
                </p>
                <p className="text-sm font-medium min-h-[40px]">
                  {selectedPreset?.description ?? "These settings don't match a named scheme."}
                </p>
                {/* A fixed box, not a minimum. The sentence runs three to
                    five lines depending on the axes, and the header is
                    `shrink-0` inside a capped sheet — so a header that grows
                    shrinks the scroller and slides every row down, which is
                    the shift this pinning exists to remove. Measured at 20px
                    before this. An unusually long rule scrolls inside the box
                    rather than resizing it; nothing is truncated. */}
                <p
                  data-testid="progression-rule"
                  className="text-xs text-muted-foreground h-[68px] overflow-y-auto pt-1"
                >
                  {ruleSentence ?? "No suggestions for this exercise."}
                </p>
              </div>
              <div className="overflow-y-auto">
                {/* ── Layer 1: the preset ─────────────────────────────────── */}
                {availablePresets.map((preset) => {
                  const selected = preset.id === currentPresetId;
                  // E-4: double progression at the top of its range needs load
                  // to add. Offering it with the increment explicitly zeroed
                  // configures an exercise that can only ever hold. A null
                  // increment is fine — that means the adaptive ladder, which
                  // always resolves to something positive.
                  const blocked =
                    preset.axes.advance === "double" && increment === 0;
                  const Glyph = ADVANCE_ICON[preset.axes.advance];
                  return (
                    <button
                      key={preset.id}
                      disabled={blocked}
                      title={blocked ? "Set a weight increment below to use this" : preset.description}
                      onClick={() => handlePresetChange(preset)}
                      className={`w-full flex items-center justify-between gap-3 px-4 h-12 border-b border-border active:bg-muted/50 transition-colors ${
                        selected ? "text-primary" : ""
                      } ${blocked ? "opacity-40" : ""}`}
                    >
                      {/* A fixed row height, and no description on the row: the
                          description lives in the pinned header, so choosing a
                          scheme cannot change any row's height and throw the
                          list up under the thumb. */}
                      <span className="flex items-center gap-3 min-w-0">
                        <Glyph className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                        <span className={`text-base truncate ${selected ? "font-semibold" : "font-medium"}`}>
                          {preset.label}
                        </span>
                      </span>
                      {selected && <span className="text-primary text-lg leading-none">✓</span>}
                    </button>
                  );
                })}
                {currentPresetId === null && (
                  <div className="flex items-center px-4 h-12 border-b border-border">
                    <p className="text-base font-semibold text-primary">Custom</p>
                  </div>
                )}

                {/* ── The scheme's own parameter ───────────────────────────
                    Rep range for double progression, reps in reserve for an
                    autoregulated scheme. Both belong beside the scheme that
                    needs them rather than under Advanced: reps in reserve is
                    the whole of what "Autoregulated" means, and picking that
                    preset writes a cap of 2 the lifter could not otherwise see.
                    Stacked in one grid cell so this area's height never changes
                    when the scheme does — the same reservation the increment
                    sections use below. Neither applies to a plank or a run
                    (E-5), so the slot collapses entirely there. */}
                {hasConditionalSlot && (
                  <div className="grid border-t border-border">
                    <div className={`col-start-1 row-start-1 ${showRepRange ? "" : "opacity-0 pointer-events-none"}`}>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider px-4 pt-3 pb-1 flex items-center gap-1.5">
                        <Repeat2Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        Rep range
                      </p>
                      <div className="flex flex-wrap gap-2 px-4 pb-3">
                        {REP_RANGE_PRESETS.map(([min, max]) => (
                          <button
                            key={`${min}-${max}`}
                            onClick={() =>
                              handleSetDefaults({ repRangeMin: min, repRangeMax: max })
                            }
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                              repRange?.repRangeMin === min && repRange?.repRangeMax === max
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {min}–{max}
                          </button>
                        ))}
                      </div>
                      {repRange == null && showRepRange && (
                        <p className="text-xs text-amber-600 dark:text-amber-500 px-4 pb-3">
                          Without a range this behaves as plain weight progression.
                        </p>
                      )}
                    </div>

                    {/* Axis 3. Opt-in by design: an exercise with no cap clears
                        on the target alone, and a cap nobody asked for would
                        block progression on effort that was never logged.
                        Written to every working set; the scope decides which one
                        the engine reads (D-8). */}
                    <div className={`col-start-1 row-start-1 ${showRepRange ? "opacity-0 pointer-events-none" : ""}`}>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider px-4 pt-3 pb-1 flex items-center gap-1.5">
                        <GaugeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        Reps in reserve
                      </p>
                      <div
                        role="group"
                        aria-label="Reps in reserve"
                        className="flex flex-wrap gap-2 px-4 pb-1"
                      >
                        <button
                          onClick={() => handleSetDefaults({ targetRir: null })}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                            effortCap == null
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          None
                        </button>
                        {EFFORT_CAP_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            onClick={() => handleSetDefaults({ targetRir: preset })}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                              effortCap === preset
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground px-4 pb-3">
                        {effortCap == null
                          ? "Hitting the target reps is the whole test."
                          : "Sessions where you don't log effort won't count either way."}
                      </p>
                    </div>
                  </div>
                )}

                {/* Increment sections — stacked in one grid cell so this area's
                    height never changes when the scheme does. See incrementSections. */}
                <div className="grid">
                {/* Kg increment — shown for the load-bearing schemes */}
                {incrementSections.includes("weight") && (
                  <div className={`col-start-1 row-start-1 border-t border-border ${axes.advance === "load" || axes.advance === "double" ? "" : "invisible pointer-events-none"}`}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider px-4 pt-3 pb-1">
                      Weight increment
                    </p>
                    <div className="flex flex-wrap gap-2 px-4 pb-3">
                      {KG_INCREMENT_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          onClick={() => handleIncrementChange(preset)}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                            increment === preset
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          +{preset}kg
                        </button>
                      ))}
                      {/* A chip that reveals the input, rather than an input
                          mounted forever for the least-used value. */}
                      <button
                        onClick={() => setShowCustomKg((v) => !v)}
                        className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                          increment != null && !KG_INCREMENT_PRESETS.includes(increment as never)
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {increment != null && !KG_INCREMENT_PRESETS.includes(increment as never)
                          ? `+${increment}kg`
                          : "Custom…"}
                      </button>
                    </div>
                    {showCustomKg && (
                      <div className="flex items-center gap-3 px-4 py-3 border-t border-border">
                        <span className="text-base font-medium text-muted-foreground shrink-0">+</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoFocus
                          placeholder="Custom kg"
                          value={customKgInput}
                          onChange={(e) => setCustomKgInput(sanitizeDecimalInput(e.target.value))}
                          className="flex-1 min-w-0 bg-transparent text-base font-medium outline-none placeholder:text-muted-foreground/50"
                        />
                        <button
                          onClick={() => {
                            const val = parseFloat(customKgInput);
                            if (!isNaN(val) && val >= 0) handleIncrementChange(val);
                          }}
                          disabled={!customKgInput || isNaN(parseFloat(customKgInput))}
                          className="shrink-0 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-30 active:scale-95 transition-all"
                        >
                          Set
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Rep increment — the rep ladder's step, and double
                    progression's floor when it climbs inside the range */}
                {incrementSections.includes("reps") && (
                  <div className={`col-start-1 row-start-1 border-t border-border ${axes.advance === "reps" ? "" : "invisible pointer-events-none"}`}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider px-4 pt-3 pb-1">
                      Rep increment
                    </p>
                    <div className="flex gap-2 px-4 pb-3">
                      {REP_INCREMENT_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          onClick={() => handleIncrementRepsChange(preset)}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                            incrementReps === preset
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          +{preset}
                        </button>
                      ))}
                      <button
                        onClick={() => setShowCustomReps((v) => !v)}
                        className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                          !REP_INCREMENT_PRESETS.includes(incrementReps as never) && incrementReps > 0
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {!REP_INCREMENT_PRESETS.includes(incrementReps as never) && incrementReps > 0
                          ? `+${incrementReps}`
                          : "Custom…"}
                      </button>
                    </div>
                    {showCustomReps && (
                      <div className="flex items-center gap-3 px-4 py-3 border-t border-border">
                        <span className="text-base font-medium text-muted-foreground shrink-0">+</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoFocus
                          placeholder="Custom reps"
                          value={customRepInput}
                          onChange={(e) => setCustomRepInput(e.target.value)}
                          className="flex-1 min-w-0 bg-transparent text-base font-medium outline-none placeholder:text-muted-foreground/50"
                        />
                        <button
                          onClick={() => {
                            const val = parseInt(customRepInput, 10);
                            if (!isNaN(val) && val >= 0) handleIncrementRepsChange(val);
                          }}
                          disabled={!customRepInput || isNaN(parseInt(customRepInput, 10))}
                          className="shrink-0 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-30 active:scale-95 transition-all"
                        >
                          Set
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Duration increment */}
                {incrementSections.includes("time") && (
                  <div className={`col-start-1 row-start-1 border-t border-border ${axes.advance === "duration" ? "" : "invisible pointer-events-none"}`}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider px-4 pt-3 pb-1">
                      Duration increment
                    </p>
                    <div className="flex gap-2 px-4 pb-3">
                      {[5, 10, 15, 30, 60].map((preset) => (
                        <button
                          key={preset}
                          onClick={() => handleIncrementRepsChange(preset)}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                            incrementReps === preset
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          +{preset}s
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Distance increment */}
                {incrementSections.includes("distance") && (
                  <div className={`col-start-1 row-start-1 border-t border-border ${axes.advance === "distance" ? "" : "invisible pointer-events-none"}`}>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider px-4 pt-3 pb-1">
                      Distance increment
                    </p>
                    <div className="flex gap-2 px-4 pb-3">
                      {DISTANCE_INCREMENT_PRESETS_M.map((preset) => (
                        <button
                          key={preset}
                          onClick={() => handleIncrementRepsChange(preset)}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                            incrementReps === preset
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          +{preset / 1000}km
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                </div>

                {/* Plan opt-in. Always mounted, and greyed rather than
                    unmounted for the two schemes that never suggest anything,
                    so switching schemes can't change the sheet's height and
                    slide the row under the user's finger. */}
                <div
                  className={`border-t border-border ${
                    axes.advance === "none" || axes.advance === "manual"
                      ? "opacity-40 pointer-events-none"
                      : ""
                  }`}
                >
                  <button
                    role="switch"
                    aria-checked={applyToPlan}
                    onClick={() => handleApplyToPlanChange(!applyToPlan)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 min-h-[44px] text-left active:bg-muted/50 transition-colors"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-base font-medium">
                        Apply bumps to the plan
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Taking a suggestion rewrites these planned sets, so next
                        session starts at the new numbers
                      </span>
                    </span>
                    <span
                      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                        applyToPlan ? "bg-primary" : "bg-border"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                          applyToPlan ? "translate-x-[22px]" : "translate-x-0.5"
                        }`}
                      />
                    </span>
                  </button>
                </div>

                {/* ── Layer 3: Advanced ───────────────────────────────────── */}
                {/* Nothing is hidden and nothing is mandatory. Opening this and
                    changing anything relabels the exercise Custom, and the
                    sentence above updates to match. */}
                <div
                  className={`border-t border-border ${
                    axes.advance === "none" || axes.advance === "manual"
                      ? "opacity-40 pointer-events-none"
                      : ""
                  }`}
                >
                  <button
                    aria-expanded={showAdvanced}
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 min-h-[44px] text-left active:bg-muted/50 transition-colors"
                  >
                    <span className="text-base font-medium">Advanced</span>
                    <span className="text-muted-foreground text-sm">
                      {showAdvanced ? "Hide" : "Show"}
                    </span>
                  </button>

                  {showAdvanced && (
                    <>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider px-4 pt-2 pb-1 flex items-center gap-1.5">
                        <CheckCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        Sessions at target
                      </p>
                      <div
                        role="group"
                        aria-label="Sessions at target"
                        className="flex gap-2 px-4 pb-3"
                      >
                        {REQUIRED_HITS_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            onClick={() => updateAxes({ requiredHits: preset })}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                              (axes.requiredHits ?? REQUIRED_HITS) === preset
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {preset} {preset === 1 ? "session" : "sessions"}
                          </button>
                        ))}
                      </div>

                      <p className="text-xs text-muted-foreground uppercase tracking-wider px-4 pt-2 pb-1 flex items-center gap-1.5">
                        <AlignEndVerticalIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        Which sets have to clear
                      </p>
                      <div
                        role="group"
                        aria-label="Which sets have to clear"
                        className="flex flex-wrap gap-2 px-4 pb-3"
                      >
                        {SCOPE_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => updateAxes({ scope: opt.value })}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                              axes.scope === opt.value
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>


                      <p className="text-xs text-muted-foreground uppercase tracking-wider px-4 pt-2 pb-1 flex items-center gap-1.5">
                        <TrendingDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        When you keep missing
                      </p>
                      <div
                        role="group"
                        aria-label="When you keep missing"
                        className="flex flex-wrap gap-2 px-4 pb-3"
                      >
                        <button
                          onClick={() => updateAxes({ regress: "hold" })}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                            axes.regress === "hold"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          Hold
                        </button>
                        {BACKOFF_PCT_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            onClick={() =>
                              updateAxes({ regress: "backoff", backoffPct: preset })
                            }
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                              axes.regress === "backoff" && axes.backoffPct === preset
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            −{preset}%
                          </button>
                        ))}
                      </div>

                      {axes.regress === "backoff" && (
                        <>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider px-4 pt-2 pb-1 flex items-center gap-1.5">
                            <TrendingDownIcon className="h-3.5 w-3.5" aria-hidden="true" />
                            After this many short workouts
                          </p>
                          <div
                            role="group"
                            aria-label="After this many short workouts"
                            className="flex gap-2 px-4 pb-3"
                          >
                            {Array.from({ length: MAX_REQUIRED_HITS }, (_, i) => i + 1).map(
                              (preset) => (
                                <button
                                  key={preset}
                                  onClick={() => updateAxes({ backoffAfter: preset })}
                                  className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                                    axes.backoffAfter === preset
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {preset} short
                                </button>
                              ),
                            )}
                          </div>
                        </>
                      )}

                      <p className="text-xs text-muted-foreground uppercase tracking-wider px-4 pt-2 pb-1 flex items-center gap-1.5">
                        <MoonIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        On a low-readiness day
                      </p>
                      <div
                        role="group"
                        aria-label="On a low-readiness day"
                        className="flex flex-wrap gap-2 px-4 pb-3"
                      >
                        {READINESS_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => updateAxes({ readiness: opt.value })}
                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                              axes.readiness === opt.value
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Exercise-type override — strength only. Not a progression
                    setting: it is here because it decides how coarse an
                    increment the ladder may propose, so it sits directly under
                    the increments and says so. "Default" inherits the
                    exercise's intrinsic type. */}
                {!isRunning && !exerciseIsTimed && (
                  <div className="border-t border-border">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider px-4 pt-3 pb-0.5">
                      Type{exerciseTypeDefault ? ` · default ${EXERCISE_TYPE_LABELS[exerciseTypeDefault as ExerciseType]}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground px-4 pb-2">
                      Sets how coarse an increment gets suggested.
                    </p>
                    <div className="flex flex-wrap gap-2 px-4 pb-3">
                      <button
                        onClick={() => handleTypeOverrideChange(null)}
                        className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                          typeOverride == null
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        Default
                      </button>
                      {EXERCISE_TYPES.map((t) => (
                        <button
                          key={t}
                          onClick={() => handleTypeOverrideChange(t)}
                          className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                            typeOverride === t
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {EXERCISE_TYPE_LABELS[t]}
                        </button>
                      ))}
                    </div>
                    {resolveExerciseType(typeOverride as ExerciseType | null, exerciseTypeDefault as ExerciseType | null) && (
                      <p className="text-xs text-muted-foreground px-4 pb-3">
                        This program treats it as{" "}
                        <span className="font-semibold text-foreground">
                          {EXERCISE_TYPE_LABELS[resolveExerciseType(typeOverride as ExerciseType | null, exerciseTypeDefault as ExerciseType | null)!]}
                        </span>
                        .
                      </p>
                    )}
                  </div>
                )}

                {/* Scroll room so custom inputs stay above the keyboard */}
                <div aria-hidden="true" style={{ height: "var(--kb-height, 0px)" }} />
              </div>
            </div>
            <div className="bg-card rounded-2xl overflow-hidden">
              <button
                onClick={() => { setShowProgressionPicker(false); setCustomKgInput(""); setCustomRepInput(""); setShowCustomKg(false); setShowCustomReps(false); }}
                className="w-full flex items-center justify-center py-4 text-base font-semibold text-primary active:bg-muted/50 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
