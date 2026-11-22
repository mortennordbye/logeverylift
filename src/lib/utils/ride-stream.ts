/**
 * A ride against its Garmin activity (docs/plans/bike-ride-logger.md, 4.6 and
 * 4.8): which part of the activity's streams belongs to which step, the step
 * averages the fill writes, and the numbers only a 1 s stream gives (NP, IF,
 * load, kJ, time in zones, time on target, heart rate drift), plus the
 * plan-against-done chart.
 *
 * Stream time `t` is seconds from the activity's first record, on the wall
 * clock: Garmin stops recording while its timer is stopped, so its timer
 * pauses (and auto-pauses) are gaps in `t`, never a shift.
 *
 * Pure: the fill, the summary and get_ride call it.
 */

import { climbMeters } from "@/lib/garmin/analytics/decoupling";
import { normalizedPower, powerLoad, sampleDurations } from "@/lib/garmin/analytics/load";
import { CHART, timeTicks } from "@/lib/utils/bike-ride-view";
import { bikeHrZone, powerZone } from "@/lib/utils/bike-outdoor";
import type { RideMode } from "@/db/schema/rides";
import type { RidePlanStep } from "@/lib/utils/ride-timeline";

type Series = (number | null)[];

export type RideStreams = { t: Series; power?: Series; hr?: Series; cadence?: Series; speed?: Series; distance?: Series; altitude?: Series; lat?: Series };
/** The FIT lap and timer event fields this file reads (src/lib/garmin/fit.ts keeps them as plain JSON). */
export type FitLap = { startTime?: unknown; totalElapsedTime?: unknown; totalTimerTime?: unknown };
export type FitEvent = { timestamp?: unknown; eventType?: unknown };

/** A step of the ride's timeline: its program set, the seconds ridden (pauses left out), and when it started and ended (epoch ms). */
export type SplitStep = { programSetId: number; activeSeconds: number; startedAt: number; endedAt: number };
/** A step's part of the activity, in stream seconds: from (inclusive) to (exclusive), less the rider's pauses in it (`gaps`). */
export type StepWindow = { programSetId: number; from: number; to: number; gaps?: [number, number][] };
/** `pauses`, in stream seconds, are left out of the chart's time axis: Garmin's timer pauses for a lap split, the rider's pauses in the app for a time split. */
export type RideSplit = { method: "laps" | "time"; windows: StepWindow[]; pauses: [number, number][] };

/** A lap may differ this much from its step's ridden time and still split the ride (4.8). */
export const LAP_TOLERANCE = 0.1;
/** Drift needs a ride this long (4.6). */
export const DRIFT_MIN_S = 3600;
/** Drift under this is "steady". */
export const DRIFT_STEADY_PCT = 5;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ms = (v: unknown) => (typeof v === "string" ? Date.parse(v) : typeof v === "number" ? v : NaN);

/** Garmin's timer pauses as [stop, start] in stream seconds, from its timer events. */
export function timerPauses(events: FitEvent[], t0Ms: number): [number, number][] {
  const out: [number, number][] = [];
  let stoppedAt: number | null = null;
  const sorted = events.map((e) => ({ at: ms(e.timestamp), type: String(e.eventType ?? "") })).filter((e) => Number.isFinite(e.at)).sort((a, b) => a.at - b.at);
  for (const e of sorted) {
    const s = (e.at - t0Ms) / 1000;
    if (e.type.startsWith("stop") && stoppedAt === null) stoppedAt = s;
    else if (e.type === "start" && stoppedAt !== null) {
      if (s > stoppedAt) out.push([stoppedAt, s]);
      stoppedAt = null;
    }
  }
  return out;
}

/** Stream seconds to active seconds: the pauses before it, and the part of one it falls in, are left out. */
export function streamToActive(t: number, pauses: [number, number][]): number {
  let a = t;
  for (const [s, e] of pauses) if (s < t) a -= Math.min(e, t) - s;
  return a;
}

/**
 * Split the activity into the ride's steps (4.8). By Garmin's laps when there
 * is one lap per ridden step and each lap's timer time is within 10% of the
 * step's ridden time; else by the wall clock: each step's own start and end
 * from the ride's timeline, less the rider's pauses in the app (`ridePauses`,
 * epoch ms). So a watch started before the app, Garmin's auto-pause or a
 * second ride in the same activity never shift a step. A step with no ridden
 * time gets no window.
 */
export function splitRide(steps: SplitStep[], laps: FitLap[], events: FitEvent[], t0Ms: number, ridePauses: [number, number][] = []): RideSplit {
  const ridden = steps.filter((s) => s.activeSeconds > 0);
  const lapTimes = laps.map((l) => ({ start: ms(l.startTime), elapsed: num(l.totalElapsedTime), timer: num(l.totalTimerTime) ?? num(l.totalElapsedTime) }));
  const lapsFit =
    ridden.length > 0 &&
    lapTimes.length === ridden.length &&
    lapTimes.every((l, i) => Number.isFinite(l.start) && l.elapsed !== null && l.timer !== null && Math.abs(l.timer - ridden[i].activeSeconds) <= LAP_TOLERANCE * ridden[i].activeSeconds);
  if (lapsFit) {
    return {
      method: "laps",
      windows: ridden.map((s, i) => {
        const from = (lapTimes[i].start - t0Ms) / 1000;
        return { programSetId: s.programSetId, from, to: from + lapTimes[i].elapsed! };
      }),
      pauses: timerPauses(events, t0Ms),
    };
  }
  const sec = (ms: number) => (ms - t0Ms) / 1000;
  const pauses = ridePauses.map(([a, b]) => [sec(a), sec(b)] as [number, number]);
  const windows: StepWindow[] = ridden.map((s) => {
    const from = sec(s.startedAt);
    const to = sec(s.endedAt);
    const gaps = pauses.filter(([a, b]) => b > from && a < to).map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number]);
    return { programSetId: s.programSetId, from, to, ...(gaps.length && { gaps }) };
  });
  return { method: "time", windows, pauses };
}

/** The streams cut to [from, to) stream seconds: a ride's numbers come from its own part of the activity. */
export function clipStreams(streams: RideStreams, from: number, to: number): RideStreams {
  const keep = streams.t.map((ti) => ti !== null && ti >= from && ti < to);
  const out: RideStreams = { t: [] };
  for (const [k, v] of Object.entries(streams) as [keyof RideStreams, Series | undefined][]) if (v) out[k] = v.filter((_, i) => keep[i]);
  return out;
}

/** The sample indices inside a window, outside its gaps. */
function indices(t: Series, w: { from: number; to: number; gaps?: [number, number][] }): number[] {
  const out: number[] = [];
  t.forEach((ti, i) => {
    if (ti !== null && ti >= w.from && ti < w.to && !w.gaps?.some(([a, b]) => ti >= a && ti < b)) out.push(i);
  });
  return out;
}

/** The sample indices inside a window, outside its gaps (the run numbers read them too). */
export const sampleIndices = (t: Series, w: { from: number; to: number; gaps?: [number, number][] }): number[] => indices(t, w);

/** Time-weighted mean of a series over samples; `keep` picks the values that count. */
export function weightedMean(series: Series | undefined, idx: number[], d: number[], keep: (v: number) => boolean = () => true): number | null {
  if (!series) return null;
  let sum = 0;
  let secs = 0;
  for (const i of idx) {
    const v = series[i];
    if (v === null || v === undefined || !keep(v) || !d[i]) continue;
    sum += v * d[i];
    secs += d[i];
  }
  return secs > 0 ? sum / secs : null;
}

export type WindowValues = {
  avgPower: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  /** m/s */
  avgSpeed: number | null;
  distanceMeters: number | null;
  climbM: number | null;
};

/**
 * One step's numbers from the streams: power with its zeros (coasting is
 * riding), heart rate and cadence without zeros, as Garmin's own averages.
 * Speed is the window's distance over its moving time. Indoors no distance,
 * speed or climbing (D12).
 */
export function windowValues(streams: RideStreams, w: StepWindow | { from: number; to: number }, mode: RideMode, d = sampleDurations(streams.t)): WindowValues {
  const idx = indices(streams.t, w);
  const round = (v: number | null) => (v === null ? null : Math.round(v));
  const hrs = streams.hr ? idx.map((i) => streams.hr![i]).filter((v): v is number => v !== null && v > 0) : [];
  const out: WindowValues = {
    avgPower: round(weightedMean(streams.power, idx, d, (v) => v >= 0)),
    avgHr: round(weightedMean(streams.hr, idx, d, (v) => v > 0)),
    maxHr: hrs.length ? Math.max(...hrs) : null,
    avgCadence: round(weightedMean(streams.cadence, idx, d, (v) => v > 0)),
    avgSpeed: null,
    distanceMeters: null,
    climbM: null,
  };
  if (mode === "outdoor") {
    const dist = streams.distance ? idx.map((i) => streams.distance![i]).filter((v): v is number => v !== null) : [];
    const moving = idx.reduce((a, i) => a + d[i], 0);
    if (dist.length >= 2) {
      const meters = dist.at(-1)! - dist[0];
      out.distanceMeters = Math.round(meters);
      out.avgSpeed = moving > 0 ? Math.round((meters / moving) * 100) / 100 : null;
    } else {
      const s = weightedMean(streams.speed, idx, d, (v) => v >= 0);
      out.avgSpeed = s === null ? null : Math.round(s * 100) / 100;
    }
    const alt = streams.altitude ? idx.map((i) => streams.altitude![i]).filter((v): v is number => v !== null) : [];
    if (alt.length >= 2) out.climbM = Math.round(climbMeters(alt));
  }
  return out;
}

// ── Numbers from the stream ──────────────────────────────────────────────────

export type RideDrift = { pct: number; steady: boolean; efFirst: number; efSecond: number };

export type StreamNumbers = {
  /** Moving seconds of the activity. */
  seconds: number;
  avgPower: number | null;
  np: number | null;
  intensityFactor: number | null;
  load: number | null;
  kj: number | null;
  /** Minutes per Coggan power zone (7), index 0 is zone 1; all 0 without power or an FTP. */
  powerZoneMinutes: number[];
  /** Minutes per Friel bike heart rate zone (5); all 0 without heart rate or a bike LTHR. */
  hrZoneMinutes: number[];
  drift: RideDrift | null;
  /** Percent of each step's seconds inside its target, by program set: power indoors, heart rate outdoors. */
  onTarget: Record<number, number | null>;
  /** The best rolling 60 s mean power inside the work steps' windows (an FTP ramp test, 4.9); null without a minute of it. */
  best60sPower: number | null;
  /** Each step's window average power, by program set (an FTP 20 min test, 4.9). */
  stepPower: Record<number, number | null>;
};

/** The best 60 s of power over the samples of the work steps' windows only, so a sprint in a warm-up does not count. */
function workBest60s(streams: RideStreams, windows: StepWindow[], byId: Map<number, PlanStepLike>): number | null {
  const keep = new Set(windows.filter((w) => byId.get(w.programSetId)?.step.type === "work").flatMap((w) => indices(streams.t, w)));
  if (!keep.size) return null;
  const idx = [...keep].sort((a, b) => a - b);
  return bestRollingPower(
    idx.map((i) => streams.t[i]),
    idx.map((i) => streams.power![i]),
  );
}

/**
 * The best mean power over `seconds` in a row: the samples are held for their
 * duration as 1 s values (gaps over 10 s count nothing, as in NP). Null with
 * less data than the window.
 */
export function bestRollingPower(t: Series, power: Series, seconds = 60): number | null {
  const d = sampleDurations(t);
  const perSecond: number[] = [];
  power.forEach((p, i) => {
    for (let k = 0; k < d[i]; k++) perSecond.push(p !== null && p > 0 ? p : 0);
  });
  if (perSecond.length < seconds) return null;
  let sum = 0;
  let best = 0;
  perSecond.forEach((p, i) => {
    sum += p;
    if (i >= seconds) sum -= perSecond[i - seconds];
    if (i >= seconds - 1) best = Math.max(best, sum);
  });
  return best / seconds;
}

type PlanStepLike = Pick<RidePlanStep, "programSetId" | "power" | "outdoor" | "step">;

/** A step's target as watts (indoors) or bpm (outdoors), low and high; null is open. Null without one. */
function targetBounds(s: PlanStepLike, mode: RideMode): { series: "power" | "hr"; low: number | null; high: number | null } | null {
  if (mode === "outdoor") {
    if (s.outdoor?.unit !== "bpm" || (s.outdoor.low === null && s.outdoor.high === null)) return null;
    return { series: "hr", low: s.outdoor.low, high: s.outdoor.high };
  }
  const p = s.power;
  if (!p || (p.from === null && p.to === null)) return null;
  // A ramp counts inside anywhere between its start and end watts.
  const lo = p.from !== null && p.to !== null ? Math.min(p.from, p.to) : p.from;
  const hi = p.from !== null && p.to !== null ? Math.max(p.from, p.to) : p.to;
  return { series: "power", low: lo, high: hi };
}

/** Efficiency (avg power / avg HR) of each half by time of the samples, and the drift between them. */
function driftOf(streams: RideStreams, idx: number[], d: number[]): RideDrift | null {
  const both = idx.filter((i) => d[i] > 0 && streams.power![i] !== null && (streams.hr![i] ?? 0) > 0).sort((a, b) => (streams.t[a] as number) - (streams.t[b] as number));
  const total = both.reduce((a, i) => a + d[i], 0);
  if (total <= 0) return null;
  let acc = 0;
  const first: number[] = [];
  const second: number[] = [];
  for (const i of both) {
    (acc < total / 2 ? first : second).push(i);
    acc += d[i];
  }
  const ef = (h: number[]) => {
    const p = weightedMean(streams.power, h, d);
    const hr = weightedMean(streams.hr, h, d);
    return p !== null && hr ? p / hr : null;
  };
  const a = ef(first);
  const b = ef(second);
  if (!a || b === null) return null;
  const pct = Math.round(((a - b) / a) * 1000) / 10;
  return { pct, steady: pct < DRIFT_STEADY_PCT, efFirst: Math.round(a * 1000) / 1000, efSecond: Math.round(b * 1000) / 1000 };
}

/**
 * The numbers of 4.6 from the activity's streams: NP (30 s rolling mean,
 * fourth-power mean), IF = NP / FTP, load = hours x IF^2 x 100, kJ from 1 s
 * power, time in power zones (Coggan, FTP) and heart rate zones (Friel, bike
 * LTHR), time on target per step, and heart rate drift: rides of 60 min or
 * more with power and heart rate, warm-up and cool-down steps left out, two
 * halves by time, efficiency avg power / avg HR, drift = (first - second) /
 * first x 100.
 */
export function rideStreamNumbers(
  streams: RideStreams,
  steps: PlanStepLike[],
  windows: StepWindow[],
  opts: { ftp: number | null; lthr: number | null; mode: RideMode },
): StreamNumbers {
  const { t, power, hr } = streams;
  const d = sampleDurations(t);
  const seconds = d.reduce((a, b) => a + b, 0);
  const all = t.map((_, i) => i);
  const ftp = opts.ftp && opts.ftp > 0 ? opts.ftp : null;
  const hasPower = !!power && power.some((p) => p !== null);
  const hasHr = !!hr && hr.some((h) => h !== null && h > 0);

  const avgPower = hasPower ? weightedMean(power, all, d, (v) => v >= 0) : null;
  const np = hasPower ? normalizedPower(t, power!) : null;
  const pl = hasPower && ftp ? powerLoad(t, power!, ftp) : null;
  const kj = hasPower ? Math.round(power!.reduce<number>((a, p, i) => a + (p !== null && p > 0 ? p * d[i] : 0), 0) / 1000) : null;

  const powerZoneSeconds = [0, 0, 0, 0, 0, 0, 0];
  if (hasPower && ftp) power!.forEach((p, i) => p !== null && d[i] && (powerZoneSeconds[powerZone((p / ftp) * 100) - 1] += d[i]));
  const hrZoneSeconds = [0, 0, 0, 0, 0];
  if (hasHr && opts.lthr) hr!.forEach((h, i) => h !== null && h > 0 && d[i] && (hrZoneSeconds[bikeHrZone((h / opts.lthr!) * 100) - 1] += d[i]));

  const byId = new Map(steps.map((s) => [s.programSetId, s]));
  const onTarget: Record<number, number | null> = {};
  const stepPower: Record<number, number | null> = {};
  for (const w of windows) {
    stepPower[w.programSetId] = hasPower ? weightedMean(power, indices(t, w), d, (v) => v >= 0) : null;
    const s = byId.get(w.programSetId);
    const b = s ? targetBounds(s, opts.mode) : null;
    const series = b?.series === "hr" ? hr : power;
    if (!b || !series) {
      onTarget[w.programSetId] = null;
      continue;
    }
    let inside = 0;
    let counted = 0;
    for (const i of indices(t, w)) {
      const v = series[i];
      if (v === null || !d[i] || (b.series === "hr" && v <= 0)) continue;
      counted += d[i];
      if ((b.low === null || v >= b.low) && (b.high === null || v <= b.high)) inside += d[i];
    }
    onTarget[w.programSetId] = counted > 0 ? Math.round((inside / counted) * 100) : null;
  }

  let drift: RideDrift | null = null;
  if (hasPower && hasHr && seconds >= DRIFT_MIN_S) {
    const middle = windows.filter((w) => {
      const type = byId.get(w.programSetId)?.step.type;
      return type !== "warmup" && type !== "cooldown";
    });
    drift = driftOf(streams, middle.flatMap((w) => indices(t, w)), d);
  }

  return {
    seconds,
    avgPower,
    np,
    intensityFactor: pl ? pl.intensityFactor : null,
    load: pl ? pl.load : null,
    kj,
    powerZoneMinutes: powerZoneSeconds.map((z) => Math.round(z / 60)),
    hrZoneMinutes: hrZoneSeconds.map((z) => Math.round(z / 60)),
    drift,
    onTarget,
    best60sPower: hasPower ? workBest60s(streams, windows, byId) : null,
    stepPower,
  };
}

// ── Plan against done ────────────────────────────────────────────────────────

export type DoneChart = {
  /** Each ridden step's power target as a band. */
  bands: { key: number; x: number; w: number; y: number; h: number }[];
  /** SVG polyline points. */
  power: string | null;
  hr: string | null;
  /** Where the "HR 145" label sits, and its text. */
  hrLabel: { x: number; y: number; text: string } | null;
  ftpY: number | null;
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string }[];
};

const BINS = 120;

/**
 * The plan-against-done chart (section 5, "Summary"): the power targets of the
 * ridden steps as bands, the power line, and heart rate as a dashed line on a
 * scale of its own, over the ridden time of the ride's steps (the split's pauses left out). Null when
 * the activity has neither power nor heart rate.
 */
export function rideDoneChart(streams: RideStreams, steps: PlanStepLike[], split: RideSplit, ftp: number | null): DoneChart | null {
  const { t } = streams;
  const hasPower = !!streams.power?.some((p) => p !== null);
  const hasHr = !!streams.hr?.some((h) => h !== null && h > 0);
  if ((!hasPower && !hasHr) || !split.windows.length) return null;
  const { left, right, base, top } = CHART;
  const span = right - left;
  const a0 = streamToActive(split.windows[0].from, split.pauses);
  const a1 = streamToActive(split.windows.at(-1)!.to, split.pauses);
  const total = Math.max(1, a1 - a0);
  const x = (active: number) => +(left + ((active - a0) / total) * span).toFixed(1);

  // Mean per bin of ridden time.
  const d = sampleDurations(t);
  const bins = Math.max(2, Math.min(BINS, Math.ceil(total / 30)));
  const binOf = (ti: number) => Math.floor(((streamToActive(ti, split.pauses) - a0) / total) * bins);
  const mean = (series: Series | undefined, keep: (v: number) => boolean) => {
    if (!series) return null;
    const sum = new Array<number>(bins).fill(0);
    const secs = new Array<number>(bins).fill(0);
    t.forEach((ti, i) => {
      const v = series[i];
      if (ti === null || v === null || !keep(v) || !d[i]) return;
      const b = binOf(ti);
      if (b < 0 || b >= bins) return;
      sum[b] += v * d[i];
      secs[b] += d[i];
    });
    return sum.map((s, b) => (secs[b] > 0 ? s / secs[b] : null));
  };
  const pBins = hasPower ? mean(streams.power, (v) => v >= 0) : null;
  const hBins = hasHr ? mean(streams.hr, (v) => v > 0) : null;
  const binX = (b: number) => +(left + ((b + 0.5) / bins) * span).toFixed(1);
  const line = (vals: (number | null)[] | null, y: (v: number) => number) =>
    vals
      ? vals
          .map((v, b) => (v === null ? null : `${binX(b)},${y(v).toFixed(1)}`))
          .filter(Boolean)
          .join(" ") || null
      : null;

  const byId = new Map(steps.map((s) => [s.programSetId, s]));
  const targets = split.windows.map((w) => ({ w, p: byId.get(w.programSetId)?.power ?? null }));
  const maxTarget = Math.max(0, ...targets.map(({ p }) => Math.max(p?.from ?? 0, p?.to ?? 0)));
  const maxBin = Math.max(0, ...(pBins ?? []).map((v) => v ?? 0));
  const maxW = Math.max(ftp ? ftp * 1.3 : 0, maxTarget * 1.15, maxBin * 1.05, 50);
  const yW = (w: number) => +(base - (Math.min(w, maxW) / maxW) * (base - top)).toFixed(1);

  const bands: DoneChart["bands"] = [];
  if (hasPower) {
    for (const { w, p } of targets) {
      if (!p || (p.from === null && p.to === null)) continue;
      const lo = p.from !== null && p.to !== null ? Math.min(p.from, p.to) : (p.from ?? 0);
      const hi = p.from !== null && p.to !== null ? Math.max(p.from, p.to) : (p.to ?? maxW);
      const bx = x(streamToActive(w.from, split.pauses));
      const bw = Math.max(1, x(streamToActive(w.to, split.pauses)) - bx - 0.8);
      bands.push({ key: w.programSetId, x: bx, w: +bw.toFixed(1), y: yW(hi), h: Math.max(1.5, +(yW(lo) - yW(hi)).toFixed(1)) });
    }
  }

  const hrVals = (hBins ?? []).filter((v): v is number => v !== null);
  // Its own scale with room above and below, so the dashed line runs through the middle of the plot, clear of the FTP line.
  const hrTop = Math.max(...hrVals, 120) + 45;
  const hrLow = Math.max(0, Math.min(...hrVals, 100) - 45);
  const yH = (h: number) => base - ((h - hrLow) / (hrTop - hrLow)) * (base - top);
  const hr = line(hBins, yH);
  const avgHr = weightedMean(streams.hr, t.map((_, i) => i), d, (v) => v > 0);
  const lastHr = [...(hBins ?? [])].reverse().find((v) => v !== null) ?? null;

  const yTicks: DoneChart["yTicks"] = [];
  if (hasPower) {
    const stepW = maxW > 450 ? 100 : 50;
    for (let wt = stepW; wt < (ftp ? ftp * 0.9 : maxW * 0.9); wt += stepW) yTicks.push({ y: yW(wt), label: `${wt}` });
  }
  const xTicks = timeTicks(total);

  return {
    bands,
    power: line(pBins, yW),
    hr,
    hrLabel: hr && avgHr !== null && lastHr !== null ? { x: right, y: +(yH(lastHr) - 4).toFixed(1), text: `HR ${Math.round(avgHr)}` } : null,
    ftpY: hasPower && ftp ? yW(ftp) : null,
    yTicks,
    xTicks,
  };
}
