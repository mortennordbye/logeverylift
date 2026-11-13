/**
 * Per-step results (docs/plans/endurance-app.md, section 5): the schema of a
 * stored result, the planned side of each step, and how a result compares.
 * Pure: the server module and the screens share it.
 */

import { complianceBand, complianceRatio, type ComplianceBand } from "@/lib/utils/session-compliance";
import { flattenWorkout, type PlayStep, type PlayerState } from "@/lib/utils/workout-player";
import { plannedLoad, type LoadAnchors, type PlannedStep } from "@/lib/utils/training-load";
import { DEFAULT_UNITS, type Units } from "@/lib/utils/units";
import {
  describeWorkout,
  estimateWorkout,
  resolveTarget,
  type ResolvedTarget,
  type ThresholdValues,
  type Workout,
  type WorkoutStep,
} from "@/lib/utils/workout-steps";
import { z } from "zod";

export const STEP_RESULT_STATUSES = ["done", "skipped", "partial", "not_done"] as const;
export const STEP_RESULTS_MAX_BYTES = 64 * 1024;
export const STEP_NOTE_MAX = 280;

export const stepResultSchema = z.strictObject({
  key: z.string().min(1).max(40),
  status: z.enum(STEP_RESULT_STATUSES),
  activeSeconds: z.number().int().min(0).max(12 * 3600).optional(),
  distanceMeters: z.number().min(0).max(300_000).optional(),
  extendedSeconds: z.number().int().min(0).max(3600).optional(),
  /** One measured number in the target's metric unit: W, bpm, m/s or rpm. */
  value: z.number().min(0).max(5000).optional(),
  rpe: z.number().int().min(1).max(10).optional(),
  notes: z.string().trim().min(1).max(STEP_NOTE_MAX).optional(),
});
export type StepResult = z.infer<typeof stepResultSchema>;

export const stepResultsSchema = z.array(stepResultSchema).min(1).max(400);

/** Results that fit the workout: known keys, each once, within the size limit. Errors carry a path. */
export function checkResults(workout: Workout, input: unknown): { ok: true; steps: StepResult[] } | { ok: false; errors: { path: string; message: string }[] } {
  const r = stepResultsSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  const keys = new Set(flattenWorkout(workout).map((s) => s.key));
  const seen = new Set<string>();
  const errors: { path: string; message: string }[] = [];
  r.data.forEach((s, i) => {
    if (!keys.has(s.key)) errors.push({ path: `${i}.key`, message: `no step "${s.key}" in this workout` });
    else if (seen.has(s.key)) errors.push({ path: `${i}.key`, message: `step "${s.key}" is given twice` });
    seen.add(s.key);
  });
  if (new TextEncoder().encode(JSON.stringify(r.data)).length > STEP_RESULTS_MAX_BYTES) errors.push({ path: "", message: "the results are larger than 64 KB" });
  return errors.length ? { ok: false, errors } : { ok: true, steps: r.data };
}

/** The threshold values of a workout's targets, as the anchors stored with the results and used for load. */
export function loadAnchors(t: ThresholdValues): LoadAnchors {
  return { ftp: t.ftp ?? null, runThresholdSpeed: t.run_threshold_pace ?? null, swimCss: t.swim_css ?? null };
}

export type PlannedRow = {
  key: string;
  type: WorkoutStep["type"];
  round: PlayStep["round"];
  /** "10 min 88-93% FTP" in the user's units. */
  text: string;
  plannedSeconds: number | null;
  plannedMeters: number | null;
  target: ResolvedTarget | null;
};

/** The planned side of each play step, with targets resolved from the stored anchors. */
export function plannedRows(workout: Workout, anchors: ThresholdValues, units: Units = DEFAULT_UNITS): PlannedRow[] {
  return flattenWorkout(workout).map((p) => {
    const step = p.step as WorkoutStep;
    const one: Workout = { ...workout, steps: [step] };
    const est = estimateWorkout(one, anchors);
    return {
      key: p.key,
      type: step.type,
      round: p.round,
      text: describeWorkout(one, units),
      plannedSeconds: est.durationComplete && est.durationSeconds > 0 ? est.durationSeconds : null,
      plannedMeters: step.end.type === "distance" ? step.end.meters : est.distanceComplete && est.distanceMeters > 0 ? est.distanceMeters : null,
      target: step.target ? resolveTarget(step.target, workout.sport, anchors, units) : null,
    };
  });
}

/** Planned load of a stored workout (endurance-app.md 6.2), from each step's estimated time. */
export function workoutPlannedLoad(workout: Workout, anchors: ThresholdValues): { load: number; partial: boolean } {
  const steps: PlannedStep[] = flattenWorkout(workout).map((p) => {
    const step = p.step as WorkoutStep;
    const est = estimateWorkout({ ...workout, steps: [step] }, anchors);
    return { type: step.type, seconds: est.durationComplete ? est.durationSeconds : null, target: step.target };
  });
  return plannedLoad(workout.sport, steps, loadAnchors(anchors));
}

export type StepCompare = { band: ComplianceBand | null; hit: "in" | "below" | "above" | null };

/** One step: its band (C5's colours on time, else distance) and whether a measured value is in the target. */
export function compareStep(planned: PlannedRow, result: StepResult | undefined): StepCompare {
  if (!result || result.status === "not_done") return { band: result ? "red" : null, hit: null };
  if (result.status === "skipped") return { band: "red", hit: null };
  const r = complianceRatio({ durationSeconds: planned.plannedSeconds, distanceMeters: planned.plannedMeters }, { durationSeconds: result.activeSeconds ?? null, distanceMeters: result.distanceMeters ?? null });
  let hit: StepCompare["hit"] = null;
  const t = planned.target;
  if (result.value !== undefined && t && (t.low !== null || t.high !== null)) {
    hit = t.low !== null && result.value < t.low ? "below" : t.high !== null && result.value > t.high ? "above" : "in";
  }
  return { band: complianceBand("done", r?.ratio ?? null), hit };
}

/** Results from a finished player run: one per play step, the steps never reached as not done. */
export function resultsFromRun(state: PlayerState, steps: PlayStep[]): StepResult[] {
  const runs = new Map(state.runs.map((r) => [r.key, r]));
  return steps.map((s) => {
    const r = runs.get(s.key);
    if (!r) return { key: s.key, status: "not_done" };
    return { key: s.key, status: r.status, activeSeconds: r.activeSeconds, ...(r.extendedSeconds > 0 && { extendedSeconds: r.extendedSeconds }) };
  });
}

/** Results for a session done without the player: every step as planned. */
export function resultsAsPlanned(rows: PlannedRow[]): StepResult[] {
  return rows.map((r) => ({
    key: r.key,
    status: "done",
    ...(r.plannedSeconds !== null && { activeSeconds: r.plannedSeconds }),
    ...(r.plannedMeters !== null && { distanceMeters: Math.round(r.plannedMeters) }),
  }));
}

/** Total active time of results, and moving time without rest steps (for swim load). */
export function resultTotals(rows: PlannedRow[], results: StepResult[]): { activeSeconds: number; movingSeconds: number; distanceMeters: number | null } {
  const typeOf = new Map(rows.map((r) => [r.key, r.type]));
  let active = 0;
  let moving = 0;
  let distance = 0;
  let anyDistance = false;
  for (const r of results) {
    const s = r.activeSeconds ?? 0;
    active += s;
    if (typeOf.get(r.key) !== "rest") moving += s;
    if (r.distanceMeters !== undefined) {
      distance += r.distanceMeters;
      anyDistance = true;
    }
  }
  return { activeSeconds: active, movingSeconds: moving, distanceMeters: anyDistance ? distance : null };
}
