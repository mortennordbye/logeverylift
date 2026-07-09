"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { formatEnduranceDistance, formatEndurancePace, sanitizeDecimalInput } from "@/lib/utils/format";
import { disciplineConfig, type Discipline } from "@/lib/utils/discipline";
import { useState, useEffect } from "react";

const RPE_OPTIONS = [6, 7, 8, 9, 10];
const INCLINE_PRESETS = [0, 1, 2, 3, 5, 8, 10, 12, 15];
const HR_ZONES = [
  { zone: 1, label: "Z1", desc: "Recovery" },
  { zone: 2, label: "Z2", desc: "Aerobic" },
  { zone: 3, label: "Z3", desc: "Tempo" },
  { zone: 4, label: "Z4", desc: "Threshold" },
  { zone: 5, label: "Z5", desc: "VO₂Max" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  discipline?: Discipline | null;
  onConfirm: (distanceMeters: number, durationSeconds: number, rpe: number, inclinePercent: number | null, heartRateZone: number | null) => void;
  targetDistanceMeters?: number | null;
  targetDurationSeconds?: number | null;
  targetInclinePercent?: number | null;
  targetHeartRateZone?: number | null;
  setNumber: number;
  totalSets: number;
};

export function LogRunModal({
  open,
  onClose,
  discipline = null,
  onConfirm,
  targetDistanceMeters,
  targetDurationSeconds,
  targetInclinePercent,
  targetHeartRateZone,
  setNumber,
  totalSets,
}: Props) {
  const cfg = disciplineConfig(discipline);
  const metersToInput = (m: number) => (cfg.inputUnit === "m" ? String(m) : String(m / 1000));
  const inputToMeters = (val: string): number | null => {
    const n = parseFloat(val);
    if (isNaN(n) || n < 0) return null;
    return cfg.inputUnit === "m" ? Math.round(n) : Math.round(n * 1000);
  };
  const [distanceMeters, setDistanceMeters] = useState(
    targetDistanceMeters ?? cfg.defaultDistanceM,
  );
  const [durationSeconds, setDurationSeconds] = useState(
    targetDurationSeconds ?? 0,
  );
  const [rpe, setRpe] = useState(7);
  const [inclinePercent, setInclinePercent] = useState<number | null>(targetInclinePercent ?? null);
  const [inclineStr, setInclineStr] = useState(targetInclinePercent != null ? String(targetInclinePercent) : "");
  const [heartRateZone, setHeartRateZone] = useState<number | null>(targetHeartRateZone ?? null);
  const [minStr, setMinStr] = useState(
    String(Math.floor((targetDurationSeconds ?? 0) / 60)),
  );
  const [secStr, setSecStr] = useState(
    String((targetDurationSeconds ?? 0) % 60).padStart(2, "0"),
  );
  const [distanceStr, setDistanceStr] = useState(
    metersToInput(targetDistanceMeters ?? cfg.defaultDistanceM),
  );

  // Reset when opened with new target values
  useEffect(() => {
    if (!open) return;
    const dist = targetDistanceMeters ?? cfg.defaultDistanceM;
    const dur = targetDurationSeconds ?? 0;
    setDistanceMeters(dist);
    setDurationSeconds(dur);
    setDistanceStr(metersToInput(dist));
    setMinStr(String(Math.floor(dur / 60)));
    setSecStr(String(dur % 60).padStart(2, "0"));
    setRpe(7);
    setInclinePercent(targetInclinePercent ?? null);
    setInclineStr(targetInclinePercent != null ? String(targetInclinePercent) : "");
    setHeartRateZone(targetHeartRateZone ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetDistanceMeters, targetDurationSeconds, targetInclinePercent, targetHeartRateZone]);

  const pace =
    distanceMeters > 0 && durationSeconds > 0
      ? formatEndurancePace(cfg.paceFormatter, durationSeconds, distanceMeters)
      : null;

  const title =
    totalSets > 1
      ? `Log Interval ${setNumber} of ${totalSets}`
      : cfg.logVerb;

  const handleConfirm = () => {
    onConfirm(distanceMeters, durationSeconds, rpe, inclinePercent, heartRateZone);
  };

  return (
    <BottomSheet open={open} onClose={onClose} blur>
      <div className="w-full bg-card rounded-t-3xl pb-10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-6 pb-2">
          <span className="text-base font-semibold">{title}</span>
          <button
            onClick={onClose}
            className="text-muted-foreground text-sm font-medium"
          >
            Cancel
          </button>
        </div>

        <div className="px-5 space-y-5 pt-2">
          {/* Distance */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              Distance
            </p>
            {/* Preset bubbles */}
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
              {cfg.distancePresetsM.map((m, i) => (
                <button
                  key={m}
                  onClick={() => {
                    setDistanceMeters(m);
                    setDistanceStr(metersToInput(m));
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
            {/* Custom input */}
            <div className="flex items-center gap-2 mt-2">
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
                className="flex-1 rounded-xl bg-background border border-border px-4 py-3 text-center text-2xl font-bold outline-none focus:ring-2 ring-primary"
              />
              <span className="text-base font-medium text-muted-foreground w-8">{cfg.inputUnit}</span>
            </div>
          </div>

          {/* Duration */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              Duration
            </p>
            <div className="flex items-end gap-2">
              <div className="flex flex-col items-center gap-1 flex-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={minStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    setMinStr(val);
                    const mins = Math.max(0, parseInt(val) || 0);
                    setDurationSeconds(mins * 60 + (durationSeconds % 60));
                  }}
                  onBlur={() => setMinStr(String(Math.floor(durationSeconds / 60)))}
                  className="w-full rounded-xl bg-background border border-border px-2 py-3 text-center text-3xl font-bold outline-none focus:ring-2 ring-primary"
                />
                <span className="text-xs text-muted-foreground">min</span>
              </div>
              <span className="text-3xl font-bold pb-6">:</span>
              <div className="flex flex-col items-center gap-1 flex-1">
                <input
                  type="text"
                  inputMode="numeric"
                  value={secStr}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "");
                    setSecStr(val);
                    const secs = Math.max(0, Math.min(59, parseInt(val) || 0));
                    setDurationSeconds(Math.floor(durationSeconds / 60) * 60 + secs);
                  }}
                  onBlur={() => setSecStr(String(durationSeconds % 60).padStart(2, "0"))}
                  className="w-full rounded-xl bg-background border border-border px-2 py-3 text-center text-3xl font-bold outline-none focus:ring-2 ring-primary"
                />
                <span className="text-xs text-muted-foreground">sec</span>
              </div>
            </div>
          </div>

          {/* Live pace */}
          {pace && (
            <div className="flex items-center justify-center">
              <span className="px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                {pace}
              </span>
            </div>
          )}

          {/* Incline — treadmill running only */}
          {cfg.showIncline && (
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              Incline <span className="normal-case">(optional)</span>
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
            <div className="flex items-center gap-2 mt-2">
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
              <span className="text-sm font-medium text-muted-foreground w-5">%</span>
            </div>
          </div>
          )}

          {/* Heart Rate Zone */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              Heart Rate Zone <span className="normal-case">(optional)</span>
            </p>
            <div className="flex gap-2">
              {HR_ZONES.map(({ zone, label, desc }) => (
                <button
                  key={zone}
                  onClick={() => setHeartRateZone(heartRateZone === zone ? null : zone)}
                  className={`flex-1 flex flex-col items-center py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                    heartRateZone === zone
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

          {/* RPE */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              Effort (RPE)
            </p>
            <div className="flex gap-2">
              {RPE_OPTIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRpe(r)}
                  className={`flex-1 h-11 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                    rpe === r
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center mt-1.5">
              {rpe <= 6 ? "Easy" : rpe === 7 ? "Moderate" : rpe === 8 ? "Hard" : rpe === 9 ? "Very hard" : "Max effort"}
            </p>
          </div>
        </div>

        {/* Confirm */}
        <div className="px-5 pt-6">
          <button
            onClick={handleConfirm}
            disabled={distanceMeters <= 0}
            className="w-full rounded-xl bg-primary py-4 text-base font-semibold text-primary-foreground transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pace
              ? `${cfg.logVerb} — ${formatEnduranceDistance(cfg.inputUnit, distanceMeters)} at ${pace}`
              : `${cfg.logVerb} — ${formatEnduranceDistance(cfg.inputUnit, distanceMeters)}`}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
