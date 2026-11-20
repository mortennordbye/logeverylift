/**
 * A run against its Garmin activity (docs/plans/run-logger.md, 4.8 and 4.9):
 * the step values the fill writes, and the numbers only a 1 s stream gives:
 * outdoor grade-adjusted pace (GAP), IF and load from the stream, time in
 * heart rate zones, time on target per step, decoupling, and the plan
 * against done chart.
 *
 * - GAP outdoors: speed and grade from the `distance` and `altitude` streams
 *   over 30 s, then `gapSpeed` (Minetti 2002). The Garmin stream has no GAP.
 * - Load: per step, hours x IF^2 x 100 with IF = GAP speed / threshold speed,
 *   summed. None on Trail or snow or without a threshold pace (4.9).
 * - Decoupling (Friel Pa:HR): steady steps only (a work step in no repeat and
 *   no strides block) that together run 45 min or more, with the first 10 min
 *   of the run left out, as are Garmin's pauses. Two halves by time,
 *   efficiency = GAP speed / avg HR. On a treadmill the speed is the belt's
 *   (each belt span counts for its time).
 *
 * Pure: the run's Garmin view, the summary and get_ride call it.
 */

import type { RideMode } from "@/db/schema/rides";
import { sampleDurations } from "@/lib/garmin/analytics/load";
import { CHART } from "@/lib/utils/bike-ride-view";
import {
  DRIFT_STEADY_PCT,
  sampleIndices,
  streamToActive,
  weightedMean,
  windowValues,
  type DoneChart,
  type RideDrift,
  type RideSplit,
  type RideStreams,
  type StepWindow,
  type WindowValues,
} from "@/lib/utils/ride-stream";
import type { RideEventInput, RidePlan, RideStepResult } from "@/lib/utils/ride-timeline";
import { gapSpeed } from "@/lib/utils/run-gap";
import { minSec } from "@/lib/utils/thresholds";
import { IF_RANGE } from "@/lib/utils/training-load";
import { runHrZoneOf } from "@/lib/utils/workout-steps";

type Series = (number | null)[];

/** Speed and grade are read over this many seconds (4.9). */
export const SMOOTH_S = 30;
/** Decoupling needs steady steps of this many seconds (4.9). */
export const DECOUPLING_MIN_S = 45 * 60;
/** The first part of the run decoupling leaves out (4.9). */
export const DECOUPLING_SKIP_S = 10 * 60;
/** Under this many meters in the smoothing span, the grade counts as flat. */
const GRADE_MIN_M = 5;

/**
 * One run step's values from the stream (4.8): heart rate as the bike's,
 * cadence doubled to steps per minute (Garmin's FIT cadence of a run is per
 * foot, as the Garmin charts show it), distance and speed from the stream,
 * never power (R11); on a treadmill no climbing.
 */
export function runWindowValues(streams: RideStreams, w: StepWindow, mode: RideMode, d = sampleDurations(streams.t)): WindowValues {
  const v = windowValues(streams, w, "outdoor", d);
  const idx = sampleIndices(streams.t, w);
  const cadence = weightedMean(streams.cadence, idx, d, (c) => c > 0);
  const out = { ...v, avgPower: null, avgCadence: cadence === null ? null : Math.round(cadence * 2), climbM: mode === "indoor" ? null : v.climbM };
  // The distance the step ran: from the last sample before it, so steps one after the other add up to the run.
  const dist = streams.distance;
  const last = [...idx].reverse().find((i) => dist?.[i] != null);
  if (dist && last !== undefined && idx.length) {
    const before = idx[0] - 1;
    const near = before >= 0 && dist[before] != null && d[before] > 0;
    const from = near ? before : idx.find((i) => dist[i] != null)!;
    const meters = (dist[last] as number) - (dist[from] as number);
    const moving = idx.reduce((a, i) => a + d[i], 0);
    out.distanceMeters = Math.round(meters);
    out.avgSpeed = moving > 0 ? Math.round((meters / moving) * 100) / 100 : null;
  }
  return out;
}

/** The belt and incline from `from` to `to` (epoch ms) of a treadmill run; km/h null by feel. */
export type BeltSpan = { from: number; to: number; kmh: number | null; incline: number | null };

/**
 * The belt and incline over the run, from each step's frozen belt and the
 * belt and incline events the timeline counts in it (its own step key, inside
 * the step). The incline carries over from step to step unless a step has its
 * own (4.2).
 */
export function beltSpans(plan: RidePlan, steps: Pick<RideStepResult, "index" | "key" | "startedAt" | "endedAt">[], events: RideEventInput[]): BeltSpan[] {
  const out: BeltSpan[] = [];
  let incline: number | null = null;
  for (const r of steps) {
    const p = plan.steps[r.index]?.run;
    let kmh = p?.belt != null ? p.belt / 10 : null;
    if (p?.incline != null) incline = p.incline / 10;
    let from = r.startedAt;
    const mine = events
      .filter((e) => (e.kind === "belt" || e.kind === "incline") && e.value != null && e.at >= r.startedAt && e.at < r.endedAt && (!e.stepKey || e.stepKey === r.key))
      .sort((a, b) => a.at - b.at);
    for (const e of mine) {
      if (e.at > from) out.push({ from, to: e.at, kmh, incline });
      from = Math.max(from, e.at);
      if (e.kind === "belt") kmh = e.value! / 10;
      else incline = e.value! / 10;
    }
    if (r.endedAt > from) out.push({ from, to: r.endedAt, kmh, incline });
  }
  return out;
}

/** A step's target as the runner saw it, for time on target: pace as speed (m/s) or heart rate; null when open. */
export type StepBounds = { series: "speed" | "hr"; low: number | null; high: number | null };

export type RunStreamNumbers = {
  /** Moving seconds of the run's steps in the stream. */
  seconds: number;
  /** Grade-adjusted pace outdoors, seconds per km; null on a treadmill (the belt gives it) or without distance. */
  gapSPerKm: number | null;
  intensityFactor: number | null;
  /** Outdoors: per step hours x IF^2 x 100 from the stream's GAP; null on a treadmill, on Trail or snow, without a threshold pace, or out of range. */
  load: number | null;
  /** Minutes per Friel run heart rate zone (5) from the 1 s stream; all 0 without heart rate or a run LTHR. */
  hrZoneMinutes: number[];
  drift: RideDrift | null;
  /** Percent of each step's seconds inside its target, by program set; null when the step has none. */
  onTarget: Record<number, number | null>;
};

export type RunStreamInput = {
  streams: RideStreams;
  /** Stream time 0, epoch ms. */
  t0Ms: number;
  split: RideSplit;
  plan: RidePlan;
  /** A treadmill run's belt over time (`beltSpans`). */
  belts: BeltSpan[] | null;
  /** Per program set: the step's target as shown (`runStepBounds`). */
  bounds: Record<number, StepBounds | null>;
};

/**
 * Speed (m/s) and grade (%) of each sample over the 30 s around it, from the
 * distance and altitude streams; the speed stream where there is no distance.
 * Null where neither gives one.
 */
export function smoothedSpeedGrade(streams: RideStreams): { speed: Series; grade: Series } {
  const { t, distance: dist, altitude: alt } = streams;
  const half = SMOOTH_S / 2;
  const speed: Series = t.map((ti, i) => (ti === null ? null : (streams.speed?.[i] ?? null)));
  const grade: Series = t.map((ti) => (ti === null ? null : 0));
  // The samples with a time and a distance, in time order (the stream is).
  const valid = t.flatMap((ti, i) => (ti !== null && dist?.[i] != null ? [i] : []));
  let lo = 0;
  let hi = 0;
  for (let k = 0; k < valid.length; k++) {
    const tk = t[valid[k]] as number;
    while ((t[valid[lo]] as number) < tk - half) lo++;
    while (hi + 1 < valid.length && (t[valid[hi + 1]] as number) <= tk + half) hi++;
    const a = valid[lo];
    const b = valid[hi];
    const dt = (t[b] as number) - (t[a] as number);
    const dd = (dist![b] as number) - (dist![a] as number);
    if (dt > 0) speed[valid[k]] = Math.max(0, dd / dt);
    const da = alt?.[a] != null && alt?.[b] != null ? (alt[b] as number) - (alt[a] as number) : null;
    grade[valid[k]] = da !== null && dd >= GRADE_MIN_M ? (da / dd) * 100 : 0;
  }
  return { speed, grade };
}

/** The belt span a stream second falls in. */
function spanAt(belts: BeltSpan[], ms: number): BeltSpan | null {
  return belts.find((b) => ms >= b.from && ms < b.to) ?? null;
}

/** The GAP speed (m/s) of each sample: the belt's on a treadmill, the smoothed stream outdoors. */
function gapSeries(input: RunStreamInput, smooth: { speed: Series; grade: Series }): Series {
  const { streams, t0Ms, belts, plan } = input;
  if (plan.mode === "indoor") {
    return streams.t.map((ti) => {
      if (ti === null || !belts) return null;
      const b = spanAt(belts, t0Ms + ti * 1000);
      return b?.kmh ? gapSpeed(b.kmh / 3.6, b.incline, true) : null;
    });
  }
  return smooth.speed.map((v, i) => (v === null ? null : gapSpeed(v, smooth.grade[i], false)));
}

/** The steady steps of decoupling: a work step in no repeat and no strides block (4.9). */
function steadyWindows(plan: RidePlan, windows: StepWindow[]): StepWindow[] {
  const byId = new Map(plan.steps.map((s) => [s.programSetId, s]));
  return windows.filter((w) => {
    const s = byId.get(w.programSetId);
    return !!s && s.step.type === "work" && s.round === null && !s.run?.block;
  });
}

/**
 * Decoupling over the steady samples: two halves by time, efficiency = mean
 * GAP speed / mean heart rate, drift = (first - second) / first x 100.
 */
export function decoupling(input: RunStreamInput, gap: Series, d = sampleDurations(input.streams.t)): RideDrift | null {
  const { streams, split, plan } = input;
  const steady = steadyWindows(plan, split.windows);
  const steadySeconds = steady.reduce((a, w) => a + sampleIndices(streams.t, w).reduce((x, i) => x + d[i], 0), 0);
  if (!streams.hr || steadySeconds < DECOUPLING_MIN_S || !split.windows.length) return null;
  const a0 = streamToActive(split.windows[0].from, split.pauses);
  const idx = steady
    .flatMap((w) => sampleIndices(streams.t, w))
    .filter((i) => d[i] > 0 && gap[i] !== null && (streams.hr![i] ?? 0) > 0 && streamToActive(streams.t[i] as number, split.pauses) - a0 >= DECOUPLING_SKIP_S)
    .sort((x, y) => (streams.t[x] as number) - (streams.t[y] as number));
  const total = idx.reduce((a, i) => a + d[i], 0);
  if (total <= 0) return null;
  let acc = 0;
  const halves: [number[], number[]] = [[], []];
  for (const i of idx) {
    halves[acc < total / 2 ? 0 : 1].push(i);
    acc += d[i];
  }
  const ef = (h: number[]) => {
    const v = weightedMean(gap, h, d);
    const hr = weightedMean(streams.hr, h, d);
    return v !== null && hr ? v / hr : null;
  };
  const first = ef(halves[0]);
  const second = ef(halves[1]);
  if (!first || second === null) return null;
  const pct = Math.round(((first - second) / first) * 1000) / 10;
  return { pct, steady: pct < DRIFT_STEADY_PCT, efFirst: Math.round(first * 100000) / 100000, efSecond: Math.round(second * 100000) / 100000 };
}

/** The numbers of 4.9 from the stream, over the run's own step windows. */
export function runStreamNumbers(input: RunStreamInput): RunStreamNumbers {
  const { streams, split, plan, bounds } = input;
  const th = plan.thresholds;
  const d = sampleDurations(streams.t);
  const smooth = smoothedSpeedGrade(streams);
  const gap = gapSeries(input, smooth);
  const treadmill = plan.mode === "indoor";
  const lthr = th.lthr_run ?? null;
  const thr = th.run_threshold_pace && th.run_threshold_pace > 0 ? th.run_threshold_pace : null;

  let seconds = 0;
  let gapMeters = 0;
  let gapSeconds = 0;
  let if2Seconds = 0;
  const zoneSeconds = [0, 0, 0, 0, 0];
  const onTarget: Record<number, number | null> = {};
  for (const w of split.windows) {
    const idx = sampleIndices(streams.t, w);
    const secs = idx.reduce((a, i) => a + d[i], 0);
    seconds += secs;
    const g = weightedMean(gap, idx, d);
    if (!treadmill && g !== null) {
      const covered = idx.reduce((a, i) => a + (gap[i] !== null ? d[i] : 0), 0);
      gapMeters += g * covered;
      gapSeconds += covered;
      if (thr) if2Seconds += secs * (g / thr) ** 2;
    }
    if (lthr && streams.hr) for (const i of idx) if ((streams.hr[i] ?? 0) > 0 && d[i]) zoneSeconds[runHrZoneOf(((streams.hr[i] as number) / lthr) * 100) - 1] += d[i];
    const b = bounds[w.programSetId] ?? null;
    const series = b?.series === "hr" ? streams.hr : b?.series === "speed" && !treadmill ? smooth.speed : null;
    if (!b || !series) {
      onTarget[w.programSetId] = null;
      continue;
    }
    let inside = 0;
    let counted = 0;
    for (const i of idx) {
      const v = series[i];
      if (v === null || v === undefined || !d[i] || (b.series === "hr" && v <= 0)) continue;
      counted += d[i];
      if ((b.low === null || v >= b.low) && (b.high === null || v <= b.high)) inside += d[i];
    }
    onTarget[w.programSetId] = counted > 0 ? Math.round((inside / counted) * 100) : null;
  }

  let intensityFactor: number | null = null;
  let load: number | null = null;
  if (!treadmill && thr && plan.surface !== "trail" && seconds > 0 && gapSeconds > 0) {
    const ifRun = Math.sqrt(if2Seconds / seconds);
    if (ifRun >= IF_RANGE.min && ifRun <= IF_RANGE.max) {
      intensityFactor = ifRun;
      load = (if2Seconds / 3600) * 100;
    }
  }
  return {
    seconds,
    gapSPerKm: !treadmill && gapMeters > 0 ? gapSeconds / (gapMeters / 1000) : null,
    intensityFactor,
    load,
    hrZoneMinutes: zoneSeconds.map((z) => Math.round(z / 60)),
    drift: decoupling(input, gap, d),
    onTarget,
  };
}

// ── Plan against done ────────────────────────────────────────────────────────

const BINS = 120;

/**
 * The plan-against-done chart of a run (section 5, "Summary"), in the bike
 * chart's shape (`DoneChart`, its `power` line holding the speed): the
 * plan's pace (outdoors) or frozen belt (treadmill) as bands, the done speed
 * as the line (the belt on a treadmill, Garmin's 30 s speed outdoors), and
 * heart rate dashed on a scale of its own. The scale is km/h on a treadmill
 * and pace outdoors. Null without speed and heart rate.
 */
export function runDoneChart(input: RunStreamInput): DoneChart | null {
  const { streams, split, plan, bounds, belts, t0Ms } = input;
  const { t } = streams;
  const treadmill = plan.mode === "indoor";
  const smooth = treadmill ? null : smoothedSpeedGrade(streams);
  const kmhOf = (i: number): number | null => {
    const ti = t[i];
    if (ti === null) return null;
    if (treadmill) {
      const b = belts ? spanAt(belts, t0Ms + ti * 1000) : null;
      return b?.kmh ?? null;
    }
    const v = smooth!.speed[i];
    return v === null ? null : v * 3.6;
  };
  const hasHr = !!streams.hr?.some((h) => h !== null && h > 0);
  const inRun = new Set(split.windows.flatMap((w) => sampleIndices(t, w)));
  const hasSpeed = [...inRun].some((i) => kmhOf(i) !== null);
  if ((!hasSpeed && !hasHr) || !split.windows.length) return null;

  const { left, right, base, top } = CHART;
  const span = right - left;
  const a0 = streamToActive(split.windows[0].from, split.pauses);
  const a1 = streamToActive(split.windows.at(-1)!.to, split.pauses);
  const total = Math.max(1, a1 - a0);
  const x = (active: number) => +(left + ((active - a0) / total) * span).toFixed(1);
  const d = sampleDurations(t);
  const bins = Math.max(2, Math.min(BINS, Math.ceil(total / 30)));
  const binOf = (ti: number) => Math.floor(((streamToActive(ti, split.pauses) - a0) / total) * bins);
  const mean = (value: (i: number) => number | null) => {
    const sum = new Array<number>(bins).fill(0);
    const secs = new Array<number>(bins).fill(0);
    for (const i of inRun) {
      const v = value(i);
      const ti = t[i];
      if (ti === null || v === null || !d[i]) continue;
      const b = binOf(ti);
      if (b < 0 || b >= bins) continue;
      sum[b] += v * d[i];
      secs[b] += d[i];
    }
    return sum.map((s, b) => (secs[b] > 0 ? s / secs[b] : null));
  };
  const sBins = hasSpeed ? mean(kmhOf) : null;
  const hBins = hasHr ? mean((i) => (streams.hr![i] ?? 0) > 0 ? (streams.hr![i] as number) : null) : null;

  // The plan: pace ranges outdoors, the frozen belt (with the 0.25 km/h a pace belt rounds to) on a treadmill.
  const byId = new Map(plan.steps.map((s) => [s.programSetId, s]));
  const planBands = split.windows
    .map((w) => {
      if (treadmill) {
        const belt = byId.get(w.programSetId)?.run?.belt;
        return belt != null ? { w, lo: belt / 10 - 0.25, hi: belt / 10 + 0.25 } : null;
      }
      const b = bounds[w.programSetId];
      if (b?.series !== "speed" || (b.low === null && b.high === null)) return null;
      return { w, lo: (b.low ?? 0) * 3.6, hi: (b.high ?? (b.low as number) * 1.1) * 3.6 };
    })
    .filter((b): b is { w: StepWindow; lo: number; hi: number } => b !== null);
  const values = [...(sBins ?? []).filter((v): v is number => v !== null), ...planBands.flatMap((b) => [b.lo, b.hi])];
  const vMax = Math.max(...values, 8) * 1.08;
  const vMin = Math.max(0, Math.min(...values, vMax / 2) * 0.85);
  const y = (v: number) => +(base - ((Math.min(Math.max(v, vMin), vMax) - vMin) / (vMax - vMin)) * (base - top)).toFixed(1);

  const binX = (b: number) => +(left + ((b + 0.5) / bins) * span).toFixed(1);
  const line = (vals: (number | null)[] | null, yOf: (v: number) => number) =>
    vals
      ? vals
          .map((v, b) => (v === null ? null : `${binX(b)},${yOf(v).toFixed(1)}`))
          .filter(Boolean)
          .join(" ") || null
      : null;

  const bands: DoneChart["bands"] = planBands.map(({ w, lo, hi }) => {
    const bx = x(streamToActive(w.from, split.pauses));
    const bw = Math.max(1, x(streamToActive(w.to, split.pauses)) - bx - 0.8);
    return { key: w.programSetId, x: bx, w: +bw.toFixed(1), y: y(hi), h: Math.max(1.5, +(y(lo) - y(hi)).toFixed(1)) };
  });

  const hrVals = (hBins ?? []).filter((v): v is number => v !== null);
  const hrTop = Math.max(...hrVals, 120) + 45;
  const hrLow = Math.max(0, Math.min(...hrVals, 100) - 45);
  const yH = (h: number) => base - ((h - hrLow) / (hrTop - hrLow)) * (base - top);
  const hr = line(hBins, yH);
  const hrIdx = [...inRun];
  const avgHr = weightedMean(streams.hr, hrIdx, d, (v) => v > 0);
  const lastHr = [...(hBins ?? [])].reverse().find((v) => v !== null) ?? null;

  // km/h on a treadmill; whole-minute paces outdoors.
  const yTicks: DoneChart["yTicks"] = [];
  if (hasSpeed || planBands.length) {
    if (treadmill) for (let k = Math.ceil(vMin / 2) * 2; k < vMax * 0.95; k += 2) yTicks.push({ y: y(k), label: `${k}` });
    else
      for (let m = 3; m <= 12; m++) {
        const kmh = 60 / m;
        if (kmh > vMin && kmh < vMax * 0.95) yTicks.push({ y: y(kmh), label: minSec(m * 60) });
      }
  }
  const minutes = total / 60;
  const every = minutes <= 90 ? 15 : minutes <= 180 ? 30 : 60;
  const xTicks: DoneChart["xTicks"] = [];
  for (let m = 0; m <= minutes - every / 2; m += every) xTicks.push({ x: +(left + ((m * 60) / total) * span).toFixed(1), label: `${m}` });
  xTicks.push({ x: right, label: `${Math.round(minutes)} min` });

  return {
    bands,
    power: line(sBins, y),
    hr,
    hrLabel: hr && avgHr !== null && lastHr !== null ? { x: right, y: +(yH(lastHr) - 4).toFixed(1), text: `HR ${Math.round(avgHr)}` } : null,
    ftpY: null,
    yTicks,
    xTicks,
  };
}
