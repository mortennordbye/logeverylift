/**
 * Today's program as the Today widget shows it (owner decision A,
 * 2026-11-14; docs/home-widgets-audit.md, section 12): how many exercises and
 * working sets, about how long, and the first exercises with their sets.
 * Pure: the rows come from one read in src/lib/home/core.ts.
 */

import { estimateSessionMinutes } from "@/lib/utils/plan-templates";

/** One row of the read: a program exercise and one of its sets (null for an exercise with no sets). */
export type PlanRow = {
  programExerciseId: number;
  name: string;
  setType: string | null;
  targetReps: number | null;
  repRangeMin: number | null;
  repRangeMax: number | null;
  weightKg: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  restTimeSeconds: number | null;
};

export type TodayPlan = {
  exerciseCount: number;
  /** Working sets, warm-ups left out. */
  setCount: number;
  /** Rounded to 5 minutes, at least 5. */
  minutes: number;
  /** The first `shown` exercises: name and "4 × 6–8 · 80 kg". */
  exercises: { name: string; sets: string }[];
  /** The names after those. */
  more: string[];
};

const num = (n: number) => String(Number(n.toFixed(2)));

/** "6–8", "8", "45 s", "5 km": the first working set's target. */
function target(s: PlanRow): string | null {
  if (s.repRangeMin != null && s.repRangeMax != null && s.repRangeMin !== s.repRangeMax) return `${s.repRangeMin}–${s.repRangeMax}`;
  if (s.targetReps != null) return String(s.targetReps);
  if (s.durationSeconds != null) return s.durationSeconds >= 60 && s.durationSeconds % 60 === 0 ? `${s.durationSeconds / 60} min` : `${s.durationSeconds} s`;
  if (s.distanceMeters != null) return s.distanceMeters >= 1000 ? `${num(s.distanceMeters / 1000)} km` : `${s.distanceMeters} m`;
  return null;
}

/** Rows in program order (exercise order, then set number). Null when the program has no exercises. */
export function todayPlanFrom(rows: PlanRow[], shown = 3): TodayPlan | null {
  const byExercise = new Map<number, { name: string; sets: PlanRow[] }>();
  for (const r of rows) {
    const e = byExercise.get(r.programExerciseId) ?? { name: r.name, sets: [] };
    if (r.setType !== null) e.sets.push(r);
    byExercise.set(r.programExerciseId, e);
  }
  const list = [...byExercise.values()];
  if (list.length === 0) return null;

  const working = (e: { sets: PlanRow[] }) => e.sets.filter((s) => s.setType === "working");
  const minutes = estimateSessionMinutes(list.map((e) => ({ sets: e.sets.map((s) => ({ durSec: s.durationSeconds, rest: s.restTimeSeconds ?? 0 })) })));
  return {
    exerciseCount: list.length,
    setCount: list.reduce((n, e) => n + working(e).length, 0),
    minutes: Math.max(5, Math.round(minutes / 5) * 5),
    exercises: list.slice(0, shown).map((e) => {
      const w = working(e);
      const first = w[0];
      const parts = [first ? `${w.length} × ${target(first) ?? "–"}` : "No working sets"];
      const kg = first?.weightKg != null ? Number(first.weightKg) : 0;
      if (kg > 0) parts.push(`${num(kg)} kg`);
      return { name: e.name, sets: parts.join(" · ") };
    }),
    more: list.slice(shown).map((e) => e.name),
  };
}
