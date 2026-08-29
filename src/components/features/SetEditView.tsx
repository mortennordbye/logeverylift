"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { setProgramExerciseType, updateProgramSet } from "@/lib/actions/programs";
import { updateWorkoutSetNotes } from "@/lib/actions/workout-sets";
import { useWorkoutSetWriter } from "@/contexts/pending-queue-context";
import { useWorkoutSession } from "@/contexts/workout-session-context";
import {
  EXERCISE_TYPES,
  EXERCISE_TYPE_LABELS,
  resolveExerciseType,
  type ExerciseType,
} from "@/lib/utils/exercise-type";
import { formatEndurancePace, formatTime, sanitizeDecimalInput } from "@/lib/utils/format";
import { withCustomOption } from "@/lib/utils/picker-options";
import { logCustomWeight } from "@/lib/actions/custom-weights";
import { disciplineConfig, type Discipline } from "@/lib/utils/discipline";
import { markProgrammaticBack } from "@/lib/utils/nav-intent";
import type { SetType } from "@/lib/validators/workout";
import type { ProgramSet } from "@/types/workout";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Props = {
  set: ProgramSet;
  isWorkout?: boolean;
  isTimed?: boolean;
  isRunning?: boolean;
  /** Triathlon discipline of the exercise. Null → generic run-mode behavior. */
  discipline?: Discipline | null;
  /** Exercise id — resolves the workout_sets row for note updates, and tags custom-weight telemetry. */
  exerciseId?: number | null;
  /** 1-based position of this set within the exercise — used as the workout_sets key. */
  setNumber?: number;
  /** Exercise's intrinsic type — the default shown when there's no program override. */
  exerciseTypeDefault?: string | null;
  /** Per-program override of the exercise type; null = inherit the default. */
  exerciseTypeOverride?: string | null;
};

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 300, 600];
const REST_OPTIONS = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];
const RUNNING_DURATION_PRESETS_S = [600, 1200, 1800, 2400, 3000, 3600, 4500, 5400, 7200]; // 10–120 min
const INCLINE_PRESETS = [0, 1, 2, 3, 5, 8, 10, 12, 15];
const HR_ZONES = [
  { zone: 1, label: "Z1", desc: "Recovery" },
  { zone: 2, label: "Z2", desc: "Aerobic" },
  { zone: 3, label: "Z3", desc: "Tempo" },
  { zone: 4, label: "Z4", desc: "Threshold" },
  { zone: 5, label: "Z5", desc: "VO₂Max" },
];
// Start-delay chips for timed sets. 0 = "None" (the default — the feature is opt-in).
const START_DELAY_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "None" },
  { value: 3, label: "3s" },
  { value: 5, label: "5s" },
  { value: 10, label: "10s" },
  { value: 15, label: "15s" },
  { value: 20, label: "20s" },
  { value: 30, label: "30s" },
];
// Reps In Reserve chips. "None" leaves it unlogged; 0 = to failure, 5 = 5+ left.
const RIR_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "None" },
  { value: 0, label: "0" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5+" },
];

export function SetEditView({
  set,
  isWorkout = false,
  isTimed = false,
  isRunning = false,
  discipline = null,
  exerciseId = null,
  setNumber,
  exerciseTypeDefault = null,
  exerciseTypeOverride = null,
}: Props) {
  const router = useRouter();
  const { logWithRetry } = useWorkoutSetWriter();
  const cfg = disciplineConfig(discipline);
  // Convert between the editor's distance input (m for swim, km otherwise) and stored meters.
  const metersToInput = (m: number) => (cfg.inputUnit === "m" ? String(m) : String(m / 1000));
  const inputToMeters = (val: string): number | null => {
    const n = parseFloat(val);
    if (isNaN(n) || n < 0) return null;
    return cfg.inputUnit === "m" ? Math.round(n) : Math.round(n * 1000);
  };
  const [showRepsPicker, setShowRepsPicker] = useState(false);
  const [showWeightPicker, setShowWeightPicker] = useState(false);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // Per-program exercise-type override. Editing it here writes to the
  // program_exercise (so it changes the type for ALL sets of this exercise in
  // this program, not just this set). Local state gives an optimistic update.
  const [typeOverride, setTypeOverride] = useState<ExerciseType | null>(
    (exerciseTypeOverride as ExerciseType | null) ?? null,
  );
  const [savingType, setSavingType] = useState(false);
  const resolvedType = resolveExerciseType(
    typeOverride,
    exerciseTypeDefault as ExerciseType | null,
  );

  async function handleTypeChange(next: ExerciseType | null) {
    setTypeOverride(next);
    setShowTypePicker(false);
    setSavingType(true);
    await setProgramExerciseType({
      programExerciseId: set.programExerciseId,
      exerciseType: next,
    });
    setSavingType(false);
    router.refresh();
  }

  const workoutSession = useWorkoutSession();
  const override = isWorkout ? (workoutSession?.overrides[set.id] ?? null) : null;

  const [runMode, setRunMode] = useState<"distance" | "time">(
    set.distanceMeters != null ? "distance"
    : set.durationSeconds != null ? "time"
    : "distance"
  );
  const [reps, setReps] = useState(override?.targetReps ?? set.targetReps ?? 10);
  const [weight, setWeight] = useState(override?.weightKg ?? Number(set.weightKg ?? 0));
  const [setType, setSetType] = useState<SetType>(
    (set.setType as SetType | undefined) ?? "working",
  );
  const [notes, setNotes] = useState<string>(override?.notes ?? "");
  // Workout-mode only: mark a set as failed (target not reached). The reps field
  // then captures the reps actually achieved (0 is allowed), while the program
  // target is preserved so the set logs actualReps < targetReps.
  const [failed, setFailed] = useState<boolean>(override?.isFailed ?? false);
  // Workout-mode only: the opposite signal to `failed` — the target was hit and
  // there was plenty left. Next session's suggestion progresses the load off
  // this one set instead of waiting for the usual two confident hits.
  const [easy, setEasy] = useState<boolean>(override?.wasEasy ?? false);
  // Reps In Reserve (workout strength mode). Null until the user picks one.
  const [rir, setRir] = useState<number | null>(override?.rir ?? null);
  const repsMin = isWorkout ? 0 : 1;
  const [duration, setDuration] = useState(override?.durationSeconds ?? Number(set.durationSeconds ?? 0));
  const [startDelay, setStartDelay] = useState(override?.startDelaySeconds ?? set.startDelaySeconds ?? 0);
  const [distanceMeters, setDistanceMeters] = useState(set.distanceMeters ?? cfg.defaultDistanceM);
  const [distanceStr, setDistanceStr] = useState(metersToInput(set.distanceMeters ?? cfg.defaultDistanceM));
  const [inclinePercent, setInclinePercent] = useState<number | null>(set.inclinePercent ?? null);
  const [inclineStr, setInclineStr] = useState(set.inclinePercent != null ? String(set.inclinePercent) : "");
  const [targetHeartRateZone, setTargetHeartRateZone] = useState<number | null>(set.targetHeartRateZone ?? null);
  const [repsStr, setRepsStr] = useState(String(override?.targetReps ?? set.targetReps ?? 10));
  const [weightStr, setWeightStr] = useState(String(override?.weightKg ?? Number(set.weightKg ?? 0)));
  const initialDuration = Number(set.durationSeconds ?? 60);
  const [durationMinStr, setDurationMinStr] = useState(String(Math.floor(initialDuration / 60)));
  const [durationSecStr, setDurationSecStr] = useState(String(initialDuration % 60).padStart(2, "0"));
  // Program-edit only: rest after this set + the prescribed RIR cap for the set.
  const initialRest = Number(set.restTimeSeconds ?? 0);
  const [restSeconds, setRestSeconds] = useState(initialRest);
  const [restMinStr, setRestMinStr] = useState(String(Math.floor(initialRest / 60)));
  const [restSecStr, setRestSecStr] = useState(String(initialRest % 60).padStart(2, "0"));
  const [showRestPicker, setShowRestPicker] = useState(false);
  const [prescribedRir, setPrescribedRir] = useState<number | null>(set.targetRir ?? null);
  const weightScrollRef = useRef<HTMLDivElement>(null);
  const repsScrollRef = useRef<HTMLDivElement>(null);

  const WEIGHT_OPTIONS = [0, ...Array.from({ length: 40 }, (_, i) => (i + 1) * 2.5)];
  // A typed-in weight gets its own circle rather than lighting up the nearest
  // preset — see withCustomOption.
  const weightOptions = withCustomOption(WEIGHT_OPTIONS, weight);

  const BASE_REPS = Array.from({ length: 20 }, (_, i) => i + 1);
  const repOptions = reps > 20 ? [...BASE_REPS, reps] : BASE_REPS;

  /**
   * Bring the selected circle to the middle of a picker row.
   *
   * Called when a picker opens and when a typed value is committed on blur —
   * never on keystroke. The two pickers used to disagree: the reps effect
   * depended on `reps`, so every character retargeted the row and it lurched
   * ~1160px sideways and back while typing "25"; the weight effect depended
   * only on the open flag, so typing moved nothing and the highlighted circle
   * ended up off-screen where the user could not see it. Committing on blur
   * gives both the same behaviour and keeps the row still while typing.
   */
  const centerOption = (
    el: HTMLDivElement | null,
    index: number,
    itemWidth: number,
    smooth = false,
  ) => {
    if (!el || index < 0) return;
    el.scrollTo({
      left: Math.max(0, index * itemWidth - el.clientWidth / 2 + itemWidth / 2),
      behavior: smooth ? "smooth" : "auto",
    });
  };

  const centerReps = (value: number, smooth = false) =>
    centerOption(repsScrollRef.current, repOptions.indexOf(value), 72, smooth);
  const centerWeight = (value: number, smooth = false) =>
    centerOption(
      weightScrollRef.current,
      withCustomOption(WEIGHT_OPTIONS, value).indexOf(value),
      88,
      smooth,
    );

  useEffect(() => {
    if (!showRepsPicker) return;
    requestAnimationFrame(() => centerReps(reps));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRepsPicker]);

  useEffect(() => {
    if (!showWeightPicker) return;
    requestAnimationFrame(() => centerWeight(weight));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWeightPicker]);

  const handleSave = async () => {
    setSaving(true);
    const trimmedNote = notes.trim();
    const noteValue = trimmedNote.length > 0 ? trimmedNote : null;
    // A failed set keeps the program target as the goal and records the lower
    // achieved reps; an ordinary set targets what was entered.
    const targetRepsValue = failed ? (set.targetReps ?? reps) : reps;

    // Telemetry for tuning the weight presets: record the weights people have
    // to type in because no circle offers them. Fire-and-forget.
    if (!isRunning && !isTimed && exerciseId != null && !WEIGHT_OPTIONS.includes(weight) && weight > 0) {
      void logCustomWeight({ exerciseId, weightKg: weight });
    }

    if (isRunning) {
      // A periodized set carries a peak anchor the active cycle ramps weekly.
      // When its mode is switched we convert the anchor so the new mode's target
      // periodizes (distance↔time); ordinary sets get no anchor.
      const isPeriodized = set.peakDistanceMeters != null || set.peakDurationSeconds != null;
      if (isWorkout) {
        // During a workout: only update the duration target override (distance target is program-level)
        workoutSession?.setOverride(set.id, { targetReps: 0, weightKg: 0, durationSeconds: duration > 0 ? duration : undefined, notes: noteValue });
      } else if (runMode === "distance") {
        // Convert a time-periodized set back to distance: anchor the entered distance, clear the time anchor.
        const anchor = isPeriodized && set.peakDistanceMeters == null
          ? { peakDistanceMeters: distanceMeters, peakDurationSeconds: null }
          : {};
        await updateProgramSet({ id: set.id, distanceMeters, durationSeconds: duration > 0 ? duration : undefined, inclinePercent: inclinePercent ?? undefined, targetHeartRateZone: targetHeartRateZone ?? undefined, setType, restTimeSeconds: restSeconds, ...anchor });
      } else {
        // Time mode: anchor the entered duration as the peak (and drop the distance anchor) for periodized sets.
        const anchor = isPeriodized ? { peakDurationSeconds: duration, peakDistanceMeters: null } : {};
        await updateProgramSet({ id: set.id, distanceMeters: null, durationSeconds: duration, inclinePercent: inclinePercent ?? undefined, targetHeartRateZone: targetHeartRateZone ?? undefined, setType, restTimeSeconds: restSeconds, ...anchor });
      }
    } else if (isWorkout) {
      // During a workout, changes apply to the active session only — never write back to the program
      if (isTimed) {
        // Always write startDelaySeconds: setOverride replaces the whole record,
        // and 0 must beat a program-level delay in the ?? fallback chain.
        workoutSession?.setOverride(set.id, { targetReps: reps, weightKg: weight, durationSeconds: duration, startDelaySeconds: startDelay, notes: noteValue });
      } else if (failed) {
        // Failed: keep the program target as the goal, record the achieved reps.
        // A failed set was taken to failure, so RIR is 0 regardless of the picker.
        workoutSession?.setOverride(set.id, { targetReps: set.targetReps ?? reps, weightKg: weight, notes: noteValue, isFailed: true, actualReps: reps, rir: 0 });
      } else {
        workoutSession?.setOverride(set.id, { targetReps: reps, weightKg: weight, notes: noteValue, rir: rir ?? undefined, wasEasy: easy });
      }
    } else if (isTimed) {
      await updateProgramSet({ id: set.id, durationSeconds: duration, setType, restTimeSeconds: restSeconds, startDelaySeconds: startDelay > 0 ? startDelay : null });
    } else {
      await updateProgramSet({ id: set.id, targetReps: reps, weightKg: weight, setType, restTimeSeconds: restSeconds, targetRir: prescribedRir });
    }

    const activeSessionId = workoutSession?.sessionId ?? null;
    if (isWorkout && activeSessionId != null && exerciseId != null && setNumber != null) {
      if (workoutSession?.completedSetIds.has(set.id)) {
        // The set is already logged, so the override alone would leave the
        // workout_sets row on the old numbers while the list shows the new
        // ones. Rewrite the row (logWorkoutSet upserts) with the corrected
        // values — otherwise history, volume and PRs keep what the user has
        // just corrected away.
        void logWithRetry({
          sessionId: activeSessionId,
          exerciseId,
          setNumber,
          programSetId: set.id,
          targetReps: !isRunning && targetRepsValue > 0 ? targetRepsValue : undefined,
          actualReps: isRunning ? 0 : reps,
          weightKg: isRunning ? 0 : weight,
          durationSeconds: duration > 0 ? duration : undefined,
          distanceMeters: isRunning ? (distanceMeters ?? undefined) : undefined,
          // No rpe: rir is the effort the lifter actually picked, and leaving
          // the picker alone means effort is unknown rather than a middling 7.
          rir: failed ? 0 : (rir ?? undefined),
          restTimeSeconds: restSeconds,
          notes: noteValue,
          isCompleted: true,
          isFailed: failed,
          wasEasy: easy,
        });
      } else {
        // Not yet logged: the override carries the values (and the note)
        // forward to the next logWorkoutSet call. The note still goes through
        // in case a row exists from an earlier session state.
        void updateWorkoutSetNotes({ sessionId: activeSessionId, exerciseId, setNumber, programSetId: set.id, notes: noteValue });
      }
    }

    // Marks this as our own back, not an edge swipe. Both arrive as popstate;
    // only the swipe is already being animated by the system.
    markProgrammaticBack();
    router.back();
  };

  return (
    <>
      {/* min-h-0 is load-bearing: a flex child defaults to min-height:auto and
          refuses to shrink below its content, so without it this never scrolls
          and the Save button below is clipped off-screen on short phones
          (iPhone SE and smaller) with no way to reach it. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 animate-in fade-in duration-150">
        {/* Set-type toggle: warmup sets are excluded from auto-progression. Hidden during workout — setType is a program-level field. */}
        {!isWorkout && (
          <div className="flex rounded-xl overflow-hidden border border-border mb-4 mt-2">
            <button
              type="button"
              onClick={() => setSetType("working")}
              className={`flex-1 py-2 text-sm font-semibold transition-colors ${setType === "working" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
            >
              Working set
            </button>
            <button
              type="button"
              onClick={() => setSetType("warmup")}
              className={`flex-1 py-2 text-sm font-semibold transition-colors ${setType === "warmup" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
            >
              Warm-up
            </button>
          </div>
        )}
        {isRunning ? (
          /* Running mode: distance or time toggle */
          <>
            {/* Mode toggle */}
            <div className="flex rounded-xl overflow-hidden border border-border mb-4 mt-2">
              <button
                onClick={() => setRunMode("distance")}
                className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${runMode === "distance" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
              >
                Distance
              </button>
              <button
                onClick={() => setRunMode("time")}
                className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${runMode === "time" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}
              >
                Time
              </button>
            </div>

            {runMode === "distance" && (
              <>
                <div className="py-4 border-b border-border">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Distance</p>
                  <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                    {cfg.distancePresetsM.map((m, i) => (
                      <button
                        key={m}
                        onClick={() => { setDistanceMeters(m); setDistanceStr(metersToInput(m)); }}
                        className={`flex-shrink-0 px-4 h-11 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                          distanceMeters === m
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {cfg.distanceLabels[i]}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={distanceStr}
                      onChange={(e) => {
                        const val = sanitizeDecimalInput(e.target.value);
                        setDistanceStr(val);
                        const m = inputToMeters(val);
                        if (m != null) setDistanceMeters(m);
                      }}
                      onBlur={() => {
                        const m = inputToMeters(distanceStr);
                        if (m != null) {
                          setDistanceMeters(m);
                          setDistanceStr(metersToInput(m));
                        }
                      }}
                      className="flex-1 rounded-xl bg-background border border-border px-4 py-2.5 text-center text-xl font-bold outline-none focus:ring-2 ring-primary"
                    />
                    <span className="text-sm font-medium text-muted-foreground">{cfg.inputUnit}</span>
                  </div>
                </div>
                <button
                  onClick={() => setShowDurationPicker(true)}
                  className="w-full flex items-center justify-between py-4 border-b border-border transition-colors hover:bg-muted/50 active:bg-muted/70"
                >
                  <span className="text-base font-medium">Target duration <span className="text-xs text-muted-foreground">(optional)</span></span>
                  <span className="text-base text-muted-foreground">
                    {duration > 0 ? formatTime(duration) : "—"}
                  </span>
                </button>
                {distanceMeters > 0 && duration > 0 && (
                  <div className="py-3 flex items-center justify-center">
                    <span className="px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                      {formatEndurancePace(cfg.paceFormatter, duration, distanceMeters)}
                    </span>
                  </div>
                )}
              </>
            )}

            {runMode === "time" && (
              <div className="py-4 border-b border-border">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Duration</p>
                <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                  {RUNNING_DURATION_PRESETS_S.map((secs) => (
                    <button
                      key={secs}
                      onClick={() => {
                        setDuration(secs);
                        setDurationMinStr(String(Math.floor(secs / 60)));
                        setDurationSecStr("00");
                      }}
                      className={`flex-shrink-0 px-4 h-11 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                        duration === secs ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                      }`}
                    >
                      {secs % 3600 === 0 ? (secs / 3600) + "h" : (secs / 60) + "m"}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowDurationPicker(true)}
                  className="w-full flex items-center justify-between mt-3 px-4 py-2.5 rounded-xl bg-muted/50 active:bg-muted/70 transition-colors"
                >
                  <span className="text-sm text-muted-foreground">Custom</span>
                  <span className={`text-sm font-semibold ${duration > 0 && !RUNNING_DURATION_PRESETS_S.includes(duration) ? "text-foreground" : "text-muted-foreground"}`}>
                    {duration > 0 && !RUNNING_DURATION_PRESETS_S.includes(duration) ? formatTime(duration) : "—"}
                  </span>
                </button>
              </div>
            )}

            {/* Incline — treadmill running only */}
            {cfg.showIncline && (
            <div className="py-4 border-b border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                Incline <span className="normal-case text-xs">(optional)</span>
              </p>
              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {INCLINE_PRESETS.map((pct) => (
                  <button
                    key={pct}
                    onClick={() => {
                      const next = inclinePercent === pct ? null : pct;
                      setInclinePercent(next);
                      setInclineStr(next != null ? String(next) : "");
                    }}
                    className={`flex-shrink-0 px-3 h-10 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                      inclinePercent === pct
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={inclineStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    setInclineStr(val);
                    const n = parseInt(val);
                    setInclinePercent(!isNaN(n) && val !== "" ? Math.min(30, n) : null);
                  }}
                  onBlur={() => {
                    if (inclinePercent != null) setInclineStr(String(inclinePercent));
                    else setInclineStr("");
                  }}
                  className="flex-1 rounded-xl bg-background border border-border px-4 py-2.5 text-center text-xl font-bold outline-none focus:ring-2 ring-primary"
                />
                <span className="text-sm font-medium text-muted-foreground">%</span>
              </div>
            </div>
            )}
            {/* Target HR Zone */}
            <div className="py-4 border-b border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                Target HR Zone <span className="normal-case text-xs">(optional)</span>
              </p>
              <div className="flex gap-2">
                {HR_ZONES.map(({ zone, label, desc }) => (
                  <button
                    key={zone}
                    onClick={() => setTargetHeartRateZone(targetHeartRateZone === zone ? null : zone)}
                    className={`flex-1 flex flex-col items-center py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                      targetHeartRateZone === zone
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    <span>{label}</span>
                    <span className="text-[10px] opacity-70 font-normal">{desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : isTimed ? (
          <>
            {/* Duration row for timed exercises */}
            <button
              onClick={() => { setShowDurationPicker(true); }}
              className="w-full flex items-center justify-between py-4 border-b border-border transition-colors hover:bg-muted/50 active:bg-muted/70"
            >
              <span className="text-base font-medium">Duration</span>
              <span className="text-base text-muted-foreground">
                {formatTime(duration)}
              </span>
            </button>

            {/* Opt-in prep time before the countdown starts (e.g. getting into
                a handstand). Shown as an amber lead-in slice on the timer ring. */}
            <div className="py-4 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-base font-medium">
                  Start delay{" "}
                  <span className="text-xs text-muted-foreground">(get into position)</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {startDelay > 0 ? `${startDelay}s` : "None"}
                </span>
              </div>
              <div className="flex gap-2">
                {START_DELAY_OPTIONS.map(({ value, label }) => (
                  <button
                    key={label}
                    onClick={() => setStartDelay(value)}
                    className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                      startDelay === value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Reps */}
            <button
              onClick={() => { setRepsStr(String(reps)); setShowRepsPicker(true); }}
              className="w-full flex items-center justify-between py-4 border-b border-border transition-colors hover:bg-muted/50 active:bg-muted/70"
            >
              <span className="text-base font-medium">{failed ? "Reps done" : "Reps"}</span>
              <span className="text-base text-muted-foreground">{reps}</span>
            </button>

            {/* Weight */}
            <button
              onClick={() => { setWeightStr(String(weight)); setShowWeightPicker(true); }}
              className="w-full flex items-center justify-between py-4 border-b border-border transition-colors hover:bg-muted/50 active:bg-muted/70"
            >
              <span className="text-base font-medium">Weight (kg)</span>
              <span className="text-base text-muted-foreground">{weight}</span>
            </button>

            {/* Exercise type — edits the per-program override on the exercise
                (applies to every set of this exercise in this program). */}
            <button
              onClick={() => setShowTypePicker(true)}
              className="w-full flex items-center justify-between py-4 border-b border-border transition-colors hover:bg-muted/50 active:bg-muted/70"
            >
              <span className="text-base font-medium">Type</span>
              <span className="flex items-center gap-2 text-base text-muted-foreground">
                {/* Slot is always present: mounting the spinner into the row
                    shoved the label 16px sideways for the duration of the save. */}
                <span className="w-4 h-4 shrink-0">
                  {savingType && <Loader2 className="h-4 w-4 animate-spin" />}
                </span>
                {resolvedType ? EXERCISE_TYPE_LABELS[resolvedType] : "—"}
              </span>
            </button>

            {/* Mark-as-failed — workout mode only. Keeps the target as the goal
                and logs the (lower) reps actually achieved.
                Deliberately sits ABOVE "Reps in reserve": toggling it unmounts
                that block, and when this button sat below it the collapse threw
                the button itself 113px up the screen, so an immediate second tap
                to undo landed on whatever had slid into its place. Above it, the
                reflow happens entirely below the control being tapped. */}
            {isWorkout && (
              <button
                onClick={() => {
                  const next = !failed;
                  setFailed(next);
                  // Failed and easy are opposite verdicts on the same set.
                  if (next) setEasy(false);
                  // Entering failed mode: default achieved reps to 0 so a wiped
                  // set is the common one-tap case; leaving it restores the target.
                  if (next) { setReps(0); setRepsStr("0"); }
                  else { const t = set.targetReps ?? 10; setReps(t); setRepsStr(String(t)); }
                }}
                className={`w-full flex items-center justify-between py-4 border-b border-border transition-colors active:bg-muted/70 ${failed ? "text-destructive" : "hover:bg-muted/50"}`}
              >
                <span className="text-base font-medium">Mark set as failed</span>
                <span className={`flex items-center justify-center w-6 h-6 rounded-full border-2 ${failed ? "bg-destructive border-destructive text-destructive-foreground" : "border-muted-foreground/40"}`}>
                  {failed && <span className="text-xs leading-none">✕</span>}
                </span>
              </button>
            )}

            {/* Mark-as-easy — the counterpart to mark-as-failed. Progression
                normally waits for two confident hits in the last five sessions;
                this says "there was plenty left, bump it" and carries that to
                the next session's suggestion on its own. Stays mounted while
                failed is on (it just reads as off) so toggling failed never
                moves this row under the user's finger. */}
            {isWorkout && (
              <button
                onClick={() => {
                  const next = !easy;
                  setEasy(next);
                  if (next && failed) {
                    // Coming from failed: restore the target as the reps done,
                    // since an easy set is by definition a completed one.
                    setFailed(false);
                    const t = set.targetReps ?? 10;
                    setReps(t);
                    setRepsStr(String(t));
                  }
                }}
                className={`w-full flex items-center justify-between py-4 border-b border-border transition-colors active:bg-muted/70 ${easy ? "text-primary" : "hover:bg-muted/50"}`}
              >
                <span className="text-left">
                  <span className="block text-base font-medium">Mark set as easy</span>
                  <span className="block text-xs text-muted-foreground">
                    Suggests going heavier next session
                  </span>
                </span>
                <span className={`flex items-center justify-center w-6 h-6 rounded-full border-2 ${easy ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                  {easy && <span className="text-xs leading-none">↑</span>}
                </span>
              </button>
            )}

            {/* Reps in reserve — workout mode only. The effort signal that feeds
                progression/adaptation (rpe is derived as 10 − rir). Hidden when the
                set is marked failed, since failure implies RIR 0. */}
            {isWorkout && !failed && (
              <div className="py-4 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-base font-medium">
                    Reps in reserve{" "}
                    <span className="text-xs text-muted-foreground">
                      {set.targetRir != null ? `(target ${set.targetRir})` : "(optional)"}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {rir == null ? "Not logged" : rir === 0 ? "to failure" : rir === 5 ? "5+ left" : `${rir} left`}
                  </span>
                </div>
                <div className="flex gap-2">
                  {RIR_OPTIONS.map(({ value, label }) => (
                    <button
                      key={label}
                      onClick={() => setRir(value)}
                      className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                        rir === value
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Program-edit controls — configure the set's prescription. Hidden during
            a workout (rest is auto-applied by the rest timer; RIR is logged, not set). */}
        {!isWorkout && (
          <>
            {/* Target RIR — prescribe the intensity cap (rep-based strength sets only). */}
            {!isRunning && !isTimed && (
              <div className="py-4 border-b border-border">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-base font-medium">
                    Target RIR <span className="text-xs text-muted-foreground">(optional)</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {prescribedRir == null ? "None" : prescribedRir === 0 ? "to failure" : prescribedRir === 5 ? "5+ left" : `${prescribedRir} left`}
                  </span>
                </div>
                <div className="flex gap-2">
                  {RIR_OPTIONS.map(({ value, label }) => (
                    <button
                      key={label}
                      onClick={() => setPrescribedRir(value)}
                      className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                        prescribedRir === value
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Rest after this set — every program set carries a rest period. */}
            <button
              onClick={() => setShowRestPicker(true)}
              className="w-full flex items-center justify-between py-4 border-b border-border transition-colors hover:bg-muted/50 active:bg-muted/70"
            >
              <span className="text-base font-medium">Rest after set</span>
              <span className="text-base text-muted-foreground">
                {restSeconds > 0 ? formatTime(restSeconds) : "—"}
              </span>
            </button>
          </>
        )}

        {/* Per-set notes — workout mode only. Captures observations like
            "shoulder twinge on rep 6", "felt easy", "added belt". */}
        {isWorkout && (
          <div className="mt-4">
            <label
              htmlFor="set-note"
              className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2"
            >
              Note
            </label>
            <textarea
              id="set-note"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 500))}
              placeholder="How did it feel? Any cues or warnings?"
              rows={3}
              className="w-full rounded-xl bg-muted px-3 py-2 text-base placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <p className="text-[10px] text-muted-foreground/70 text-right mt-1 tabular-nums">
              {notes.length}/500
            </p>
          </div>
        )}

      </div>

      {/* Save button */}
      <div className="p-4">
        <button
          onClick={handleSave}
          disabled={saving || (isRunning && !isWorkout && runMode === "distance" && distanceMeters <= 0) || (isRunning && !isWorkout && runMode === "time" && duration <= 0)}
          className="w-full rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Saving...
            </span>
          ) : (
            "Save"
          )}
        </button>
      </div>

      {/* Reps Picker Modal */}
      <BottomSheet open={showRepsPicker} onClose={() => setShowRepsPicker(false)} blur>
          <div className="w-full bg-card rounded-t-3xl p-6">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm text-muted-foreground uppercase tracking-wider">
                Select Reps
              </span>
              <button
                onClick={() => setShowRepsPicker(false)}
                className="text-primary text-sm font-medium"
              >
                Done
              </button>
            </div>

            {/* Number picker */}
            <div ref={repsScrollRef} className="flex gap-2 overflow-x-auto pb-4 no-scrollbar">
              {repOptions.map((num) => (
                <button
                  key={num}
                  onClick={() => {
                    setReps(num);
                    setShowRepsPicker(false);
                  }}
                  className={`flex-shrink-0 w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold transition-all hover:scale-105 active:scale-95 ${
                    reps === num
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground hover:bg-muted/80 active:bg-muted"
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>

            {/* Manual input */}
            <div className="mt-4">
              <input
                type="text"
                inputMode="numeric"
                value={repsStr}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setRepsStr(val);
                  // Only commit a real number. Clearing the field to type a new
                  // value used to write repsMin straight through — in workout
                  // mode that is 0, so a half-finished edit left the set at
                  // "Reps 0" and kept it if the sheet was dismissed. onBlur
                  // still normalises whatever is left behind.
                  if (val !== "") setReps(Math.max(repsMin, parseInt(val)));
                }}
                onBlur={() => {
                  const n = Math.max(repsMin, parseInt(repsStr) || repsMin);
                  setReps(n);
                  setRepsStr(String(n));
                  requestAnimationFrame(() => centerReps(n, true));
                }}
                className="w-full rounded-xl bg-background px-4 py-3 text-center text-2xl font-bold outline-none focus:ring-2 ring-primary"
              />
            </div>
          </div>
      </BottomSheet>

      {/* Duration Picker Modal */}
      <BottomSheet open={showDurationPicker} onClose={() => setShowDurationPicker(false)} blur>
          <div className="w-full bg-card rounded-t-3xl p-6">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm text-muted-foreground uppercase tracking-wider">
                Select Duration
              </span>
              <button
                onClick={() => setShowDurationPicker(false)}
                className="text-primary text-sm font-medium"
              >
                Done
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar">
              {(isRunning && runMode === "time" ? RUNNING_DURATION_PRESETS_S : DURATION_OPTIONS).map((seconds) => (
                <button
                  key={seconds}
                  onClick={() => {
                    setDuration(seconds);
                    setDurationMinStr(String(Math.floor(seconds / 60)));
                    setDurationSecStr(String(seconds % 60).padStart(2, "0"));
                    setShowDurationPicker(false);
                  }}
                  className={`flex-shrink-0 w-20 h-20 rounded-full flex flex-col items-center justify-center font-bold transition-all active:scale-95 ${
                    duration === seconds
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {seconds < 60 ? (
                    <>
                      <span className="text-lg">{seconds}</span>
                      <span className="text-xs opacity-70">s</span>
                    </>
                  ) : seconds % 60 === 0 ? (
                    <>
                      <span className="text-lg">{seconds / 60}</span>
                      <span className="text-xs opacity-70">m</span>
                    </>
                  ) : (
                    <>
                      <span className="text-lg">
                        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
                      </span>
                      <span className="text-xs opacity-70">m</span>
                    </>
                  )}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-end justify-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={durationMinStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    setDurationMinStr(val);
                    // Empty field = mid-edit, not "zero minutes" — see the reps input.
                    if (val === "") return;
                    const mins = Math.max(0, Math.min(59, parseInt(val)));
                    setDuration(mins * 60 + (duration % 60));
                  }}
                  onBlur={() => setDurationMinStr(String(Math.floor(duration / 60)))}
                  className="w-24 rounded-xl bg-background border border-border px-2 py-3 text-center text-3xl font-bold outline-none focus:ring-2 ring-primary"
                />
                <span className="text-xs text-muted-foreground">min</span>
              </div>
              <span className="text-3xl font-bold pb-6">:</span>
              <div className="flex flex-col items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={durationSecStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    setDurationSecStr(val);
                    // Empty field = mid-edit, not "zero seconds" — see the reps input.
                    if (val === "") return;
                    const secs = Math.max(0, Math.min(59, parseInt(val)));
                    setDuration(Math.floor(duration / 60) * 60 + secs);
                  }}
                  onBlur={() => setDurationSecStr(String(duration % 60).padStart(2, "0"))}
                  className="w-24 rounded-xl bg-background border border-border px-2 py-3 text-center text-3xl font-bold outline-none focus:ring-2 ring-primary"
                />
                <span className="text-xs text-muted-foreground">sec</span>
              </div>
            </div>
          </div>
      </BottomSheet>

      {/* Weight Picker Modal */}
      <BottomSheet open={showWeightPicker} onClose={() => setShowWeightPicker(false)} blur>
          <div className="w-full bg-card rounded-t-3xl p-6">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm text-muted-foreground uppercase tracking-wider">
                Select Weight
              </span>
              <button
                onClick={() => setShowWeightPicker(false)}
                className="text-primary text-sm font-medium"
              >
                Done
              </button>
            </div>

            {/* Weight picker */}
            <div ref={weightScrollRef} className="flex gap-2 overflow-x-auto pb-4 no-scrollbar">
              {weightOptions.map((num) => {
                // The typed-in value sits in the ladder at its sorted position
                // (withCustomOption). A dashed ring and a "custom" caption keep
                // it distinguishable from the 2.5 kg presets around it.
                const isCustom = !WEIGHT_OPTIONS.includes(num);
                return (
                  <button
                    key={num}
                    onClick={() => {
                      setWeight(num);
                      setWeightStr(String(num));
                      setShowWeightPicker(false);
                    }}
                    className={`flex-shrink-0 w-20 h-20 rounded-full flex flex-col items-center justify-center font-bold transition-all hover:scale-105 active:scale-95 ${
                      num === weight
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground hover:bg-muted/80 active:bg-muted"
                    } ${
                      isCustom
                        ? `border-2 border-dashed ${num === weight ? "border-primary-foreground/60" : "border-primary/60"}`
                        : ""
                    }`}
                  >
                    <span className="text-lg">{num}</span>
                    <span className="text-xs opacity-70">{isCustom ? "custom" : "kg"}</span>
                  </button>
                );
              })}
            </div>

            {/* Manual input */}
            <div className="mt-4">
              <input
                type="text"
                inputMode="decimal"
                value={weightStr}
                onChange={(e) => {
                  const val = sanitizeDecimalInput(e.target.value);
                  setWeightStr(val);
                  const n = parseFloat(val);
                  if (!isNaN(n)) setWeight(n);
                }}
                onBlur={() => {
                  const n = parseFloat(weightStr) || 0;
                  setWeight(n);
                  setWeightStr(String(n));
                  requestAnimationFrame(() => centerWeight(n, true));
                }}
                className="w-full rounded-xl bg-background px-4 py-3 text-center text-2xl font-bold outline-none focus:ring-2 ring-primary"
              />
            </div>
          </div>
      </BottomSheet>

      {/* Exercise Type Picker Modal */}
      <BottomSheet open={showTypePicker} onClose={() => setShowTypePicker(false)} blur>
          <div className="w-full bg-card rounded-t-3xl p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground uppercase tracking-wider">
                Exercise Type
              </span>
              <button
                onClick={() => setShowTypePicker(false)}
                className="text-primary text-sm font-medium"
              >
                Done
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Applies to all sets of this exercise in this program.
              {exerciseTypeDefault ? ` Default: ${EXERCISE_TYPE_LABELS[exerciseTypeDefault as ExerciseType]}.` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleTypeChange(null)}
                className={`px-4 h-11 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                  typeOverride == null
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                Default
              </button>
              {EXERCISE_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => handleTypeChange(t)}
                  className={`px-4 h-11 rounded-full text-sm font-semibold transition-all active:scale-95 ${
                    typeOverride === t
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {EXERCISE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
      </BottomSheet>

      {/* Rest Picker Modal (program-edit) */}
      <BottomSheet open={showRestPicker} onClose={() => setShowRestPicker(false)} blur>
          <div className="w-full bg-card rounded-t-3xl p-6">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm text-muted-foreground uppercase tracking-wider">
                Rest after set
              </span>
              <button
                onClick={() => setShowRestPicker(false)}
                className="text-primary text-sm font-medium"
              >
                Done
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar">
              {REST_OPTIONS.map((seconds) => (
                <button
                  key={seconds}
                  onClick={() => {
                    setRestSeconds(seconds);
                    setRestMinStr(String(Math.floor(seconds / 60)));
                    setRestSecStr(String(seconds % 60).padStart(2, "0"));
                    setShowRestPicker(false);
                  }}
                  className={`flex-shrink-0 w-20 h-20 rounded-full flex flex-col items-center justify-center font-bold transition-all active:scale-95 ${
                    restSeconds === seconds
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {seconds === 0 ? (
                    <span className="text-sm">Off</span>
                  ) : seconds % 60 === 0 ? (
                    <>
                      <span className="text-lg">{seconds / 60}</span>
                      <span className="text-xs opacity-70">m</span>
                    </>
                  ) : (
                    <span className="text-lg">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-end justify-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={restMinStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    setRestMinStr(val);
                    const mins = Math.max(0, Math.min(59, parseInt(val) || 0));
                    setRestSeconds(mins * 60 + (restSeconds % 60));
                  }}
                  onBlur={() => setRestMinStr(String(Math.floor(restSeconds / 60)))}
                  className="w-24 rounded-xl bg-background border border-border px-2 py-3 text-center text-3xl font-bold outline-none focus:ring-2 ring-primary"
                />
                <span className="text-xs text-muted-foreground">min</span>
              </div>
              <span className="text-3xl font-bold pb-6">:</span>
              <div className="flex flex-col items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={restSecStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    setRestSecStr(val);
                    const secs = Math.max(0, Math.min(59, parseInt(val) || 0));
                    setRestSeconds(Math.floor(restSeconds / 60) * 60 + secs);
                  }}
                  onBlur={() => setRestSecStr(String(restSeconds % 60).padStart(2, "0"))}
                  className="w-24 rounded-xl bg-background border border-border px-2 py-3 text-center text-3xl font-bold outline-none focus:ring-2 ring-primary"
                />
                <span className="text-xs text-muted-foreground">sec</span>
              </div>
            </div>
          </div>
      </BottomSheet>
    </>
  );
}
