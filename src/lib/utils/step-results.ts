/**
 * Per-step results (docs/plans/endurance-app.md, section 5): the schema of a
 * stored result, the planned side of each step, and how a result compares.
 * Pure: the server module and the screens share it.
 */

import type { ResultSource } from "@/db/schema/workout-sets";
import { complianceBand, complianceRatio, type ComplianceBand } from "@/lib/utils/session-compliance";
import { flattenWorkout, type PlayStep, type PlayerState } from "@/lib/utils/workout-player";
import { plannedLoad, type LoadAnchors, type PlannedStep } from "@/lib/utils/training-load";
import { DEFAULT_UNITS, type Units } from "@/lib/utils/units";
import { RESULT_FIELDS } from "@/lib/validators/workout";
import {
  beltKmhSchema,
  describeWorkout,
  inclinePercentSchema,
  estimateWorkout,
  mainTarget,
  resolveStepTarget,
  type ResolvedTarget,
  type ThresholdValues,
  type Workout,
  type WorkoutStep,
} from "@/lib/utils/workout-steps";
import { z } from "zod";

export const STEP_RESULT_STATUSES = ["done", "skipped", "partial", "not_done"] as const;
export const STEP_NOTE_MAX = 280;

export const stepResultSchema = z.strictObject({
  key: z.string().min(1).max(40),
  status: z.enum(STEP_RESULT_STATUSES),
  activeSeconds: z.number().int().min(0).max(12 * 3600).optional(),
  distanceMeters: z.number().min(0).max(300_000).optional(),
  extendedSeconds: z.number().int().min(0).max(3600).optional(),
  /** One measured number in the target's metric unit: W, bpm, m/s or rpm. */
  value: z.number().min(0).max(5000).optional(),
  // Ride results per step (docs/plans/bike-ride-logger.md, 4.1), the ranges of logWorkoutSet.
  avgPower: z.number().int().min(0).max(2500).optional(),
  avgHr: z.number().int().min(30).max(250).optional(),
  maxHr: z.number().int().min(30).max(250).optional(),
  avgCadence: z.number().int().min(0).max(250).optional(),
  /** m/s */
  avgSpeed: z.number().min(0).max(40).optional(),
  climbM: z.number().int().min(0).max(20000).optional(),
  // A treadmill run's step (docs/plans/run-logger.md, step 5): its belt in km/h, which is the
  // step's speed, and its incline in %. Only a treadmill run from run mode takes them.
  beltKmh: beltKmhSchema.optional(),
  inclinePercent: inclinePercentSchema.optional(),
  rpe: z.number().int().min(1).max(10).optional(),
  notes: z.string().trim().min(1).max(STEP_NOTE_MAX).optional(),
});
export type StepResult = z.infer<typeof stepResultSchema>;

export const stepResultsSchema = z.array(stepResultSchema).min(1).max(400);

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
      target: resolveStepTarget(step, workout.sport, anchors, units),
    };
  });
}

/** Planned load of a stored workout (endurance-app.md 6.2), from each step's estimated time. */
export function workoutPlannedLoad(workout: Workout, anchors: ThresholdValues): { load: number; partial: boolean } {
  const steps: PlannedStep[] = flattenWorkout(workout).map((p) => {
    const step = p.step as WorkoutStep;
    const est = estimateWorkout({ ...workout, steps: [step] }, anchors);
    return { type: step.type, seconds: est.durationComplete ? est.durationSeconds : null, target: mainTarget(step) };
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

// ── Assistant writes (docs/plans/bike-ride-logger.md, step 5) ───────────────

/** Sources an assistant write never replaces: what the rider typed, what Garmin measured, and a treadmill's belt (docs/plans/run-logger.md, 4.7). */
export const ASSISTANT_KEEPS: readonly ResultSource[] = ["typed", "garmin", "belt"];

type SourcedField = (typeof RESULT_FIELDS)[number];
type StepStatus = StepResult["status"];

/** A field an assistant write left as it was, and why: the athlete typed it, Garmin filled it, the treadmill's belt gave it, or it was logged already (effort, notes, a done step). */
export type KeptField = { field: string; by: "typed" | "garmin" | "belt" | "logged" };

/** The stored row of a logged step, as far as an assistant write reads it. */
export type StoredStep = Partial<Record<SourcedField, number | null>> & {
  inclinePercent?: number | null;
  rpe: number | null;
  notes: string | null;
  stepStatus: StepStatus | null;
  isCompleted: boolean;
  sources: Partial<Record<string, ResultSource>> | null;
};

/** What the assistant sends for one step, in column names; `beltKmh` marks a speed (and distance) that came from a belt. */
export type SentStep = Partial<Record<SourcedField, number>> & { beltKmh?: number; inclinePercent?: number; rpe?: number; notes?: string; stepStatus: StepStatus };

/** A belt's distance over a step's time, in whole metres. */
const beltMeters = (kmh: number, seconds: number) => Math.round((kmh / 3.6) * seconds);

/** One step's result as the assistant's columns: active time is durationSeconds, value is measuredValue. */
export function sentStep(r: StepResult, sessionRpe: number | null | undefined): SentStep {
  const done = r.status === "done" || r.status === "partial";
  const rpe = r.rpe ?? (done ? (sessionRpe ?? undefined) : undefined);
  const out: SentStep = { stepStatus: r.status };
  if (r.activeSeconds !== undefined && r.activeSeconds > 0) out.durationSeconds = r.activeSeconds;
  if (r.distanceMeters !== undefined && r.distanceMeters > 0) out.distanceMeters = Math.round(r.distanceMeters);
  if (r.value !== undefined) out.measuredValue = r.value;
  for (const f of ["avgPower", "avgHr", "maxHr", "avgCadence", "avgSpeed", "climbM"] as const) if (r[f] !== undefined) out[f] = r[f];
  // A belt is the step's speed, and its distance over the step's time when none is sent, as the results table writes it.
  if (r.beltKmh !== undefined) {
    out.beltKmh = r.beltKmh;
    out.avgSpeed = r.beltKmh / 3.6;
    if (out.distanceMeters === undefined && out.durationSeconds !== undefined) out.distanceMeters = beltMeters(r.beltKmh, out.durationSeconds);
  }
  if (r.inclinePercent !== undefined) out.inclinePercent = r.inclinePercent;
  if (rpe !== undefined) out.rpe = rpe;
  if (r.notes) out.notes = r.notes;
  return out;
}

/**
 * An assistant write over a logged step: the columns to set and the fields it
 * kept. A result field is written, with source "assistant", unless the row
 * holds a value that the rider typed or Garmin filled (the same value keeps
 * its source; another one is kept and reported). Effort and notes
 * are only filled when empty: the rider's own words stay. A done step stays
 * done and a partial one at least partial.
 */
export function assistantStepWrite(stored: StoredStep, given: SentStep): { set: Record<string, unknown>; kept: KeptField[] } {
  // A belt with no distance sent runs over the step's logged time.
  const sent: SentStep =
    given.beltKmh !== undefined && given.distanceMeters === undefined && stored.durationSeconds
      ? { ...given, distanceMeters: beltMeters(given.beltKmh, stored.durationSeconds) }
      : given;
  const set: Record<string, unknown> = {};
  const kept: KeptField[] = [];
  const sources: Partial<Record<string, ResultSource>> = { ...(stored.sources ?? {}) };
  for (const f of RESULT_FIELDS) {
    const v = sent[f];
    if (v === undefined) continue;
    const old = stored[f] ?? null;
    const src = stored.sources?.[f];
    if (old !== null && src !== undefined && ASSISTANT_KEEPS.includes(src)) {
      // The same value keeps who wrote it; another one is not the assistant's to replace.
      // A speed is a real number: the same belt reads back a hair off.
      if (f === "avgSpeed" ? Math.abs(old - v) > 0.001 : old !== v) kept.push({ field: f, by: src as KeptField["by"] });
      continue;
    }
    set[f] = v;
    sources[f] = "assistant";
  }
  // A treadmill step's stored incline is the belt's (run mode's taps), whoever wrote its distance;
  // the assistant fills an empty one and changes only its own.
  if (sent.inclinePercent !== undefined) {
    const old = stored.inclinePercent ?? null;
    if (old !== null && stored.sources?.inclinePercent !== "assistant") {
      if (old !== sent.inclinePercent) kept.push({ field: "inclinePercent", by: "belt" });
    } else {
      set.inclinePercent = sent.inclinePercent;
      sources.inclinePercent = "assistant";
    }
  }
  for (const f of ["rpe", "notes"] as const) {
    const v = sent[f];
    if (v === undefined) continue;
    if (stored[f] != null && stored[f] !== v) kept.push({ field: f, by: "logged" });
    else set[f] = v;
  }
  const done = (s: StepStatus | null) => s === "done" || s === "partial";
  // A done step stays done, a partial one at least partial.
  if ((stored.stepStatus === "done" && sent.stepStatus !== "done") || (stored.isCompleted && !done(sent.stepStatus))) {
    if (stored.stepStatus !== sent.stepStatus) kept.push({ field: "status", by: "logged" });
  } else {
    set.stepStatus = sent.stepStatus;
    set.isCompleted = done(sent.stepStatus);
  }
  set.sources = sources;
  return { set, kept };
}
