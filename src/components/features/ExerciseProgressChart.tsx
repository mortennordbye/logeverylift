"use client";

import type { ExerciseProgress } from "@/lib/actions/metrics";
import { formatDateShort, formatVolume } from "@/lib/utils/format";
import { estimate1RM } from "@/lib/utils/progression";
import { useState } from "react";

type ChartMode = "weight" | "oneRM" | "volume";

/** Per-session progress of one exercise: max weight, estimated 1RM or volume. */
export function ExerciseProgressChart({ data }: { data: ExerciseProgress[] }) {
  const [mode, setMode] = useState<ChartMode>("weight");

  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        No weight data recorded yet.
      </p>
    );
  }

  const yValues = data.map((d) => {
    if (mode === "weight") return d.maxWeightKg;
    if (mode === "oneRM") return estimate1RM(d.maxWeightKg, d.repsAtMaxWeight);
    return d.totalVolume;
  });

  const max = Math.max(...yValues);
  const min = Math.min(...yValues);
  const current = yValues[yValues.length - 1];
  const first = yValues[0];
  const gain = current - first;

  const formatValue = (v: number) => {
    if (mode === "volume") return formatVolume(v);
    return `${v.toFixed(1)} kg`;
  };

  if (data.length === 1) {
    return (
      <div className="space-y-3">
        {/* Toggle */}
        <div className="flex gap-1 bg-background/50 rounded-xl p-1">
          {(["weight", "oneRM", "volume"] as ChartMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors min-h-[36px] ${
                mode === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {m === "weight" ? "Weight" : m === "oneRM" ? "Est. 1RM" : "Volume"}
            </button>
          ))}
        </div>
        <div className="text-center py-4 space-y-1">
          <div className="text-3xl font-bold">{formatValue(yValues[0])}</div>
          <div className="text-xs text-muted-foreground">
            First session · {formatDateShort(data[0].date)}
          </div>
        </div>
      </div>
    );
  }

  // SVG line chart
  const W = 280;
  const H = 56;
  const PAD = 8;
  const range = max - min || 1;
  const pts = yValues.map((v, i) => ({
    x: PAD + (i / (yValues.length - 1)) * (W - 2 * PAD),
    y: H - PAD - ((v - min) / range) * (H - 2 * PAD),
  }));
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex gap-1 bg-background/50 rounded-xl p-1">
        {(["weight", "oneRM", "volume"] as ChartMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors min-h-[36px] ${
              mode === m
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            {m === "weight" ? "Weight" : m === "oneRM" ? "Est. 1RM" : "Volume"}
          </button>
        ))}
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold">{formatValue(current)}</span>
        {gain > 0 && (
          <span className="text-sm text-green-600 dark:text-green-400 font-medium">
            +{formatValue(gain)}
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {data.length} sessions
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14">
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="currentColor"
              stopOpacity="0.15"
              className="text-primary"
            />
            <stop
              offset="100%"
              stopColor="currentColor"
              stopOpacity="0"
              className="text-primary"
            />
          </linearGradient>
        </defs>
        <polygon
          points={`${pts[0].x},${H} ${polyline} ${pts[pts.length - 1].x},${H}`}
          fill="url(#areaGrad)"
        />
        <polyline
          points={polyline}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary"
        />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="3"
            fill="currentColor"
            className="text-primary"
          />
        ))}
      </svg>

      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{formatDateShort(data[0].date)}</span>
        <span>{formatDateShort(data[data.length - 1].date)}</span>
      </div>
    </div>
  );
}
