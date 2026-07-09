"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { addProgramSet } from "@/lib/actions/programs";
import { formatEndurancePace, formatTime, sanitizeDecimalInput } from "@/lib/utils/format";
import { disciplineConfig, type Discipline } from "@/lib/utils/discipline";
import type { SetType } from "@/lib/validators/workout";
import type { ProgramSet } from "@/types/workout";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Interpolates orange → yellow → green across the range
function gradientColor(index: number, total: number): string {
  const ratio = index / Math.max(total - 1, 1);
  if (ratio < 0.5) {
    const t = ratio / 0.5;
    return `rgb(${Math.round(249 + (234 - 249) * t)},${Math.round(115 + (179 - 115) * t)},${Math.round(22 + (8 - 22) * t)})`;
  }
  const t = (ratio - 0.5) / 0.5;
  return `rgb(${Math.round(234 + (34 - 234) * t)},${Math.round(179 + (197 - 179) * t)},${Math.round(8 + (94 - 8) * t)})`;
}

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 300, 600];
const RUNNING_DURATION_PRESETS_S = [600, 1200, 1800, 2400, 3000, 3600, 4500, 5400, 7200]; // 10–120 min
const INCLINE_PRESETS = [0, 1, 2, 3, 5, 8, 10, 12, 15];
const HR_ZONES = [
  { zone: 1, label: "Z1", desc: "Recovery" },
  { zone: 2, label: "Z2", desc: "Aerobic" },
  { zone: 3, label: "Z3", desc: "Tempo" },
  { zone: 4, label: "Z4", desc: "Threshold" },
  { zone: 5, label: "Z5", desc: "VO₂Max" },
];

type Props = {
  programId: number;
  programExerciseId: number;
  nextSetNumber: number;
  lastSet?: ProgramSet;
  isTimed?: boolean;
  isWorkout?: boolean;
  isRunning?: boolean;
  /** Triathlon discipline of the exercise. Null → generic run-mode behavior. */
  discipline?: Discipline | null;
};

export function NewSetView({
  programId,
  programExerciseId,
  nextSetNumber,
  lastSet,
  isTimed = false,
  isWorkout = false,
  isRunning = false,
  discipline = null,
}: Props) {
  const router = useRouter();
  const cfg = disciplineConfig(discipline);
  const metersToInput = (m: number) => (cfg.inputUnit === "m" ? String(m) : String(m / 1000));
  const inputToMeters = (val: string): number | null => {
    const n = parseFloat(val);
    if (isNaN(n) || n < 0) return null;
    return cfg.inputUnit === "m" ? Math.round(n) : Math.round(n * 1000);
  };
  const [showRepsPicker, setShowRepsPicker] = useState(false);
  const [showWeightPicker, setShowWeightPicker] = useState(false);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [showRepsKeypad, setShowRepsKeypad] = useState(false);
  const [showWeightKeypad, setShowWeightKeypad] = useState(false);
  const [saving, setSaving] = useState(false);
  const repsInputRef = useRef<HTMLInputElement>(null);
  const weightInputRef = useRef<HTMLInputElement>(null);

  const [runMode, setRunMode] = useState<"distance" | "time">(
    lastSet?.distanceMeters != null ? "distance"
    : lastSet?.durationSeconds != null ? "time"
    : "distance"
  );
  const [reps, setReps] = useState(lastSet?.targetReps ?? 10);
  const [weight, setWeight] = useState(Number(lastSet?.weightKg ?? 0));
  const [setType, setSetType] = useState<SetType>(
    (lastSet?.setType as SetType | undefined) ?? "working",
  );
  const initialDuration = isRunning
    ? Number(lastSet?.durationSeconds ?? 0)
    : Number(lastSet?.durationSeconds ?? 60);
  const [duration, setDuration] = useState(initialDuration);
  const [distanceMeters, setDistanceMeters] = useState(lastSet?.distanceMeters ?? cfg.defaultDistanceM);
  const [distanceStr, setDistanceStr] = useState(metersToInput(lastSet?.distanceMeters ?? cfg.defaultDistanceM));
  const [inclinePercent, setInclinePercent] = useState<number | null>(lastSet?.inclinePercent ?? null);
  const [inclineStr, setInclineStr] = useState(lastSet?.inclinePercent != null ? String(lastSet.inclinePercent) : "");
  const [targetHeartRateZone, setTargetHeartRateZone] = useState<number | null>(lastSet?.targetHeartRateZone ?? null);
  const [repsStr, setRepsStr] = useState(String(lastSet?.targetReps ?? 10));
  const [weightStr, setWeightStr] = useState(String(Number(lastSet?.weightKg ?? 0)));
  const [durationMinStr, setDurationMinStr] = useState(String(Math.floor(initialDuration / 60)));
  const [durationSecStr, setDurationSecStr] = useState(String(initialDuration % 60).padStart(2, "0"));
  const weightScrollRef = useRef<HTMLDivElement>(null);
  const repsScrollRef = useRef<HTMLDivElement>(null);

  const WEIGHT_OPTIONS = [0, ...Array.from({ length: 60 }, (_, i) => (i + 1) * 2.5)];
  const closestWeight = WEIGHT_OPTIONS.reduce((prev, curr) =>
    Math.abs(curr - weight) < Math.abs(prev - weight) ? curr : prev
  );

  const BASE_REPS = Array.from({ length: 30 }, (_, i) => i + 1);
  const repOptions = reps > 30 ? [...BASE_REPS, reps] : BASE_REPS;

  useEffect(() => {
    if (!showRepsPicker) return;
    requestAnimationFrame(() => {
      const el = repsScrollRef.current;
      if (!el) return;
      const index = repOptions.indexOf(reps);
      const itemWidth = 52; // w-11 (44px) + gap-2 (8px)
      el.scrollLeft = Math.max(0, index * itemWidth - el.clientWidth / 2 + 22);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRepsPicker, reps]);

  useEffect(() => {
    if (!showWeightPicker) return;
    requestAnimationFrame(() => {
      const el = weightScrollRef.current;
      if (!el) return;
      const index = WEIGHT_OPTIONS.indexOf(closestWeight);
      const itemWidth = 52; // w-11 (44px) + gap-2 (8px)
      el.scrollLeft = Math.max(0, index * itemWidth - el.clientWidth / 2 + 22);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWeightPicker]);

  const handleSave = async () => {
    setSaving(true);
    if (isRunning) {
      if (runMode === "distance") {
        await addProgramSet({
          programExerciseId,
          setNumber: nextSetNumber,
          distanceMeters,
          durationSeconds: duration > 0 ? duration : undefined,
          inclinePercent: inclinePercent ?? undefined,
          targetHeartRateZone: targetHeartRateZone ?? undefined,
          restTimeSeconds: 0,
          setType,
        });
      } else {
        await addProgramSet({
          programExerciseId,
          setNumber: nextSetNumber,
          durationSeconds: duration,
          inclinePercent: inclinePercent ?? undefined,
          targetHeartRateZone: targetHeartRateZone ?? undefined,
          restTimeSeconds: 0,
          setType,
        });
      }
    } else if (isTimed) {
      await addProgramSet({
        programExerciseId,
        setNumber: nextSetNumber,
        durationSeconds: duration,
        restTimeSeconds: 0,
        setType,
      });
    } else {
      await addProgramSet({
        programExerciseId,
        setNumber: nextSetNumber,
        targetReps: reps,
        weightKg: weight,
        restTimeSeconds: 0,
        setType,
      });
    }
    router.push(
      isWorkout
        ? `/programs/${programId}/workout/exercises/${programExerciseId}?edit=true`
        : `/programs/${programId}/exercises/${programExerciseId}?edit=true`
    );
  };

  return (
    <>
      <div className="flex-1 px-4 animate-in fade-in duration-150">
        {/* Set-type toggle: warmup sets are excluded from auto-progression. */}
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
                {/* Distance presets */}
                <div className="py-4 border-b border-border">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Distance</p>
                  <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                    {cfg.distancePresetsM.map((m, i) => (
                      <button
                        key={m}
                        onClick={() => {
                          if (m !== distanceMeters) {
                            setDistanceMeters(m);
                            setDistanceStr(metersToInput(m));
                            setDuration(0);
                            setDurationMinStr("0");
                            setDurationSecStr("00");
                          }
                        }}
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

                {/* Optional duration target */}
                <button
                  onClick={() => setShowDurationPicker(true)}
                  className="w-full flex items-center justify-between py-4 border-b border-border transition-colors hover:bg-muted/50 active:bg-muted/70"
                >
                  <span className="text-base font-medium">Target duration <span className="text-xs text-muted-foreground">(optional)</span></span>
                  <span className="text-base text-muted-foreground">
                    {duration > 0 ? formatTime(duration) : "—"}
                  </span>
                </button>

                {/* Derived pace */}
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
          /* Duration row for timed exercises */
          <button
            onClick={() => setShowDurationPicker(true)}
            className="w-full flex items-center justify-between py-4 border-b border-border transition-colors hover:bg-muted/50 active:bg-muted/70"
          >
            <span className="text-base font-medium">Duration</span>
            <span className="text-base text-muted-foreground">
              {formatTime(duration)}
            </span>
          </button>
        ) : (
          <>
            {/* Reps */}
            <button
              onClick={() => setShowRepsPicker(true)}
              className="w-full flex items-center justify-between py-4 border-b border-border transition-colors hover:bg-muted/50 active:bg-muted/70"
            >
              <span className="text-base font-medium">Reps</span>
              <span className="text-base text-muted-foreground">{reps}</span>
            </button>

            {/* Weight */}
            <button
              onClick={() => setShowWeightPicker(true)}
              className="w-full flex items-center justify-between py-4 border-b border-border transition-colors hover:bg-muted/50 active:bg-muted/70"
            >
              <span className="text-base font-medium">Weight (kg)</span>
              <span className="text-base text-muted-foreground">{weight}</span>
            </button>
          </>
        )}
      </div>

      {/* Save button */}
      <div className="p-4">
        <button
          onClick={handleSave}
          disabled={saving || (isRunning && runMode === "distance" && distanceMeters <= 0) || (isRunning && runMode === "time" && duration <= 0)}
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

      {/* Duration Picker Modal */}
      <BottomSheet open={showDurationPicker} onClose={() => setShowDurationPicker(false)} blur>
        <div className="w-full bg-card rounded-t-3xl pb-10">
          <div className="flex items-center justify-between px-5 pt-6 pb-5">
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
          <div className="flex gap-2 overflow-x-auto px-5 pb-3 no-scrollbar">
            {(isRunning && runMode === "time" ? RUNNING_DURATION_PRESETS_S : DURATION_OPTIONS).map((seconds) => (
              <button
                key={seconds}
                onClick={() => { setDuration(seconds); setDurationMinStr(String(Math.floor(seconds / 60))); setDurationSecStr(String(seconds % 60).padStart(2, "0")); setShowDurationPicker(false); }}
                className={`flex-shrink-0 w-20 h-20 rounded-full flex flex-col items-center justify-center font-bold transition-all active:scale-95 ${
                  duration === seconds ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                }`}
              >
                {seconds < 60 ? (
                  <><span className="text-lg">{seconds}</span><span className="text-xs opacity-70">s</span></>
                ) : seconds % 60 === 0 ? (
                  <><span className="text-lg">{seconds / 60}</span><span className="text-xs opacity-70">m</span></>
                ) : (
                  <><span className="text-lg">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span><span className="text-xs opacity-70">m</span></>
                )}
              </button>
            ))}
          </div>
          <div className="px-5 pt-2">
            <div className="flex items-end justify-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={durationMinStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    setDurationMinStr(val);
                    const mins = Math.max(0, Math.min(59, parseInt(val) || 0));
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
                    const secs = Math.max(0, Math.min(59, parseInt(val) || 0));
                    setDuration(Math.floor(duration / 60) * 60 + secs);
                  }}
                  onBlur={() => setDurationSecStr(String(duration % 60).padStart(2, "0"))}
                  className="w-24 rounded-xl bg-background border border-border px-2 py-3 text-center text-3xl font-bold outline-none focus:ring-2 ring-primary"
                />
                <span className="text-xs text-muted-foreground">sec</span>
              </div>
            </div>
          </div>
        </div>
      </BottomSheet>

      {/* Reps Picker Modal */}
      <BottomSheet open={showRepsPicker} onClose={() => setShowRepsPicker(false)} blur>
          <div className="w-full bg-card rounded-t-3xl pb-10">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-6 pb-5">
              <span className="text-sm text-muted-foreground uppercase tracking-wider">
                Select Reps
              </span>
              <button
                onClick={() => {
                  if (!showRepsKeypad) setRepsStr(String(reps));
                  setShowRepsKeypad((v) => !v);
                  setTimeout(() => repsInputRef.current?.focus(), 50);
                }}
                className="text-primary text-sm font-medium"
              >
                Keypad
              </button>
            </div>

            {/* Scroll wheel */}
            <div ref={repsScrollRef} className="flex gap-2 overflow-x-auto px-5 pb-3 no-scrollbar cursor-grab active:cursor-grabbing">
              {repOptions.map((num, idx) => {
                const color = gradientColor(Math.min(idx, 29), 30);
                const selected = reps === num;
                return (
                  <button
                    key={num}
                    onClick={() => setReps(num)}
                    style={
                      selected
                        ? { backgroundColor: color, borderColor: color }
                        : { borderColor: color, color }
                    }
                    className={`flex-shrink-0 w-11 h-11 rounded-full border-2 flex items-center justify-center text-sm font-semibold transition-all ${
                      selected ? "text-black scale-110" : "bg-transparent"
                    }`}
                  >
                    {num}
                  </button>
                );
              })}
            </div>

            {/* Manual input */}
            {showRepsKeypad && (
              <div className="px-5 pt-2 pb-1">
                <input
                  ref={repsInputRef}
                  type="text"
                  inputMode="numeric"
                  value={repsStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    setRepsStr(val);
                    setReps(Math.max(1, parseInt(val) || 1));
                  }}
                  onBlur={() => { const n = Math.max(1, parseInt(repsStr) || 1); setReps(n); setRepsStr(String(n)); }}
                  className="w-full rounded-xl bg-background border border-border px-4 py-3 text-center text-2xl font-bold outline-none focus:ring-2 ring-primary"
                />
              </div>
            )}
          </div>
      </BottomSheet>

      {/* Weight Picker Modal */}
      <BottomSheet open={showWeightPicker} onClose={() => setShowWeightPicker(false)} blur>
          <div className="w-full bg-card rounded-t-3xl pb-10">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-6 pb-5">
              <span className="text-sm text-muted-foreground uppercase tracking-wider">
                Select Weight
              </span>
              <button
                onClick={() => {
                  if (!showWeightKeypad) setWeightStr(String(weight));
                  setShowWeightKeypad((v) => !v);
                  setTimeout(() => weightInputRef.current?.focus(), 50);
                }}
                className="text-primary text-sm font-medium"
              >
                Keypad
              </button>
            </div>

            {/* Scroll wheel */}
            <div ref={weightScrollRef} className="flex gap-2 overflow-x-auto px-5 pb-3 no-scrollbar cursor-grab active:cursor-grabbing">
              {WEIGHT_OPTIONS.map((num, idx) => {
                  const total = 61;
                  const color = gradientColor(idx, total);
                  const selected = num === closestWeight;
                  return (
                    <button
                      key={num}
                      onClick={() => setWeight(num)}
                      style={
                        selected
                          ? { backgroundColor: color, borderColor: color }
                          : { borderColor: color, color }
                      }
                      className={`flex-shrink-0 w-11 h-11 rounded-full border-2 flex items-center justify-center text-xs font-semibold transition-all ${
                        selected ? "text-black scale-110" : "bg-transparent"
                      }`}
                    >
                      {num % 1 === 0 ? num : num.toFixed(1)}
                    </button>
                  );
              })}
            </div>

            {/* Manual input */}
            {showWeightKeypad && (
              <div className="px-5 pt-2 pb-1">
                <input
                  ref={weightInputRef}
                  type="text"
                  inputMode="decimal"
                  value={weightStr}
                  onChange={(e) => {
                    const val = sanitizeDecimalInput(e.target.value);
                    setWeightStr(val);
                    const n = parseFloat(val);
                    if (!isNaN(n)) setWeight(Math.max(0, n));
                  }}
                  onBlur={() => { const n = parseFloat(weightStr) || 0; setWeight(n); setWeightStr(String(n)); }}
                  className="w-full rounded-xl bg-background border border-border px-4 py-3 text-center text-2xl font-bold outline-none focus:ring-2 ring-primary"
                />
              </div>
            )}
          </div>
      </BottomSheet>
    </>
  );
}
