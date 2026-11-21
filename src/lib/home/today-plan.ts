/**
 * Today's program as the Today widget shows it (owner decision A,
 * 2026-11-14; docs/home-widgets-audit.md, section 12): how many exercises and
 * working sets, about how long, and the first exercises with their sets.
 * Pure: the rows come from one read in src/lib/home/core.ts.
 */

import type { RideMode } from "@/db/schema/rides";
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
  /** Endurance steps (docs/plans/one-program-model.md); absent or null on a strength set. */
  stepKind?: string | null;
  blockId?: number | null;
  blockRound?: number | null;
  endsOnLap?: boolean | null;
  /** The exercise's sport: "run" makes a run day (docs/plans/run-logger.md, planned day card). */
  discipline?: string | null;
};

export type TodayPlan = {
  exerciseCount: number;
  /** Working sets, warm-ups left out. */
  setCount: number;
  /** Every set is an endurance step, so the count reads as steps. */
  stepsOnly?: boolean;
  /** Rounded to 5 minutes, at least 5. Null when a step has no planned time (a distance or lap step). */
  minutes: number | null;
  /** The first `shown` exercises: name and "4 × 6–8 · 80 kg". */
  exercises: { name: string; sets: string }[];
  /** The names after those. */
  more: string[];
  /** A program of one run exercise with steps: its program exercise, whose run mode home reads (planned day card, docs/plans/run-logger.md). */
  runExerciseId?: number;
  /** That run's mode (R4), read on home for an endurance user only: the card says "Run · Treadmill · 75 min". */
  runMode?: RideMode;
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

const STEP_WORD: Record<string, string> = { warmup: "warm-up", work: "", recovery: "easy", cooldown: "cool-down", rest: "rest" };

/** One step's end: "1 km", "2 min", "to lap". */
function stepEnd(s: PlanRow): string {
  if (s.endsOnLap) return "to lap";
  return target(s) ?? "–";
}

/** "2 km warm-up · 4 × (1 km, 2 min easy) · 1.5 km cool-down": each block once, with its rounds. */
function stepsLine(sets: PlanRow[]): string {
  const parts: string[] = [];
  const step = (s: PlanRow) => [stepEnd(s), STEP_WORD[s.stepKind ?? ""] ?? ""].filter(Boolean).join(" ");
  for (let i = 0; i < sets.length; ) {
    const s = sets[i];
    if (s.blockId == null) {
      parts.push(step(s));
      i++;
      continue;
    }
    let j = i;
    while (j < sets.length && sets[j].blockId === s.blockId) j++;
    const block = sets.slice(i, j);
    const first = block.filter((b) => b.blockRound === 1);
    const rounds = Math.max(...block.map((b) => b.blockRound ?? 1));
    parts.push(`${rounds} × ${first.length === 1 ? step(first[0]) : `(${first.map(step).join(", ")})`}`);
    i = j;
  }
  return parts.join(" · ");
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
  // A step that ends on distance or the lap button has no time here.
  const untimedStep = rows.some((r) => r.stepKind != null && (r.endsOnLap || r.durationSeconds == null));
  return {
    exerciseCount: list.length,
    setCount: list.reduce((n, e) => n + working(e).length, 0),
    minutes: untimedStep ? null : Math.max(5, Math.round(minutes / 5) * 5),
    ...(rows.every((r) => r.stepKind != null) && { stepsOnly: true }),
    exercises: list.slice(0, shown).map((e) => {
      if (e.sets.some((s) => s.stepKind != null)) return { name: e.name, sets: stepsLine(e.sets) };
      const w = working(e);
      const first = w[0];
      const parts = [first ? `${w.length} × ${target(first) ?? "–"}` : "No working sets"];
      const kg = first?.weightKg != null ? Number(first.weightKg) : 0;
      if (kg > 0) parts.push(`${num(kg)} kg`);
      return { name: e.name, sets: parts.join(" · ") };
    }),
    more: list.slice(shown).map((e) => e.name),
    ...(byExercise.size === 1 && rows.every((r) => r.discipline === "run" && r.stepKind != null) && { runExerciseId: rows[0].programExerciseId }),
  };
}
