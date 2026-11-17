/**
 * The ride results table and the ride summary (docs/plans/bike-ride-logger.md,
 * section 5 "Ride results" and "Summary", 4.5 and 4.6): one row per step of
 * the frozen plan with what was logged for it, the saves the table's Done
 * sends, and the summary's tiles, zone bar and plan-against-done table.
 *
 * Pure: the page loads the plan and the logged steps; the screens only draw
 * what this returns.
 */

import type { RideMode } from "@/db/schema/rides";
import type { ResultSource } from "@/db/schema/workout-sets";
import { bikeStepRows, wattsText } from "@/lib/utils/bike-ride-view";
import { doneRideNumbers, type DoneRideNumbers } from "@/lib/utils/ride-numbers";
import { rideClock } from "@/lib/utils/ride-screen";
import type { RidePlan, RidePlanStep } from "@/lib/utils/ride-timeline";
import { DEFAULT_UNITS, METERS_PER_MILE, type Units } from "@/lib/utils/units";

/** What is logged for one step: its `workout_sets` row, or the ride's timeline for a step whose save has not arrived. */
export type StepLog = {
  status: "done" | "partial" | "skipped";
  durationSeconds: number | null;
  targetOffsetW: number | null;
  extendedSeconds: number | null;
  avgPower: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  /** m/s */
  avgSpeed: number | null;
  distanceMeters: number | null;
  climbM: number | null;
  rpe: number | null;
  sources: Partial<Record<string, ResultSource>> | null;
};

/** The numbers a rider can type per step (4.1). */
export type ResultField = "avgPower" | "avgHr" | "maxHr" | "avgCadence" | "distanceMeters" | "avgSpeed" | "climbM";

/** Avg W and Avg HR on every row; "More numbers" adds the rest. Never distance, speed or climbing indoors (D12). */
export function resultFields(mode: RideMode): { main: ResultField[]; more: ResultField[] } {
  return mode === "indoor"
    ? { main: ["avgPower", "avgHr"], more: ["maxHr", "avgCadence"] }
    : { main: ["avgPower", "avgHr"], more: ["maxHr", "distanceMeters", "avgSpeed", "climbM"] };
}

/** Column and field labels, in the user's units. */
export function fieldLabel(f: ResultField, units: Units = DEFAULT_UNITS): string {
  const mi = units.distance === "mi";
  return {
    avgPower: "Avg W",
    avgHr: "Avg HR",
    maxHr: "Max HR",
    avgCadence: "Cadence",
    distanceMeters: mi ? "Distance mi" : "Distance km",
    avgSpeed: mi ? "Avg mph" : "Avg km/h",
    climbM: "Climbing m",
  }[f];
}

/** "More numbers · max HR, cadence". */
export function moreNumbersText(mode: RideMode): string {
  return mode === "indoor" ? "More numbers · max HR, cadence" : "More numbers · max HR, distance, speed, climbing";
}

/** A stored value as the text its field shows. */
export function fieldText(f: ResultField, v: number | null, units: Units = DEFAULT_UNITS): string {
  if (v === null) return "";
  const mi = units.distance === "mi";
  if (f === "distanceMeters") return `${+(v / (mi ? METERS_PER_MILE : 1000)).toFixed(2)}`;
  if (f === "avgSpeed") return `${+((v * 3600) / (mi ? METERS_PER_MILE : 1000)).toFixed(1)}`;
  return `${Math.round(v)}`;
}

/** Typed text as the stored value: null when empty, undefined when it is not a number in range. */
export function parseField(f: ResultField, text: string, units: Units = DEFAULT_UNITS): number | null | undefined {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  const mi = units.distance === "mi";
  const range: Record<ResultField, [number, number]> = {
    avgPower: [0, 2500],
    avgHr: [30, 250],
    maxHr: [30, 250],
    avgCadence: [0, 250],
    distanceMeters: [0, 1_000_000],
    avgSpeed: [0, 40],
    climbM: [0, 20000],
  };
  let v: number;
  if (f === "distanceMeters") v = Math.round(n * (mi ? METERS_PER_MILE : 1000));
  else if (f === "avgSpeed") v = (n * (mi ? METERS_PER_MILE : 1000)) / 3600;
  else v = Math.round(n);
  const [lo, hi] = range[f];
  return v >= lo && v <= hi ? v : undefined;
}

/** "15:00", "1:05:00" or "45" (minutes) as seconds; null when empty, undefined when unreadable. */
export function parseStepTime(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) * 60;
  const parts = t.split(":");
  if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return undefined;
  const n = parts.map(Number);
  if (n.slice(1).some((x) => x >= 60)) return undefined;
  return n.reduce((a, x) => a * 60 + x, 0);
}

// ── Rows ────────────────────────────────────────────────────────────────────

export type ResultStep = {
  key: string;
  programSetId: number;
  n: number;
  /** "Work · 1 of 2" */
  title: string;
  /** The plan's time: "15 min", "to lap". */
  plannedTime: string;
  plannedSeconds: number | null;
  /** The step's log; null when it was not ridden (an ended-early ride) or not logged yet (by hand). */
  log: StepLog | null;
};

export function resultSteps(plan: RidePlan, logs: Record<number, StepLog>, units: Units = DEFAULT_UNITS): ResultStep[] {
  const rows = bikeStepRows(plan, units);
  return plan.steps.map((s, i) => ({
    key: s.key,
    programSetId: s.programSetId,
    n: i + 1,
    title: rows[i].title,
    plannedTime: rows[i].time,
    plannedSeconds: s.seconds,
    log: logs[s.programSetId] ?? null,
  }));
}

/** The time column of a ride's step: ridden time, "Skipped" or "Not ridden". */
export function riddenText(log: StepLog | null): string {
  if (!log) return "Not ridden";
  if (log.status === "skipped") return "Skipped";
  return rideClock(log.durationSeconds ?? 0);
}

const ridden = (log: StepLog | null): log is StepLog => !!log && log.status !== "skipped" && (log.durationSeconds ?? 0) > 0;

/** The effort of the ride: it is saved on each ridden step, the same on all. */
export function rideEffort(steps: ResultStep[]): number | null {
  for (const s of steps) if (ridden(s.log) && s.log.rpe !== null) return s.log.rpe;
  return null;
}

// ── Saves (Done) ─────────────────────────────────────────────────────────────

/** What the rider changed: per program set, the typed text of each field (and the time, by hand). */
export type ResultEdits = Record<number, Partial<Record<ResultField | "time", string>>>;

export type ResultSaveContext = { sessionId: number; exerciseId: number; setNumbers: Record<number, number>; units?: Units };

/** The payloads for `logWorkoutSet`. `hand`: no ride, so each step with a time is saved as done with its typed time. */
export function resultPayloads(steps: ResultStep[], edits: ResultEdits, effort: number | null, ctx: ResultSaveContext, hand: boolean) {
  const units = ctx.units ?? DEFAULT_UNITS;
  const effortChanged = effort !== rideEffort(steps);
  const out = [];
  for (const s of steps) {
    const e = edits[s.programSetId] ?? {};
    const log = s.log;
    let seconds: number | null;
    let timeTyped = false;
    if (hand) {
      const t = e.time !== undefined ? parseStepTime(e.time) : (log?.durationSeconds ?? s.plannedSeconds);
      if (!t) continue;
      seconds = t;
      timeTyped = e.time !== undefined || !log;
    } else {
      if (!ridden(log)) continue;
      seconds = log.durationSeconds;
    }
    const values: Partial<Record<ResultField, number | null>> = {};
    const sources: Partial<Record<ResultField | "durationSeconds", ResultSource>> = {};
    for (const [f, text] of Object.entries(e) as [ResultField | "time", string][]) {
      if (f === "time") continue;
      const v = parseField(f, text, units);
      if (v === undefined || v === (log?.[f] ?? null)) continue;
      values[f] = v;
      if (v !== null) sources[f] = "typed";
    }
    if (timeTyped) sources.durationSeconds = "typed";
    const changed = Object.keys(values).length > 0 || timeTyped || (hand && log?.durationSeconds !== seconds);
    if (!changed && !effortChanged) continue;
    const status = hand ? "done" : log!.status;
    out.push({
      sessionId: ctx.sessionId,
      exerciseId: ctx.exerciseId,
      setNumber: ctx.setNumbers[s.programSetId] ?? 1,
      programSetId: s.programSetId,
      actualReps: 0,
      weightKg: 0,
      restTimeSeconds: 0,
      durationSeconds: seconds ?? 0,
      isCompleted: true,
      stepStatus: status,
      ...(log?.targetOffsetW != null && { targetOffsetW: log.targetOffsetW }),
      ...(log?.extendedSeconds != null && { extendedSeconds: log.extendedSeconds }),
      ...values,
      // The ride's effort, or null when the rider took it away.
      ...((effort !== null || effortChanged) && { rpe: effort }),
      sources,
    });
  }
  return out;
}

/** True when a field has an error: text that is not a number in range. */
export function badField(f: ResultField, text: string | undefined, units: Units = DEFAULT_UNITS): boolean {
  return text !== undefined && parseField(f, text, units) === undefined;
}

// ── Summary ─────────────────────────────────────────────────────────────────

export type SummaryTile = { label: string; value: string; est?: boolean };
export type SummaryRow = { key: string; title: string; plan: string | null; done: string; under: boolean };

export type RideSummary = {
  numbers: DoneRideNumbers;
  tiles: SummaryTile[];
  /** Minutes per power zone with time, from step averages. */
  zones: { zone: number; m: number }[];
  rows: SummaryRow[];
  effort: number | null;
  /** Nothing but times: "Plan only · no ride numbers". */
  planOnly: boolean;
  /** Ridden but no load: no power with an FTP, no effort. */
  noLoad: boolean;
};

const hasNumber = (l: StepLog) =>
  [l.avgPower, l.avgHr, l.maxHr, l.avgCadence, l.avgSpeed, l.distanceMeters, l.climbM].some((v) => v !== null);

/** The plan column: watts indoors ("135-145", "under 100"), the outdoor target outdoors. */
function planText(s: RidePlanStep, row: { target: string | null }, mode: RideMode): string | null {
  if (mode === "indoor") {
    const w = wattsText(s);
    return w ? w.replace(/ W$/, "") : row.target;
  }
  return row.target;
}

/** Done: avg HR against a heart rate target outdoors, else avg W against the watts. ↓ when under the low end. */
function doneText(s: RidePlanStep, log: StepLog | null, mode: RideMode): { done: string; under: boolean } {
  if (!log) return { done: "Not ridden", under: false };
  if (log.status === "skipped") return { done: "Skipped", under: false };
  if (mode === "outdoor" && s.outdoor?.unit === "bpm" && log.avgHr !== null) {
    const low = s.outdoor.low;
    return { done: `${log.avgHr} bpm`, under: low !== null && log.avgHr < Math.round(low) };
  }
  if (log.avgPower !== null) {
    const p = s.power;
    const low = p ? (p.from !== null && p.to !== null ? Math.min(p.from, p.to) : p.from) : null;
    return { done: `${log.avgPower} W`, under: low !== null && log.avgPower < low };
  }
  return { done: "–", under: false };
}

export function rideSummary(plan: RidePlan, logs: Record<number, StepLog>, units: Units = DEFAULT_UNITS): RideSummary {
  const steps = resultSteps(plan, logs, units);
  const effort = rideEffort(steps);
  const riddenLogs = steps.map((s) => s.log).filter(ridden);
  const numbers = doneRideNumbers(
    riddenLogs.map((l) => ({ seconds: l.durationSeconds ?? 0, avgPower: l.avgPower })),
    { ftp: plan.thresholds.ftp ?? null, rpe: effort },
  );
  const tiles: SummaryTile[] = [{ label: "Time", value: rideClock(numbers.seconds) }];
  if (numbers.avgPower !== null) tiles.push({ label: "Avg W", value: `${Math.round(numbers.avgPower)}` });
  if (numbers.np !== null) tiles.push({ label: "NP", value: `${Math.round(numbers.np)}` });
  if (numbers.intensityFactor !== null) tiles.push({ label: "IF", value: numbers.intensityFactor.toFixed(2) });
  if (numbers.load) tiles.push({ label: "Load", value: `${Math.round(numbers.load.value)}`, est: numbers.load.estimated });
  if (numbers.kj !== null) tiles.push({ label: "kJ", value: `${numbers.kj}` });
  if (effort !== null) tiles.push({ label: "Effort", value: `${effort}` });

  const planRows = bikeStepRows(plan, units);
  const rows = plan.steps.map((s, i) => {
    const log = logs[s.programSetId] ?? null;
    return { key: s.key, title: planRows[i].title, plan: planText(s, planRows[i], plan.mode), ...doneText(s, log, plan.mode) };
  });

  return {
    numbers,
    tiles,
    zones: numbers.zoneMinutes.map((m, i) => ({ zone: i + 1, m })).filter((z) => z.m > 0),
    rows,
    effort,
    planOnly: riddenLogs.length > 0 && effort === null && !riddenLogs.some(hasNumber),
    noLoad: riddenLogs.length > 0 && numbers.load === null,
  };
}
