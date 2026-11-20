/**
 * The run results table and the run summary (docs/plans/run-logger.md,
 * section 5 "Run results" and "Summary", 4.2 judging, 4.7 and 4.9): one row
 * per step of the frozen plan, a strides block as one row, the saves the
 * table's Done sends, and the summary's tiles, zone bar and plan-against-done
 * table in the same units per row.
 *
 * Pure: the page loads the plan and the logged steps; the screens only draw
 * what this returns.
 */

import type { RideMode } from "@/db/schema/rides";
import { parseField, resultPayloads, rideEffort, type ResultEdits, type ResultSaveContext, type ResultStep, type StepLog } from "@/lib/utils/ride-results";
import { rideClock } from "@/lib/utils/ride-screen";
import type { RidePlan, RidePlanStep } from "@/lib/utils/ride-timeline";
import { doneRunNumbers, paceText, type DoneRunNumbers } from "@/lib/utils/run-numbers";
import type { DoneChart } from "@/lib/utils/ride-stream";
import type { RunStreamNumbers, StepBounds } from "@/lib/utils/run-stream";
import { runOutdoorText, runRowOfStep, runStepTitle, runStepZone, runTargetText } from "@/lib/utils/run-view";
import { minSec } from "@/lib/utils/thresholds";
import { mainTarget, resolveTarget } from "@/lib/utils/workout-steps";

/** A heart rate on a step shorter than this is not judged (4.2). */
export const HR_JUDGED_FROM_S = 480;
/** A belt within this of a pace range passes: a belt from a pace rounds to 0.5 km/h (4.2). */
export const BELT_TOLERANCE_KMH = 0.25;

const kmhOf = (ms: number) => Math.round(ms * 36) / 10;
const ran = (log: StepLog | null): log is StepLog => !!log && (log.durationSeconds ?? 0) > 0;
const done = (log: StepLog | null): log is StepLog => ran(log) && log.status !== "skipped";

/** The time column of a run's step: run time, "Skipped" or "Not run". */
export function runTimeText(log: StepLog | null): string {
  if (!log) return "Not run";
  if (log.status === "skipped") return "Skipped";
  return rideClock(log.durationSeconds ?? 0);
}

/** A step's belt in km/h from its saved speed, to 0.1 km/h; null without one. */
export function beltOfLog(log: StepLog | null): number | null {
  return log?.avgSpeed != null && log.avgSpeed > 0 ? kmhOf(log.avgSpeed) : null;
}

/** A run step's log: a treadmill step also saves its time-weighted incline (4.7). */
export type RunStepLog = StepLog & { inclinePercent?: number | null };

// ── Rows ────────────────────────────────────────────────────────────────────

export type RunResultRow = {
  key: string;
  n: number;
  /** "Steady", "Strides 6 × 20 s · 5 of 6". */
  title: string;
  /** The step of a one-step row; null for a strides block, which takes no numbers. */
  step: ResultStep | null;
  /** The plan's belt in km/h on a treadmill; null by feel, outdoors and on a block. */
  planBelt: number | null;
};

/** One ResultStep per plan step (for the saves), and the rows the table shows. */
export function runResultRows(plan: RidePlan, logs: Record<number, StepLog>): { steps: ResultStep[]; rows: RunResultRow[] } {
  const th = plan.thresholds;
  const steps: ResultStep[] = plan.steps.map((s, i) => ({
    key: s.key,
    programSetId: s.programSetId,
    n: i + 1,
    title: runStepTitle(s, th),
    plannedTime: s.seconds !== null ? minSec(s.seconds) : "to lap",
    plannedSeconds: s.seconds,
    log: logs[s.programSetId] ?? null,
  }));
  const rowOf = runRowOfStep(plan);
  const rows: RunResultRow[] = [];
  plan.steps.forEach((s, i) => {
    if (rows.length > rowOf[i]) return;
    const block = s.run?.block ?? null;
    if (block) {
      const part = plan.steps.filter((p) => p.run?.block === block);
      rows.push({ key: block, n: rowOf[i] + 1, title: blockTitle(part, logs), step: null, planBelt: null });
      return;
    }
    rows.push({ key: s.key, n: rowOf[i] + 1, title: steps[i].title, step: steps[i], planBelt: plan.mode === "indoor" && s.run?.belt != null ? s.run.belt / 10 : null });
  });
  return { steps, rows };
}

/** "Strides 6 × 20 s · 5 of 6": the reps of a block that were run (4.5). */
function blockTitle(part: RidePlanStep[], logs: Record<number, StepLog>): string {
  const work = part.filter((p) => p.step.type === "work");
  const ranReps = work.filter((p) => done(logs[p.programSetId] ?? null)).length;
  return `Strides ${work.length} × ${work[0]?.seconds ?? work[0]?.estSeconds ?? 0} s · ${ranReps} of ${work.length}`;
}

// ── Saves (Done) ─────────────────────────────────────────────────────────────

/**
 * The payloads for `logWorkoutSet`. A belt the runner set (km/h) is typed
 * speed and distance over the step's run time; a total distance outdoors is
 * typed distance on each run step by its share of the time. The other fields
 * and the effort go as the bike's table sends them.
 */
export function runResultPayloads(
  steps: ResultStep[],
  edits: ResultEdits,
  belts: Record<number, number>,
  totalKm: string | undefined,
  effort: number | null,
  ctx: ResultSaveContext,
) {
  const all: ResultEdits = Object.fromEntries(Object.entries(edits).map(([k, v]) => [k, { ...v }]));
  for (const s of steps) {
    const kmh = belts[s.programSetId];
    const seconds = s.log?.durationSeconds ?? 0;
    if (kmh === undefined || !done(s.log)) continue;
    all[s.programSetId] = { ...all[s.programSetId], avgSpeed: kmh.toFixed(1), distanceMeters: ((kmh / 3.6) * seconds / 1000).toFixed(3) };
  }
  const total = totalKm === undefined ? undefined : parseField("distanceMeters", totalKm);
  if (total !== undefined) {
    // Every step that ran, a skipped one too: it was still run (4.7), so the pace is total time over total distance.
    const run = steps.filter((s) => ran(s.log));
    const seconds = run.reduce((a, s) => a + (s.log!.durationSeconds ?? 0), 0);
    let left = total ?? 0;
    run.forEach((s, k) => {
      const m = total === null ? null : k === run.length - 1 ? left : Math.round((total * (s.log!.durationSeconds ?? 0)) / seconds);
      if (m !== null) left -= m;
      // Cleared: only the steps that hold a distance are cleared.
      if (m === null && s.log!.distanceMeters === null) return;
      all[s.programSetId] = { ...all[s.programSetId], distanceMeters: m === null ? "" : (m / 1000).toFixed(3) };
    });
  }
  const out = resultPayloads(steps, all, effort, ctx, false);
  // The table saves skipped steps only for a distance spread onto them; their status and time stay.
  for (const s of steps) {
    const text = all[s.programSetId]?.distanceMeters;
    if (s.log?.status !== "skipped" || !ran(s.log) || text === undefined) continue;
    const meters = parseField("distanceMeters", text);
    if (meters === undefined) continue;
    out.push({
      sessionId: ctx.sessionId,
      exerciseId: ctx.exerciseId,
      setNumber: ctx.setNumbers[s.programSetId] ?? 1,
      programSetId: s.programSetId,
      actualReps: 0,
      weightKg: 0,
      restTimeSeconds: 0,
      durationSeconds: s.log.durationSeconds ?? 0,
      isCompleted: false,
      stepStatus: "skipped",
      ...(s.log.targetOffsetW != null && { targetOffsetW: s.log.targetOffsetW }),
      ...(s.log.extendedSeconds != null && { extendedSeconds: s.log.extendedSeconds }),
      distanceMeters: meters,
      sources: meters !== null ? { distanceMeters: "typed" as const } : {},
    });
  }
  const order = new Map(steps.map((s, i) => [s.programSetId, i]));
  return out.sort((a, b) => (order.get(a.programSetId) ?? 0) - (order.get(b.programSetId) ?? 0));
}

/** The total distance a table's outdoor run shows: the sum of its steps' distances, in km. */
export function totalKmText(steps: ResultStep[]): string {
  const m = steps.filter((s) => ran(s.log)).reduce((a, s) => a + (s.log!.distanceMeters ?? 0), 0);
  return m > 0 ? `${+(m / 1000).toFixed(2)}` : "";
}

// ── Summary ─────────────────────────────────────────────────────────────────

export type RunTile = { label: string; value: string; est?: boolean; sub?: string };
/** mark: ↑ over a cap or above a range, ↓ under a range (4.2); null when it passes or is not judged. */
export type RunSummaryRow = { key: string; title: string; plan: string | null; done: string; mark: "↑" | "↓" | null; quiet: boolean; onTarget: number | null };

/** The Garmin stream of a run as the summary reads it (4.9): its numbers and the plan against done chart. */
export type RunStreamView = { numbers: RunStreamNumbers; chart: DoneChart | null };

export type RunSummary = {
  numbers: DoneRunNumbers;
  tiles: RunTile[];
  /** "Distance from the belt", "Distance from the plan · no belt changes". */
  distanceLine: string | null;
  /** Minutes per heart rate zone with time, by step average or from the Garmin stream; empty without a run LTHR. */
  zones: { zone: number; m: number }[];
  /** The plan against done chart, from a Garmin stream only: the belt on a treadmill, the pace outdoors. */
  chart: DoneChart | null;
  treadmill: boolean;
  rows: RunSummaryRow[];
  /** What the plan and done columns hold: "km/h · HR. Under an easy cap is a pass." */
  footnote: string;
  effort: number | null;
  /** Nothing but times: "Plan only · no run numbers". */
  planOnly: boolean;
  noLoadReason: "numbers" | "short" | null;
};

/** "HR under 160" → a cap at 160; "HR 153-160" → a range. Read from the words the plan column shows, so the arrow judges what the runner sees. */
function hrBand(text: string | null): { low: number | null; high: number | null; cap: boolean } | null {
  if (!text) return null;
  let m = /^HR under (\d+)$/.exec(text);
  if (m) return { low: null, high: Number(m[1]), cap: true };
  m = /^HR (\d+)-(\d+)$/.exec(text);
  if (m) return { low: Number(m[1]), high: Number(m[2]), cap: false };
  m = /^HR (\d+) or more$/.exec(text);
  if (m) return { low: Number(m[1]), high: null, cap: false };
  m = /^HR (\d+)$/.exec(text);
  return m ? { low: Number(m[1]), high: Number(m[1]), cap: false } : null;
}

/** The heart rate words of a step as its mode shows them: the written target on a treadmill, the target of 4.2 outdoors. */
function hrTextOf(s: RidePlanStep, plan: RidePlan): string | null {
  const th = plan.thresholds;
  if (plan.mode === "indoor") return mainTarget(s.step)?.metric === "hr" ? runTargetText(s, th) : null;
  const o = runOutdoorText(s, th, plan.surface ?? "road");
  return [o.main, o.second].find((t) => t?.startsWith("HR ")) ?? null;
}

/** "HR 160" for a cap (the footnote says a cap passes under it), "HR 153-160" for a range. */
const shortHr = (t: string) => t.replace(/^HR under /, "HR ");

/** The plan column: belt and heart rate on a treadmill ("8.2 · HR 160"), the outdoor target outdoors ("5:35-5:59", "HR 160"). */
function planText(s: RidePlanStep, plan: RidePlan): string | null {
  const th = plan.thresholds;
  const hr = hrTextOf(s, plan);
  if (plan.mode === "indoor") {
    const zone = runStepZone(s.step, th);
    const belt = s.run?.belt != null ? (s.run.belt / 10).toFixed(1) : s.run?.carry ? "Same" : "Feel";
    return [belt, hr ? shortHr(hr) : zone !== null ? `Z${zone}` : null].filter(Boolean).join(" · ");
  }
  const main = runOutdoorText(s, th, plan.surface ?? "road").main;
  if (!main) return null;
  if (main === "Easy jog or walk") return "Easy";
  return shortHr(main.replace(/ \/km$/, ""));
}

/** The done column, in the plan's units: belt and heart rate on a treadmill, pace and heart rate outdoors. */
function doneText(log: StepLog | null, mode: RideMode): string {
  if (!log) return "Not run";
  if (log.status === "skipped") return "Skipped";
  const hr = log.avgHr !== null ? `HR ${log.avgHr}` : null;
  const belt = beltOfLog(log);
  const pace =
    mode === "outdoor" && log.distanceMeters && log.durationSeconds ? minSec(Math.floor(log.durationSeconds / (log.distanceMeters / 1000))) : null;
  return [mode === "indoor" ? (belt !== null ? belt.toFixed(1) : null) : pace, hr].filter(Boolean).join(" · ") || "–";
}

/**
 * The arrow of a step (4.2): a heart rate target judges the average heart
 * rate (a cap passes at or under it, a step under 8 min is not judged); a
 * pace target on a treadmill judges the belt, within 0.25 km/h of the range.
 * Outdoors the pace is judged with a Garmin stream (step 7).
 */
function markOf(s: RidePlanStep, log: StepLog | null, plan: RidePlan): RunSummaryRow["mark"] {
  if (!done(log)) return null;
  // Outdoors a pace that is the step's main target judges Garmin's pace of the step (step 7); its heart rate line is information.
  const pace = plan.mode !== "indoor" && log.sources?.avgSpeed === "garmin" && log.avgSpeed !== null ? paceBounds(s, plan) : null;
  if (pace) {
    if (pace.low !== null && log.avgSpeed! < pace.low) return "↓";
    if (pace.high !== null && log.avgSpeed! > pace.high) return "↑";
    return null;
  }
  const band = hrBand(hrTextOf(s, plan));
  if (band) {
    const seconds = s.seconds ?? log.durationSeconds ?? 0;
    if (log.avgHr === null || seconds < HR_JUDGED_FROM_S) return null;
    if (band.high !== null && log.avgHr > band.high) return "↑";
    if (!band.cap && band.low !== null && log.avgHr < band.low) return "↓";
    return null;
  }
  const t = mainTarget(s.step);
  const belt = beltOfLog(log);
  if (plan.mode !== "indoor" || t?.metric !== "pace" || belt === null) return null;
  const r = resolveTarget(t, "run", plan.thresholds);
  if (r.low === null || r.high === null) return null;
  const [slow, fast] = [Math.min(r.low, r.high) * 3.6, Math.max(r.low, r.high) * 3.6];
  if (belt < slow - BELT_TOLERANCE_KMH) return "↓";
  if (belt > fast + BELT_TOLERANCE_KMH) return "↑";
  return null;
}

/**
 * Each step's target as the runner saw it, for time on target (4.9): a heart
 * rate target (a cap or a range, steps of 8 min or more as 4.2 judges them)
 * on either mode, else outdoors a pace range as speed in m/s. A strides
 * block, an effort and a treadmill pace (the belt is the pace) have none.
 */
export function runStepBounds(plan: RidePlan): Record<number, StepBounds | null> {
  const out: Record<number, StepBounds | null> = {};
  for (const s of plan.steps) {
    out[s.programSetId] = null;
    if (s.run?.block) continue;
    // The main target only: outdoors a pace with heart rate as information is judged on its pace.
    const main = plan.mode === "indoor" ? hrTextOf(s, plan) : runOutdoorText(s, plan.thresholds, plan.surface ?? "road").main;
    const band = hrBand(main);
    if (band) {
      if ((s.seconds ?? s.estSeconds) >= HR_JUDGED_FROM_S) out[s.programSetId] = { series: "hr", low: band.low, high: band.high };
      continue;
    }
    out[s.programSetId] = plan.mode === "indoor" ? null : paceBounds(s, plan);
  }
  return out;
}

/** An outdoor step's pace range in m/s when its shown target is a pace; null otherwise. */
function paceBounds(s: RidePlanStep, plan: RidePlan): StepBounds | null {
  if (!runOutdoorText(s, plan.thresholds, plan.surface ?? "road").main?.endsWith(" /km")) return null;
  const t = [mainTarget(s.step), s.step.target2].find((x) => x?.metric === "pace");
  if (!t) return null;
  const r = resolveTarget(t, "run", plan.thresholds);
  if (r.low === null && r.high === null) return null;
  const lo = r.low !== null && r.high !== null ? Math.min(r.low, r.high) : r.low;
  const hi = r.low !== null && r.high !== null ? Math.max(r.low, r.high) : r.high;
  return { series: "speed", low: lo, high: hi };
}

/** "Distance from the belt": where the run's distance comes from (4.9). */
function distanceSource(logs: StepLog[], beltEvents: boolean): string | null {
  const sources = new Set(logs.filter((l) => l.distanceMeters !== null).map((l) => l.sources?.distanceMeters ?? "typed"));
  if (!sources.size) return null;
  if (sources.size === 1 && sources.has("belt") && !beltEvents) return "Distance from the plan · no belt changes";
  const words = { belt: "the belt", garmin: "Garmin", typed: "typed numbers", assistant: "the assistant", clock: "the clock" } as const;
  const list = (["belt", "garmin", "typed", "assistant", "clock"] as const).filter((k) => sources.has(k)).map((k) => words[k]);
  return `Distance from ${list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0]}`;
}

/**
 * The summary of a run. `beltEvents`: the runner tapped the belt or incline
 * (else the belt distance is the plan's, 4.4). `stream`: the Garmin stream's
 * numbers (4.9): time in zones from the 1 s stream, drift, time on target,
 * and outdoors the GAP, IF and load from it, and the chart.
 */
export function runSummary(plan: RidePlan, logs: Record<number, RunStepLog>, opts: { beltEvents: boolean; stream?: RunStreamView | null }): RunSummary {
  const th = plan.thresholds;
  const treadmill = plan.mode === "indoor";
  const { steps } = runResultRows(plan, logs);
  const effort = rideEffort(steps);
  // Totals count the run time and distance of skipped steps too (4.7).
  const ranLogs = steps.map((s) => s.log as RunStepLog | null).filter((l): l is RunStepLog => ran(l));
  const stream = opts.stream?.numbers ?? null;
  const fromSteps = doneRunNumbers(
    ranLogs.map((l) => ({ seconds: l.durationSeconds ?? 0, meters: l.distanceMeters, inclinePct: treadmill ? (l.inclinePercent ?? null) : null, avgHr: l.avgHr })),
    { thresholdSpeed: th.run_threshold_pace, lthr: th.lthr_run, rpe: effort, treadmill, surface: plan.surface ?? null },
  );
  // Outdoors the stream gives GAP and, when it has a pace load, the load (4.9); a treadmill's come from the belt.
  const numbers: DoneRunNumbers = {
    ...fromSteps,
    ...(stream?.gapSPerKm != null && { gapSPerKm: stream.gapSPerKm }),
    ...(stream?.load != null && { load: { value: stream.load, method: "pace" as const, estimated: true as const }, intensityFactor: stream.intensityFactor }),
    ...(stream && th.lthr_run && { hrZoneMinutes: stream.hrZoneMinutes }),
  };

  const tiles: RunTile[] = [{ label: "Time", value: rideClock(numbers.seconds) }];
  if (numbers.meters) tiles.push({ label: "Distance", value: `${(numbers.meters / 1000).toFixed(1)} km` });
  if (numbers.paceSPerKm !== null) {
    const pace = paceText(numbers.paceSPerKm);
    const gap = numbers.gapSPerKm !== null ? paceText(numbers.gapSPerKm) : pace;
    tiles.push({ label: "Pace", value: pace, ...(gap !== pace && { sub: `GAP ${gap.replace(/ \/km$/, "")}` }) });
  }
  if (numbers.avgHr !== null) tiles.push({ label: "Avg HR", value: `${Math.round(numbers.avgHr)}` });
  // A load that rounds to 0 (a run of seconds) says nothing.
  if (numbers.load && Math.round(numbers.load.value) > 0) tiles.push({ label: "Load", value: `${Math.round(numbers.load.value)}`, est: true });
  if (stream?.drift) tiles.push({ label: "Drift", value: `${Math.round(stream.drift.pct)}%`, ...(stream.drift.steady && { sub: "steady" }) });
  if (effort !== null) tiles.push({ label: "Effort", value: `${effort}` });

  const rowOf = runRowOfStep(plan);
  const rows: RunSummaryRow[] = [];
  plan.steps.forEach((s, i) => {
    if (rows.length > rowOf[i]) return;
    const block = s.run?.block ?? null;
    if (block) {
      const work = plan.steps.filter((p) => p.run?.block === block && p.step.type === "work");
      const ranReps = work.filter((p) => done(logs[p.programSetId] ?? null)).length;
      const any = plan.steps.some((p) => p.run?.block === block && logs[p.programSetId]);
      rows.push({
        key: block,
        title: "Strides",
        plan: `${work.length} × ${work[0]?.seconds ?? work[0]?.estSeconds ?? 0} s`,
        done: any ? `${ranReps} of ${work.length}` : "Not run",
        mark: null,
        quiet: !any || ranReps === 0,
        onTarget: null,
      });
      return;
    }
    const log = logs[s.programSetId] ?? null;
    const text = doneText(log, plan.mode);
    const quiet = text === "Skipped" || text === "Not run";
    rows.push({ key: s.key, title: steps[i].title, plan: planText(s, plan), done: text, mark: markOf(s, log, plan), quiet, onTarget: quiet ? null : (stream?.onTarget[s.programSetId] ?? null) });
  });
  const caps = plan.steps.some((s) => hrBand(hrTextOf(s, plan))?.cap);
  const footnote = `${treadmill ? "km/h" : "Pace /km"} · HR.${caps ? " Under an easy cap is a pass." : ""}`;

  const hasNumber = (l: StepLog) => [l.avgHr, l.maxHr, l.avgCadence, l.climbM].some((v) => v !== null) || (l.distanceMeters !== null && l.sources?.distanceMeters !== "belt");
  const runSteps = ranLogs.filter((l) => l.status !== "skipped");
  const load = numbers.load;
  return {
    numbers,
    tiles,
    distanceLine: distanceSource(runSteps, opts.beltEvents),
    zones: th.lthr_run ? numbers.hrZoneMinutes.map((m, i) => ({ zone: i + 1, m })).filter((z) => z.m > 0) : [],
    chart: opts.stream?.chart ?? null,
    treadmill,
    rows,
    footnote,
    effort,
    planOnly: runSteps.length > 0 && effort === null && !opts.beltEvents && !runSteps.some(hasNumber),
    noLoadReason: runSteps.length === 0 ? null : load === null ? "numbers" : Math.round(load.value) === 0 ? "short" : null,
  };
}

/** "Brick · ride 60:00 · T2 1:12 · run 40:00" (section 5 "Summary"); T2 only when it shows (4.7). */
export function brickText(b: { rideSeconds: number; t2Seconds: number | null }, runSeconds: number): string {
  return ["Brick", `ride ${rideClock(b.rideSeconds)}`, b.t2Seconds !== null ? `T2 ${rideClock(b.t2Seconds)}` : null, `run ${rideClock(runSeconds)}`].filter(Boolean).join(" · ");
}
