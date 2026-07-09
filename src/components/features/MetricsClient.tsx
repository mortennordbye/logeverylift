"use client";

import {
  getCycleMetrics,
  getExerciseProgress,
  type CardioMetrics,
  type CycleMetrics,
  type CyclePickerItem,
  type ExerciseProgress,
  type HeatmapDay,
  type MoodDistribution,
  type MovementPatternBalance,
  type MuscleBalance,
  type PersonalRecord,
  type ReadinessPerformancePoint,
  type RpeTrendPoint,
  type SummaryStats,
  type TopProgressingExercise,
  type TriathlonMetrics,
  type DisciplineMetric,
  type WeeklyMetric,
  type WeeklyMuscleVolume,
} from "@/lib/actions/metrics";
import {
  deleteWeightEntry,
  logWeightEntry,
  type WeightEntry,
} from "@/lib/actions/profile";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { estimate1RM } from "@/lib/utils/progression";
import {
  formatEnduranceDistance,
  formatEndurancePace,
  formatDuration,
  sanitizeDecimalInput,
} from "@/lib/utils/format";
import { Activity, ChevronLeft, ChevronRight, Plus, TrendingUp, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

// ── Formatters ─────────────────────────────────────────────────────────────

const MUSCLE_LABELS: Record<string, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  abs: "Abs",
  lower_back: "Lower Back",
  full_body: "Full Body",
  cardio: "Cardio",
};

function formatWeekLabel(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatDateShort(date: string): string {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatVolume(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}t`;
  return `${Math.round(kg)} kg`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-3">
      {children}
    </h2>
  );
}

function SummaryStatsRow({ stats }: { stats: SummaryStats }) {
  const cards = [
    {
      label: "Sessions",
      value: stats.totalSessions.toLocaleString(),
    },
    {
      label: "Week streak",
      value: stats.currentStreakWeeks === 0 ? "–" : `${stats.currentStreakWeeks}w`,
    },
    {
      label: "Avg. session",
      value:
        stats.avgSessionDurationMinutes < 1
          ? "–"
          : `${Math.round(stats.avgSessionDurationMinutes)}m`,
    },
    {
      label: "Total volume",
      value: formatVolume(stats.lifetimeVolumeKg),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-2xl bg-muted p-4 flex flex-col gap-2"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {card.label}
          </span>
          <span className="text-2xl font-bold tabular-nums">{card.value}</span>
        </div>
      ))}
    </div>
  );
}

function WeeklyChart({ data, label }: { data: WeeklyMetric[]; label?: string }) {
  const maxVolume = Math.max(...data.map((w) => w.volumeKg), 1);
  const totalVolume = data.reduce((s, w) => s + w.volumeKg, 0);
  const totalSessions = data.reduce((s, w) => s + w.sessionCount, 0);

  return (
    <div className="rounded-2xl bg-muted p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <SectionLabel>{label ?? "Volume · Last 8 weeks"}</SectionLabel>
        <div className="text-xs text-muted-foreground">
          {totalSessions} sessions
        </div>
      </div>

      <div className="text-2xl font-bold">{formatVolume(totalVolume)}</div>

      {/* Bar chart */}
      <div className="flex items-end gap-1 h-20">
        {data.map((week) => {
          const pct = maxVolume > 0 ? (week.volumeKg / maxVolume) * 100 : 0;
          return (
            <div
              key={week.weekStart}
              className="flex-1 flex flex-col items-center justify-end gap-1"
            >
              <div className="w-full relative flex flex-col justify-end" style={{ height: "60px" }}>
                {week.sessionCount > 0 && (
                  <div
                    className="w-full bg-primary/80 rounded-t-sm"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                  />
                )}
              </div>
              <span className="text-[9px] text-muted-foreground leading-none">
                {formatWeekLabel(week.weekStart)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Session dots */}
      <div className="flex gap-1">
        {data.map((week) => (
          <div key={week.weekStart} className="flex-1 flex justify-center">
            {week.sessionCount > 0 ? (
              <span className="text-[10px] font-medium text-primary">
                {week.sessionCount}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground/30">–</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklyVolumeSection({ data }: { data: WeeklyMuscleVolume[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-2xl bg-muted p-4">
        <SectionLabel>This Week · Volume vs Target</SectionLabel>
        <p className="text-sm text-muted-foreground">No sets logged yet this week.</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-muted p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <SectionLabel>This Week · Volume vs Target</SectionLabel>
        <span className="text-xs text-muted-foreground">10–20 sets/muscle</span>
      </div>
      <div className="space-y-2">
        {data.map((row) => {
          // Visualise against an upper bound 25 % over targetMax so the bar
          // can show "over-trained" without saturating.
          const visualMax = row.targetMax * 1.25;
          const pct = Math.min(100, (row.setCount / visualMax) * 100);
          const status: "under" | "in" | "over" =
            row.setCount < row.targetMin
              ? "under"
              : row.setCount > row.targetMax
              ? "over"
              : "in";
          const barColor =
            status === "in"
              ? "bg-primary"
              : status === "over"
              ? "bg-rose-400"
              : "bg-amber-400";
          const statusLabel =
            status === "in"
              ? "in range"
              : status === "over"
              ? "over"
              : "under";
          return (
            <div key={row.muscleGroup} className="space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  {MUSCLE_LABELS[row.muscleGroup] ?? row.muscleGroup}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {row.setCount} / {row.targetMin}–{row.targetMax} ·{" "}
                  <span
                    className={
                      status === "in"
                        ? "text-primary"
                        : status === "over"
                        ? "text-rose-500"
                        : "text-amber-500"
                    }
                  >
                    {statusLabel}
                  </span>
                </span>
              </div>
              <div className="h-1.5 bg-border rounded-full overflow-hidden relative">
                {/* target band: from min/visualMax → max/visualMax */}
                <div
                  className="absolute top-0 bottom-0 bg-primary/15"
                  style={{
                    left: `${(row.targetMin / visualMax) * 100}%`,
                    width: `${((row.targetMax - row.targetMin) / visualMax) * 100}%`,
                  }}
                />
                <div
                  className={`relative h-full ${barColor} rounded-full`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MuscleBalanceSection({ data }: { data: MuscleBalance[] }) {
  const max = Math.max(...data.map((d) => d.setCount), 1);
  const totalSets = data.reduce((s, d) => s + d.setCount, 0);

  if (data.length === 0) {
    return (
      <div className="rounded-2xl bg-muted p-4">
        <SectionLabel>Muscle Balance</SectionLabel>
        <p className="text-sm text-muted-foreground">No workouts logged yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-muted p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <SectionLabel>Muscle Balance</SectionLabel>
        <span className="text-xs text-muted-foreground">{totalSets} {totalSets === 1 ? "set" : "sets"}</span>
      </div>

      <div className="space-y-2">
        {data.map((row) => {
          const pct = (row.setCount / max) * 100;
          return (
            <div key={row.muscleGroup} className="space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  {MUSCLE_LABELS[row.muscleGroup] ?? row.muscleGroup}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.setCount} {row.setCount === 1 ? "set" : "sets"}
                </span>
              </div>
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MOOD_CONFIG: { key: "Awesome" | "Good" | "OK" | "Tired"; color: string; label: string }[] = [
  { key: "Awesome", color: "bg-green-500", label: "Awesome" },
  { key: "Good", color: "bg-emerald-400", label: "Good" },
  { key: "OK", color: "bg-yellow-400", label: "OK" },
  { key: "Tired", color: "bg-rose-400", label: "Tired" },
];

function MoodDistributionSection({ data }: { data: MoodDistribution[] }) {
  if (data.length === 0) return null;

  const total = data.reduce((s, d) => s + d.count, 0);
  const byKey = new Map(data.map((d) => [d.feeling, d.count]));

  return (
    <div className="rounded-2xl bg-muted p-4 space-y-3">
      <SectionLabel>Session Mood</SectionLabel>

      {/* Segmented bar */}
      <div className="flex h-3 rounded-full overflow-hidden gap-px">
        {MOOD_CONFIG.map(({ key, color }) => {
          const count = byKey.get(key) ?? 0;
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <div
              key={key}
              className={`${color}`}
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-1">
        {MOOD_CONFIG.map(({ key, color, label }) => {
          const count = byKey.get(key) ?? 0;
          if (count === 0) return null;
          return (
            <div key={key} className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${color} flex-none`} />
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className="text-xs font-medium ml-auto">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopProgressingSection({ data }: { data: TopProgressingExercise[] }) {
  if (data.length === 0) return null;

  return (
    <div className="rounded-2xl bg-muted p-4 space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel>Top Gains</SectionLabel>
        <Zap className="w-4 h-4 text-muted-foreground flex-none" />
      </div>
      <div className="divide-y divide-border -mx-1">
        {data.map((ex, i) => (
          <div
            key={ex.exerciseId}
            className="flex items-center gap-3 px-1 py-3 min-h-[44px]"
          >
            <span className="w-5 text-xs text-muted-foreground text-center flex-none">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{ex.exerciseName}</div>
              <div className="text-xs text-muted-foreground">
                {ex.baseline1RM} → {ex.current1RM} kg est. 1RM
              </div>
            </div>
            <div className="text-right flex-none">
              <div className="text-sm font-semibold text-green-600 dark:text-green-400">
                +{ex.gainPct}%
              </div>
              <div className="text-xs text-muted-foreground">+{ex.gainKg} kg</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type ChartMode = "weight" | "oneRM" | "volume";

function ProgressChart({ data }: { data: ExerciseProgress[] }) {
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

// ── Weight History ─────────────────────────────────────────────────────────

function WeightHistorySection({
  initialEntries,
  profileWeightKg,
}: {
  initialEntries: WeightEntry[];
  profileWeightKg: number | null;
}) {
  const [entries, setEntries] = useState<WeightEntry[]>(initialEntries);
  const [showLogSheet, setShowLogSheet] = useState(false);
  const [weightInput, setWeightInput] = useState("");
  const [logStatus, setLogStatus] = useState<"idle" | "saving" | "error">("idle");
  const [logError, setLogError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const sorted = [...entries].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );

  async function handleLog() {
    const kg = parseFloat(weightInput);
    if (isNaN(kg) || kg <= 0) {
      setLogError("Enter a valid weight.");
      return;
    }
    setLogStatus("saving");
    setLogError(null);
    const result = await logWeightEntry({ weightKg: kg });
    if (result.success) {
      setEntries((prev) => [...prev, result.data]);
      setWeightInput("");
      setLogStatus("idle");
      setShowLogSheet(false);
    } else {
      setLogStatus("error");
      setLogError(result.error);
    }
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteWeightEntry(id);
      if (result.success) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
      }
    });
  }

  const latest = sorted[sorted.length - 1];
  const first = sorted[0];

  // SVG line chart
  const W = 280;
  const H = 56;
  const PAD = 8;

  let chart: React.ReactNode = null;
  if (sorted.length >= 2) {
    const yValues = sorted.map((e) => e.weightKg);
    const max = Math.max(...yValues);
    const min = Math.min(...yValues);
    const range = max - min || 1;
    const pts = yValues.map((v, i) => ({
      x: PAD + (i / (sorted.length - 1)) * (W - 2 * PAD),
      y: H - PAD - ((v - min) / range) * (H - 2 * PAD),
    }));
    const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
    const delta = (latest?.weightKg ?? 0) - (first?.weightKg ?? 0);

    chart = (
      <div className="space-y-2">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold">{latest?.weightKg} kg</span>
          {delta !== 0 && (
            <span
              className={`text-sm font-medium ${
                delta < 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
              }`}
            >
              {delta > 0 ? "+" : ""}
              {delta.toFixed(1)} kg
            </span>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {sorted.length} entries
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14">
          <defs>
            <linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" className="text-primary" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" className="text-primary" />
            </linearGradient>
          </defs>
          <polygon
            points={`${pts[0].x},${H} ${polyline} ${pts[pts.length - 1].x},${H}`}
            fill="url(#weightGrad)"
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
            <circle key={i} cx={p.x} cy={p.y} r="3" fill="currentColor" className="text-primary" />
          ))}
        </svg>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{formatDateShort(first!.recordedAt.slice(0, 10))}</span>
          <span>{formatDateShort(latest!.recordedAt.slice(0, 10))}</span>
        </div>
      </div>
    );
  } else if (latest) {
    chart = (
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold">{latest.weightKg} kg</span>
        <span className="text-xs text-muted-foreground">
          {formatDateShort(latest.recordedAt.slice(0, 10))}
        </span>
      </div>
    );
  }

  // Show last 10 entries newest-first for the delete list
  const recentEntries = [...sorted].reverse().slice(0, 10);

  return (
    <>
      <div className="rounded-2xl bg-muted p-4 space-y-3">
        <div className="flex items-center justify-between">
          <SectionLabel>Body Weight</SectionLabel>
          <button
            onClick={() => setShowLogSheet(true)}
            className="flex items-center gap-1 text-primary text-xs font-medium min-h-[36px] active:opacity-70"
          >
            <Plus className="w-3.5 h-3.5" />
            Log
          </button>
        </div>

        {entries.length === 0 ? (
          profileWeightKg != null ? (
            <div className="space-y-1">
              <div className="text-2xl font-bold">{profileWeightKg} kg</div>
              <p className="text-xs text-muted-foreground">
                From your profile · log a new entry to start tracking trends
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No weight logged yet.</p>
          )
        ) : (
          chart
        )}

        {recentEntries.length > 0 && (
          <div className="divide-y divide-border -mx-1 pt-1">
            {recentEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 px-1 py-2.5 min-h-[44px]"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{entry.weightKg} kg</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {formatDateShort(entry.recordedAt.slice(0, 10))}
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(entry.id)}
                  disabled={isPending}
                  className="p-2 text-muted-foreground active:text-destructive active:opacity-70 disabled:opacity-40"
                  aria-label="Delete entry"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomSheet open={showLogSheet} onClose={() => { setShowLogSheet(false); setLogStatus("idle"); setLogError(null); }} blur>
        <div className="bg-background rounded-t-2xl flex flex-col" style={{ maxHeight: "60dvh" }}>
          <div className="flex items-center justify-between px-4 pt-5 pb-4 shrink-0">
            <h2 className="text-lg font-semibold">Log Weight</h2>
            <button
              onClick={() => { setShowLogSheet(false); setLogStatus("idle"); setLogError(null); }}
              className="text-primary text-sm font-medium min-h-[44px] px-1"
            >
              Cancel
            </button>
          </div>
          <div className="flex flex-col gap-4 px-4 pb-10">
            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode="decimal"
                placeholder="80.0"
                value={weightInput}
                onChange={(e) => { setWeightInput(sanitizeDecimalInput(e.target.value)); setLogError(null); }}
                className="flex-1 rounded-xl bg-muted px-4 py-3.5 text-sm outline-none focus:ring-2 ring-primary"
              />
              <span className="text-sm text-muted-foreground w-6">kg</span>
            </div>
            {logError && <p className="text-sm text-destructive">{logError}</p>}
            <button
              onClick={handleLog}
              disabled={logStatus === "saving" || !weightInput}
              className="w-full rounded-xl bg-primary py-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:opacity-80"
            >
              {logStatus === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}

// ── Cardio Section ─────────────────────────────────────────────────────────

function formatPaceDisplay(secPerKm: number): string {
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${String(secs).padStart(2, "0")} /km`;
}

function formatDistanceDisplay(meters: number): string {
  if (meters === 0) return "0 km";
  if (meters < 1000) return `${meters} m`;
  const km = meters / 1000;
  return km % 1 === 0 ? `${km} km` : `${km.toFixed(1)} km`;
}

const HR_ZONE_COLORS = ["bg-blue-400", "bg-green-400", "bg-yellow-400", "bg-orange-400", "bg-red-500"];

function CardioSection({ data }: { data: CardioMetrics }) {
  const hasAnyData = data.totalSessions > 0;

  if (!hasAnyData) {
    return (
      <div className="rounded-2xl bg-muted p-4 space-y-2">
        <SectionLabel>Cardio</SectionLabel>
        <p className="text-sm text-muted-foreground">No runs logged yet.</p>
      </div>
    );
  }

  const summaryCards = [
    { label: "Total distance", value: formatDistanceDisplay(data.totalDistanceM) },
    { label: "Cardio sessions", value: String(data.totalSessions) },
    { label: "Longest run", value: formatDistanceDisplay(data.longestSingleRunM) },
    { label: "Best pace", value: data.bestPaceSecPerKm ? formatPaceDisplay(data.bestPaceSecPerKm) : "–" },
  ];

  // Weekly distance chart
  const maxDist = Math.max(...data.weekly.map((w) => w.distanceM), 1);
  const totalWeeklyDist = data.weekly.reduce((s, w) => s + w.distanceM, 0);

  // HR zones
  const totalHrDist = data.hrZones.reduce((s, z) => s + z.distanceM, 0);

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="rounded-2xl bg-muted p-4 space-y-3">
        <SectionLabel>Cardio</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-xl bg-background/50 p-3 flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {card.label}
              </span>
              <span className="text-xl font-bold tabular-nums">{card.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Weekly distance chart */}
      <div className="rounded-2xl bg-muted p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <SectionLabel>Distance · Last 8 weeks</SectionLabel>
          <span className="text-xs text-muted-foreground">{formatDistanceDisplay(totalWeeklyDist)}</span>
        </div>

        <div className="flex items-end gap-1 h-20">
          {data.weekly.map((week) => {
            const pct = maxDist > 0 ? (week.distanceM / maxDist) * 100 : 0;
            return (
              <div
                key={week.weekStart}
                className="flex-1 flex flex-col items-center justify-end gap-1"
              >
                <div className="w-full relative flex flex-col justify-end" style={{ height: "60px" }}>
                  {week.distanceM > 0 && (
                    <div
                      className="w-full bg-primary/80 rounded-t-sm"
                      style={{ height: `${Math.max(pct, 4)}%` }}
                    />
                  )}
                </div>
                <span className="text-[9px] text-muted-foreground leading-none">
                  {formatWeekLabel(week.weekStart)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Distance labels row */}
        <div className="flex gap-1">
          {data.weekly.map((week) => (
            <div key={week.weekStart} className="flex-1 flex justify-center">
              {week.distanceM > 0 ? (
                <span className="text-[9px] font-medium text-primary">
                  {(week.distanceM / 1000).toFixed(1)}
                </span>
              ) : (
                <span className="text-[9px] text-muted-foreground/30">–</span>
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground text-center">km per week</p>
      </div>

      {/* Pace PRs */}
      {data.paceRecords.length > 0 && (
        <div className="rounded-2xl bg-muted p-4 space-y-3">
          <div className="flex items-center justify-between">
            <SectionLabel>Pace Records</SectionLabel>
            <TrendingUp className="w-4 h-4 text-muted-foreground flex-none" />
          </div>
          <div className="divide-y divide-border -mx-1">
            {data.paceRecords.map((pr) => (
              <div
                key={pr.label}
                className="flex items-center gap-3 px-1 py-2.5 min-h-[44px]"
              >
                <div className="w-12 flex-none">
                  <span className="text-sm font-semibold">{pr.label}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{formatPaceDisplay(pr.bestPaceSecPerKm)}</div>
                  <div className="text-xs text-muted-foreground truncate">{pr.exerciseName}</div>
                </div>
                <span className="text-xs text-muted-foreground flex-none">
                  {formatDateShort(pr.date)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HR Zone distribution */}
      {data.hrZones.length > 0 && (
        <div className="rounded-2xl bg-muted p-4 space-y-3">
          <SectionLabel>Heart Rate Zones</SectionLabel>

          {/* Segmented bar */}
          <div className="flex h-3 rounded-full overflow-hidden gap-px">
            {data.hrZones.map((z) => {
              const pct = totalHrDist > 0 ? (z.distanceM / totalHrDist) * 100 : 0;
              return (
                <div
                  key={z.zone}
                  className={HR_ZONE_COLORS[z.zone - 1]}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
          </div>

          {/* Legend */}
          <div className="space-y-2">
            {data.hrZones.map((z) => {
              const pct = totalHrDist > 0 ? Math.round((z.distanceM / totalHrDist) * 100) : 0;
              return (
                <div key={z.zone} className="flex items-center gap-2 min-h-[28px]">
                  <div className={`w-2.5 h-2.5 rounded-full ${HR_ZONE_COLORS[z.zone - 1]} flex-none`} />
                  <span className="text-xs font-medium flex-none w-24">{z.label}</span>
                  <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                    <div
                      className={`h-full ${HR_ZONE_COLORS[z.zone - 1]} rounded-full`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground flex-none w-12 text-right">
                    {formatDistanceDisplay(z.distanceM)}
                  </span>
                  <span className="text-xs text-muted-foreground flex-none w-8 text-right">
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">Based on logged HR zones</p>
        </div>
      )}
    </div>
  );
}

// ── Triathlon Section ───────────────────────────────────────────────────────

function DisciplineCard({ d }: { d: DisciplineMetric }) {
  const maxDist = Math.max(...d.weekly.map((w) => w.distanceM), 1);

  return (
    <div className="rounded-2xl bg-muted p-4 space-y-3">
      <SectionLabel>{d.label}</SectionLabel>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-background/50 p-3 flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Distance</span>
          <span className="text-lg font-bold tabular-nums">{formatEnduranceDistance(d.inputUnit, d.totalDistanceM)}</span>
        </div>
        <div className="rounded-xl bg-background/50 p-3 flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Time</span>
          <span className="text-lg font-bold tabular-nums">{formatDuration(Math.round(d.totalDurationS / 60))}</span>
        </div>
        <div className="rounded-xl bg-background/50 p-3 flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sessions</span>
          <span className="text-lg font-bold tabular-nums">{d.totalSessions}</span>
        </div>
      </div>

      {/* Weekly distance — last 8 weeks */}
      <div className="flex items-end gap-1 h-16">
        {d.weekly.map((week) => {
          const pct = maxDist > 0 ? (week.distanceM / maxDist) * 100 : 0;
          return (
            <div key={week.weekStart} className="flex-1 flex flex-col items-center justify-end gap-1">
              <div className="w-full relative flex flex-col justify-end" style={{ height: "48px" }}>
                {week.distanceM > 0 && (
                  <div className="w-full bg-primary/80 rounded-t-sm" style={{ height: `${Math.max(pct, 4)}%` }} />
                )}
              </div>
              <span className="text-[9px] text-muted-foreground leading-none">{formatWeekLabel(week.weekStart)}</span>
            </div>
          );
        })}
      </div>

      {/* Best pace/speed per bracket */}
      {d.paceRecords.length > 0 && (
        <div className="divide-y divide-border -mx-1">
          {d.paceRecords.map((pr) => (
            <div key={pr.label} className="flex items-center gap-3 px-1 py-2 min-h-[40px]">
              <span className="text-sm font-semibold w-16 flex-none">{pr.label}</span>
              <span className="flex-1 text-sm font-medium">
                {formatEndurancePace(d.paceFormatter, pr.bestDurationS, pr.bestDistanceM)}
              </span>
              <span className="text-xs text-muted-foreground flex-none">{formatDateShort(pr.date)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TriathlonSection({ data }: { data: TriathlonMetrics }) {
  return (
    <div className="space-y-4">
      <SectionLabel>Triathlon</SectionLabel>
      {data.disciplines.map((d) => (
        <DisciplineCard key={d.discipline} d={d} />
      ))}
    </div>
  );
}

// ── Year Heatmap ───────────────────────────────────────────────────────────

function YearHeatmapSection({ data }: { data: HeatmapDay[] }) {
  const byDate = new Map(data.map((d) => [d.date, d]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + diff);

  const startMonday = new Date(thisMonday);
  startMonday.setDate(thisMonday.getDate() - 51 * 7);

  const weeks: string[][] = [];
  for (let w = 0; w < 52; w++) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(startMonday);
      date.setDate(startMonday.getDate() + w * 7 + d);
      if (date <= today) {
        week.push(date.toISOString().split("T")[0]);
      } else {
        week.push("");
      }
    }
    weeks.push(week);
  }

  const maxVol = Math.max(...data.map((d) => d.volumeKg), 1);

  function cellColor(date: string): string {
    if (!date) return "bg-transparent";
    const d = byDate.get(date);
    if (!d || d.sessionCount === 0) return "bg-border/40";
    const intensity = d.volumeKg / maxVol;
    if (intensity > 0.75) return "bg-primary";
    if (intensity > 0.4)  return "bg-primary/70";
    if (intensity > 0.1)  return "bg-primary/40";
    return "bg-primary/20";
  }

  const totalSessions = data.reduce((s, d) => s + d.sessionCount, 0);
  const activeDays = data.filter((d) => d.sessionCount > 0).length;

  return (
    <div className="rounded-2xl bg-muted p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <SectionLabel>Activity · Last 12 Months</SectionLabel>
        <span className="text-xs text-muted-foreground">{totalSessions} sessions</span>
      </div>
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((date, di) => (
              <div key={di} className={`w-[10px] h-[10px] rounded-[2px] shrink-0 ${cellColor(date)}`} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{activeDays} active days</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Less</span>
          {(["bg-border/40", "bg-primary/20", "bg-primary/40", "bg-primary/70", "bg-primary"] as const).map((c, i) => (
            <div key={i} className={`w-2 h-2 rounded-[2px] ${c}`} />
          ))}
          <span className="text-[10px] text-muted-foreground">More</span>
        </div>
      </div>
    </div>
  );
}

// ── Movement Pattern Balance ────────────────────────────────────────────────

const MOVEMENT_LABELS: Record<string, string> = {
  push:      "Push",
  pull:      "Pull",
  hinge:     "Hinge",
  squat:     "Squat",
  carry:     "Carry",
  rotation:  "Rotation",
  isometric: "Isometric",
  cardio:    "Cardio",
};

const MOVEMENT_COLORS: Record<string, string> = {
  push:      "bg-blue-500",
  pull:      "bg-emerald-500",
  hinge:     "bg-orange-500",
  squat:     "bg-violet-500",
  carry:     "bg-yellow-500",
  rotation:  "bg-pink-500",
  isometric: "bg-cyan-500",
  cardio:    "bg-red-500",
};

function MovementPatternSection({ data }: { data: MovementPatternBalance[] }) {
  if (data.length === 0) return null;

  const total = data.reduce((s, d) => s + d.setCount, 0);
  const maxSets = Math.max(...data.map((d) => d.setCount), 1);
  const pushSets = data.find((d) => d.pattern === "push")?.setCount ?? 0;
  const pullSets = data.find((d) => d.pattern === "pull")?.setCount ?? 0;

  return (
    <div className="rounded-2xl bg-muted p-4 space-y-3">
      <SectionLabel>Movement Balance · Last 28 days</SectionLabel>
      <div className="space-y-2.5">
        {data.map((d) => {
          const pct = Math.round((d.setCount / total) * 100);
          const barPct = (d.setCount / maxSets) * 100;
          const color = MOVEMENT_COLORS[d.pattern] ?? "bg-primary";
          return (
            <div key={d.pattern} className="flex items-center gap-2">
              <span className="text-xs font-medium w-16 shrink-0">
                {MOVEMENT_LABELS[d.pattern] ?? d.pattern}
              </span>
              <div className="flex-1 h-1.5 bg-border/40 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full`} style={{ width: `${barPct}%` }} />
              </div>
              <span className="text-xs text-muted-foreground w-7 text-right shrink-0">{pct}%</span>
              <span className="text-[10px] text-muted-foreground w-12 text-right shrink-0">{d.setCount} sets</span>
            </div>
          );
        })}
      </div>
      {pushSets > 0 && pullSets > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Push:Pull {Math.round((pushSets / pullSets) * 10) / 10}:1
          {pushSets / pullSets > 1.3
            ? " · consider adding more pull work"
            : pushSets / pullSets < 0.7
            ? " · consider adding more push work"
            : " · well balanced"}
        </p>
      )}
    </div>
  );
}

// ── Readiness vs Performance ────────────────────────────────────────────────

const READINESS_LABELS = ["", "Very Low", "Low", "Moderate", "High", "Peak"];
const READINESS_COLORS = ["", "bg-red-500", "bg-orange-400", "bg-yellow-400", "bg-emerald-400", "bg-emerald-500"];

function ReadinessPerformanceSection({ data }: { data: ReadinessPerformancePoint[] }) {
  if (data.length === 0) return null;

  const maxVol = Math.max(...data.map((d) => d.avgVolumeKg), 1);

  return (
    <div className="rounded-2xl bg-muted p-4 space-y-3">
      <SectionLabel>Readiness vs Output</SectionLabel>
      <div className="flex items-end gap-2" style={{ height: "80px" }}>
        {[1, 2, 3, 4, 5].map((level) => {
          const point = data.find((d) => d.readiness === level);
          const pct = point ? (point.avgVolumeKg / maxVol) * 100 : 0;
          const color = READINESS_COLORS[level];
          return (
            <div key={level} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
              <div className="w-full relative flex-1">
                {point ? (
                  <div
                    className={`absolute bottom-0 w-full ${color} rounded-t-md`}
                    style={{ height: `${Math.max(pct, 4)}%` }}
                  />
                ) : (
                  <div className="absolute bottom-0 w-full h-px bg-border/30" />
                )}
              </div>
              <span className="text-[10px] text-muted-foreground leading-none shrink-0">{level}</span>
            </div>
          );
        })}
      </div>
      <div className="space-y-1.5">
        {data.map((d) => (
          <div key={d.readiness} className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${READINESS_COLORS[d.readiness]} shrink-0`} />
            <span className="text-xs text-muted-foreground">{READINESS_LABELS[d.readiness]}</span>
            <span className="text-xs font-medium ml-auto">{formatVolume(d.avgVolumeKg)} avg</span>
            <span className="text-[10px] text-muted-foreground">{d.sessionCount}× </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">
        Avg volume per session by pre-workout readiness (1–5)
      </p>
    </div>
  );
}

// ── Cycle Tab Components ───────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  draft: "Draft",
};

const STATUS_COLORS: Record<string, string> = {
  active: "text-green-600 dark:text-green-400",
  completed: "text-muted-foreground",
  draft: "text-yellow-600 dark:text-yellow-400",
};

function CyclePicker({
  cycles,
  selectedId,
  onSelect,
}: {
  cycles: CyclePickerItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  if (cycles.length === 0) {
    return (
      <div className="rounded-2xl bg-muted p-4">
        <p className="text-sm text-muted-foreground">No training cycles yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <SectionLabel>Select Cycle</SectionLabel>
      {cycles.map((cycle) => {
        const isSelected = cycle.id === selectedId;
        const dateRange =
          cycle.startDate && cycle.endDate
            ? `${formatDateShort(cycle.startDate)} – ${formatDateShort(cycle.endDate)}`
            : "No start date set";
        return (
          <button
            key={cycle.id}
            onClick={() => cycle.startDate ? onSelect(cycle.id) : undefined}
            disabled={!cycle.startDate}
            className={`w-full rounded-2xl p-4 text-left transition-colors min-h-[44px] ${
              isSelected
                ? "bg-primary/10 ring-1 ring-primary"
                : "bg-muted active:bg-muted/70"
            } disabled:opacity-50`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{cycle.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{dateRange}</div>
              </div>
              <div className="text-right flex-none space-y-0.5">
                <div className={`text-xs font-medium ${STATUS_COLORS[cycle.status]}`}>
                  {STATUS_LABELS[cycle.status]}
                </div>
                <div className="text-xs text-muted-foreground">
                  {cycle.sessionCount} sessions
                </div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {cycle.durationWeeks}w
            </div>
          </button>
        );
      })}
    </div>
  );
}

function RpeTrendChart({ data }: { data: RpeTrendPoint[] }) {
  const pointsWithData = data.filter((d) => d.avgRpe !== null);

  if (pointsWithData.length === 0) {
    return (
      <div className="rounded-2xl bg-muted p-4 space-y-3">
        <div className="flex items-center justify-between">
          <SectionLabel>RPE Trend</SectionLabel>
          <Activity className="w-4 h-4 text-muted-foreground flex-none" />
        </div>
        <p className="text-sm text-muted-foreground">No RPE data recorded yet.</p>
      </div>
    );
  }

  const W = 280;
  const H = 56;
  const PAD = 8;

  const nonNullValues = pointsWithData.map((d) => d.avgRpe as number);
  const dataMin = Math.max(4, Math.min(...nonNullValues) - 0.5);
  const dataMax = Math.min(10, Math.max(...nonNullValues) + 0.5);
  const range = dataMax - dataMin || 1;

  const pts = data.map((d, i) => ({
    x: PAD + (i / Math.max(data.length - 1, 1)) * (W - 2 * PAD),
    y: d.avgRpe !== null
      ? H - PAD - ((d.avgRpe - dataMin) / range) * (H - 2 * PAD)
      : null,
  }));

  // Build connected polyline segments, skipping null gaps
  const segments: string[][] = [];
  let current: string[] = [];
  for (const pt of pts) {
    if (pt.y !== null) {
      current.push(`${pt.x},${pt.y}`);
    } else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);

  const latestRpe = nonNullValues[nonNullValues.length - 1];
  const firstRpe = nonNullValues[0];
  const trend = Math.round((latestRpe - firstRpe) * 10) / 10;

  return (
    <div className="rounded-2xl bg-muted p-4 space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel>RPE Trend</SectionLabel>
        <Activity className="w-4 h-4 text-muted-foreground flex-none" />
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold">{latestRpe.toFixed(1)}</span>
        <span className="text-xs text-muted-foreground">avg RPE</span>
        {trend !== 0 && (
          <span className={`text-sm font-medium ml-auto ${
            trend > 0 ? "text-rose-500" : "text-green-600 dark:text-green-400"
          }`}>
            {trend > 0 ? "+" : ""}{trend.toFixed(1)}
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14">
        <defs>
          <linearGradient id="rpeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" className="text-primary" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" className="text-primary" />
          </linearGradient>
        </defs>
        {segments.map((seg, i) => (
          <polyline
            key={i}
            points={seg.join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-primary"
          />
        ))}
        {pts.map((p, i) =>
          p.y !== null ? (
            <circle key={i} cx={p.x} cy={p.y} r="3" fill="currentColor" className="text-primary" />
          ) : null,
        )}
      </svg>

      {/* Week labels row */}
      <div className="flex gap-1">
        {data.map((d) => (
          <div key={d.weekIndex} className="flex-1 flex flex-col items-center gap-0.5">
            {d.avgRpe !== null ? (
              <span className="text-[9px] font-medium text-primary leading-none">{d.avgRpe.toFixed(1)}</span>
            ) : (
              <span className="text-[9px] text-muted-foreground/30 leading-none">–</span>
            )}
            <span className="text-[9px] text-muted-foreground leading-none">W{d.weekIndex}</span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Higher RPE = more effort. A rising trend may signal accumulated fatigue.
      </p>
    </div>
  );
}

function CycleMetricsView({ metrics }: { metrics: CycleMetrics }) {
  const cycleStats = [
    { label: "Sessions", value: String(metrics.summary.sessionCount) },
    { label: "Total volume", value: formatVolume(metrics.summary.totalVolumeKg) },
    {
      label: "Avg. session",
      value: metrics.summary.avgSessionDurationMinutes < 1
        ? "–"
        : `${Math.round(metrics.summary.avgSessionDurationMinutes)}m`,
    },
    {
      label: "Sessions/week",
      value: metrics.summary.sessionsPerWeek === 0
        ? "–"
        : String(metrics.summary.sessionsPerWeek),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-2">
        {cycleStats.map((card) => (
          <div key={card.label} className="rounded-2xl bg-muted p-4 flex flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {card.label}
            </span>
            <span className="text-2xl font-bold tabular-nums">{card.value}</span>
          </div>
        ))}
      </div>

      <WeeklyChart data={metrics.weekly} label="Volume · This Cycle" />
      <MuscleBalanceSection data={metrics.muscleBalance} />
      <MoodDistributionSection data={metrics.moodDistribution} />
      <TopProgressingSection data={metrics.topGains} />
      <RpeTrendChart data={metrics.rpeTrend} />
    </div>
  );
}

function CycleView({
  cycles,
  selectedCycleId,
  onSelectCycle,
  metrics,
  loading,
  error,
}: {
  cycles: CyclePickerItem[];
  selectedCycleId: number | null;
  onSelectCycle: (id: number) => void;
  metrics: CycleMetrics | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-4">
      <CyclePicker
        cycles={cycles}
        selectedId={selectedCycleId}
        onSelect={onSelectCycle}
      />

      {loading && (
        <div className="flex justify-center py-8">
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      )}

      {error && (
        <div className="rounded-2xl bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {!loading && !error && metrics && (
        <CycleMetricsView metrics={metrics} />
      )}

      {!loading && !error && !metrics && selectedCycleId && (
        <p className="text-sm text-muted-foreground text-center py-4">No data for this cycle.</p>
      )}

      {!selectedCycleId && cycles.length > 0 && (
        <p className="text-xs text-center text-muted-foreground pb-2">
          Select a cycle above to view its metrics
        </p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

type Tab = "alltime" | "cycle";

type Props = {
  weekly: WeeklyMetric[];
  personalRecords: PersonalRecord[];
  muscleBalance: MuscleBalance[];
  moodDistribution: MoodDistribution[];
  summaryStats: SummaryStats | null;
  topProgressing: TopProgressingExercise[];
  initialProgress: ExerciseProgress[];
  initialExerciseId: number | null;
  weightHistory: WeightEntry[];
  profileWeightKg: number | null;
  cycles: CyclePickerItem[];
  cardioMetrics: CardioMetrics | null;
  triathlonMetrics: TriathlonMetrics | null;
  heatmapData: HeatmapDay[];
  movementPatternData: MovementPatternBalance[];
  readinessData: ReadinessPerformancePoint[];
  weeklyMuscleVolume: WeeklyMuscleVolume[];
};

export function MetricsClient({
  weekly,
  personalRecords,
  muscleBalance,
  moodDistribution,
  summaryStats,
  topProgressing,
  initialProgress,
  initialExerciseId,
  weightHistory,
  profileWeightKg,
  cycles,
  cardioMetrics,
  triathlonMetrics,
  heatmapData,
  movementPatternData,
  readinessData,
  weeklyMuscleVolume,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("alltime");
  const [selectedId, setSelectedId] = useState<number | null>(initialExerciseId);
  const [progressData, setProgressData] = useState<ExerciseProgress[]>(initialProgress);
  const [isPending, startTransition] = useTransition();

  // Cycle tab state
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [cycleMetrics, setCycleMetrics] = useState<CycleMetrics | null>(null);
  const [cycleLoading, setCycleLoading] = useState(false);
  const [cycleError, setCycleError] = useState<string | null>(null);

  const selectedRecord = personalRecords.find((r) => r.exerciseId === selectedId);

  function selectExercise(exerciseId: number) {
    if (exerciseId === selectedId) return;
    setSelectedId(exerciseId);
    startTransition(async () => {
      const result = await getExerciseProgress(exerciseId);
      if (result.success) setProgressData(result.data);
    });
  }

  async function selectCycle(cycleId: number) {
    if (cycleId === selectedCycleId) return;
    setSelectedCycleId(cycleId);
    setCycleLoading(true);
    setCycleError(null);
    setCycleMetrics(null);
    const result = await getCycleMetrics(cycleId);
    if (result.success) {
      setCycleMetrics(result.data);
    } else {
      setCycleError(result.error);
    }
    setCycleLoading(false);
  }

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <Link
          href="/more"
          className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">More</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-3 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight mb-3">Metrics</h1>
        {/* Tab toggle */}
        <div className="flex bg-muted rounded-xl p-1 gap-1">
          {(["alltime", "cycle"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors min-h-[36px] ${
                activeTab === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {tab === "alltime" ? "All Time" : "Cycle"}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-nav-safe-lg">

        {activeTab === "alltime" ? (
          <>
            {/* ── Summary Stats ──────────────────────────────────────── */}
            {summaryStats && <SummaryStatsRow stats={summaryStats} />}

            {/* ── Activity Heatmap ───────────────────────────────────── */}
            <YearHeatmapSection data={heatmapData} />

            {/* ── Body Weight ────────────────────────────────────────── */}
            <WeightHistorySection initialEntries={weightHistory} profileWeightKg={profileWeightKg} />

            {/* ── Volume & Frequency ─────────────────────────────────── */}
            <WeeklyChart data={weekly} />

            {/* ── Triathlon (swim/bike/run) ──────────────────────────── */}
            {/* Shown once swim/bike/run sessions have been logged. */}
            {triathlonMetrics && triathlonMetrics.disciplines.length > 0 && (
              <TriathlonSection data={triathlonMetrics} />
            )}

            {/* ── Cardio ─────────────────────────────────────────────── */}
            {cardioMetrics && <CardioSection data={cardioMetrics} />}

            {/* ── Weekly Volume vs Target ─────────────────────────────── */}
            <WeeklyVolumeSection data={weeklyMuscleVolume} />

            {/* ── Muscle Balance ─────────────────────────────────────── */}
            <MuscleBalanceSection data={muscleBalance} />

            {/* ── Movement Pattern Balance ───────────────────────────── */}
            <MovementPatternSection data={movementPatternData} />

            {/* ── Session Mood ───────────────────────────────────────── */}
            <MoodDistributionSection data={moodDistribution} />

            {/* ── Readiness vs Performance ───────────────────────────── */}
            <ReadinessPerformanceSection data={readinessData} />

            {/* ── Top Gaining Exercises ──────────────────────────────── */}
            <TopProgressingSection data={topProgressing} />

            {/* ── Personal Records ───────────────────────────────────── */}
            <div className="rounded-2xl bg-muted p-4">
              <SectionLabel>Personal Records</SectionLabel>

              {personalRecords.length === 0 ? (
                <p className="text-sm text-muted-foreground">No lifts recorded yet.</p>
              ) : (
                <div className="divide-y divide-border -mx-1">
                  {personalRecords.map((pr, i) => {
                    const isSelected = pr.exerciseId === selectedId;
                    return (
                      <button
                        key={pr.exerciseId}
                        onClick={() => selectExercise(pr.exerciseId)}
                        className={`w-full flex items-center gap-3 px-1 py-2.5 text-left active:bg-background/50 transition-colors rounded-lg ${
                          isSelected ? "bg-background/70" : ""
                        }`}
                      >
                        <span className="w-5 text-xs text-muted-foreground text-center flex-none">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {pr.exerciseName}
                          </div>
                          {pr.muscleGroup && (
                            <div className="text-xs text-muted-foreground">
                              {MUSCLE_LABELS[pr.muscleGroup] ?? pr.muscleGroup}
                            </div>
                          )}
                        </div>
                        <span className="text-sm font-semibold tabular-nums flex-none">
                          {pr.maxWeightKg} kg
                        </span>
                        <ChevronRight
                          className={`w-3.5 h-3.5 flex-none transition-colors ${
                            isSelected ? "text-primary" : "text-muted-foreground/40"
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Exercise Progress ──────────────────────────────────── */}
            {selectedRecord && (
              <div className="rounded-2xl bg-muted p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <SectionLabel>Progress · {selectedRecord.exerciseName}</SectionLabel>
                  {isPending && (
                    <span className="text-xs text-muted-foreground">Loading…</span>
                  )}
                  <TrendingUp className="w-4 h-4 text-muted-foreground flex-none" />
                </div>
                {!isPending && (
                  <div key={selectedId}>
                    <ProgressChart data={progressData} />
                  </div>
                )}
              </div>
            )}

            {!selectedRecord && personalRecords.length > 0 && (
              <p className="text-xs text-center text-muted-foreground pb-2">
                Tap a record to see its progress chart
              </p>
            )}
          </>
        ) : (
          <CycleView
            cycles={cycles}
            selectedCycleId={selectedCycleId}
            onSelectCycle={selectCycle}
            metrics={cycleMetrics}
            loading={cycleLoading}
            error={cycleError}
          />
        )}
      </main>
    </div>
  );
}
