/**
 * Match a recorded ride to the planned steps (docs/plans/bike-sessions.md,
 * 5.5, "How a step is matched"). Pure: the worker and the tests share it.
 *
 * 1. Laps Garmin made by distance are dropped as boundaries: each joins the
 *    lap after it, so a 5 km split inside a work step stays in that step.
 * 2. When the laps left equal the steps, lap N is step N.
 * 3. Else the stream is cut by the planned step times from the start.
 * 4. Power is "in" inside the target, "under" or "over" by more than 5 %.
 *    HR is checked against the cap (the high end) only.
 */

import { normalizedPower, sampleDurations } from "@/lib/garmin/analytics/load";

export type FitLap = {
  totalTimerTime?: number | null;
  totalElapsedTime?: number | null;
  startTime?: string | null;
  totalDistance?: number | null;
  avgPower?: number | null;
  normalizedPower?: number | null;
  avgHeartRate?: number | null;
  maxHeartRate?: number | null;
  avgCadence?: number | null;
  lapTrigger?: string | null;
};

/** Columnar streams as stored: t is seconds from the first record. */
export type RideStream = {
  t?: (number | null)[];
  power?: (number | null)[];
  hr?: (number | null)[];
  cadence?: (number | null)[];
};

type Range = { low: number | null; high: number | null };

export type MatchStep = {
  key: string;
  type: string;
  plannedSeconds: number | null;
  /** Power target in W, when the step has one. */
  power: Range | null;
  /** HR target in bpm (main or second target), when the step has one. */
  hr: Range | null;
};

export type PowerMark = "in" | "under" | "over";

export type StepMeasure = {
  key: string;
  seconds: number;
  avgPower: number | null;
  normalizedPower: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgCadence: number | null;
  power: PowerMark | null;
  hrOverCap: boolean | null;
  /** Seconds with HR inside the step's HR target; work steps only. */
  hrZoneSeconds: number | null;
};

export type StepMatch = { by: "laps" | "time"; laps: number; note: string; steps: StepMeasure[] };

/** Allowed miss on each side of a power target before a step reads under or over. */
export const POWER_TOLERANCE = 0.05;

export function powerMark(avg: number | null, range: Range | null): PowerMark | null {
  if (avg == null || !range || (range.low == null && range.high == null)) return null;
  if (range.low != null && avg < range.low * (1 - POWER_TOLERANCE)) return "under";
  if (range.high != null && avg > range.high * (1 + POWER_TOLERANCE)) return "over";
  return "in";
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const lapSeconds = (l: FitLap) => num(l.totalTimerTime) ?? num(l.totalElapsedTime) ?? 0;
const lapElapsed = (l: FitLap) => num(l.totalElapsedTime) ?? num(l.totalTimerTime) ?? 0;

/** A lap with its window on the stream's time axis. */
type Span = { from: number; to: number; seconds: number; laps: FitLap[] };

/** Laps as windows, distance laps joined to the lap after them (the last one to the lap before). */
export function lapSpans(laps: FitLap[]): Span[] {
  const t0 = laps[0]?.startTime ? Date.parse(laps[0].startTime) : NaN;
  let cursor = 0;
  const raw = laps.map((l) => {
    const start = l.startTime && Number.isFinite(t0) ? (Date.parse(l.startTime) - t0) / 1000 : cursor;
    cursor = start + lapElapsed(l);
    return { from: start, to: cursor, seconds: lapSeconds(l), laps: [l] };
  });
  const out: Span[] = [];
  let carry: Span | null = null;
  for (const s of raw) {
    const merged: Span = carry ? { from: carry.from, to: s.to, seconds: carry.seconds + s.seconds, laps: [...carry.laps, ...s.laps] } : s;
    if (s.laps[0].lapTrigger === "distance") carry = merged;
    else {
      out.push(merged);
      carry = null;
    }
  }
  if (carry) {
    const last = out.pop();
    out.push(last ? { from: last.from, to: carry.to, seconds: last.seconds + carry.seconds, laps: [...last.laps, ...carry.laps] } : carry);
  }
  return out;
}

/** Time-weighted mean of one lap field over the laps of a span. */
function lapMean(span: Span, f: keyof FitLap): number | null {
  let sum = 0;
  let secs = 0;
  for (const l of span.laps) {
    const v = num(l[f]);
    if (v == null) continue;
    sum += v * lapSeconds(l);
    secs += lapSeconds(l);
  }
  return secs > 0 ? sum / secs : null;
}

function lapNp(span: Span): number | null {
  let sum = 0;
  let secs = 0;
  for (const l of span.laps) {
    const v = num(l.normalizedPower);
    if (v == null) continue;
    sum += v ** 4 * lapSeconds(l);
    secs += lapSeconds(l);
  }
  return secs > 0 ? (sum / secs) ** 0.25 : null;
}

/** Sample indexes of the stream inside [from, to). */
function window(stream: RideStream, from: number, to: number): number[] {
  const t = stream.t ?? [];
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const ti = t[i];
    if (ti != null && ti >= from && ti < to) out.push(i);
  }
  return out;
}

function streamMeasures(stream: RideStream, idx: number[]) {
  const t = stream.t ?? [];
  const dur = sampleDurations(idx.map((i) => t[i]));
  const mean = (s: (number | null)[] | undefined, skipZero = false) => {
    if (!s) return null;
    let sum = 0;
    let secs = 0;
    idx.forEach((i, j) => {
      const v = s[i];
      if (v == null || (skipZero && v === 0)) return;
      sum += v * dur[j];
      secs += dur[j];
    });
    return secs > 0 ? sum / secs : null;
  };
  const hrs = stream.hr ? idx.map((i) => stream.hr![i]).filter((v): v is number => v != null) : [];
  return {
    seconds: dur.reduce((a, b) => a + b, 0),
    avgPower: mean(stream.power),
    normalizedPower: stream.power ? normalizedPower(idx.map((i) => t[i]), idx.map((i) => stream.power![i])) : null,
    avgHeartRate: mean(stream.hr),
    maxHeartRate: hrs.length ? Math.max(...hrs) : null,
    avgCadence: mean(stream.cadence, true),
  };
}

function zoneSeconds(stream: RideStream, idx: number[], hr: Range | null): number | null {
  if (!hr || !stream.hr || !stream.t || (hr.low == null && hr.high == null)) return null;
  const dur = sampleDurations(idx.map((i) => stream.t![i]));
  let secs = 0;
  idx.forEach((i, j) => {
    const v = stream.hr![i];
    if (v != null && (hr.low == null || v >= hr.low) && (hr.high == null || v <= hr.high)) secs += dur[j];
  });
  return secs;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function finish(step: MatchStep, m: Omit<StepMeasure, "key" | "power" | "hrOverCap" | "hrZoneSeconds">, zone: number | null): StepMeasure {
  const cap = step.hr?.high ?? null;
  return {
    key: step.key,
    ...m,
    power: powerMark(m.avgPower, step.power),
    hrOverCap: cap != null && m.avgHeartRate != null ? m.avgHeartRate > cap : null,
    hrZoneSeconds: step.type === "work" ? zone : null,
  };
}

export function matchSteps(steps: MatchStep[], laps: FitLap[], stream: RideStream | null): StepMatch {
  const s = stream ?? {};
  const spans = lapSpans(laps);
  if (spans.length > 0 && spans.length === steps.length) {
    return {
      by: "laps",
      laps: spans.length,
      note: `Matched by laps: ${spans.length} of ${steps.length}`,
      steps: steps.map((step, i) => {
        const span = spans[i];
        const idx = window(s, span.from, span.to);
        const maxHr = span.laps.map((l) => num(l.maxHeartRate)).filter((v): v is number => v != null);
        return finish(
          step,
          {
            seconds: span.seconds,
            avgPower: lapMean(span, "avgPower"),
            normalizedPower: lapNp(span),
            avgHeartRate: lapMean(span, "avgHeartRate"),
            maxHeartRate: maxHr.length ? Math.max(...maxHr) : null,
            avgCadence: lapMean(span, "avgCadence"),
          },
          zoneSeconds(s, idx, step.hr),
        );
      }),
    };
  }
  let from = 0;
  const end = Math.max(0, ...(s.t ?? []).filter((v): v is number => v != null)) + 1;
  const measures = steps.map((step, i) => {
    // A step with no planned time (lap button) takes the rest of the ride; later steps get nothing.
    const to = i === steps.length - 1 || step.plannedSeconds == null ? end : from + step.plannedSeconds;
    const idx = window(s, from, to);
    from = to;
    return finish(step, streamMeasures(s, idx), zoneSeconds(s, idx, step.hr));
  });
  return {
    by: "time",
    laps: spans.length,
    note: `Matched by time: ${plural(spans.length, "lap")} did not fit ${plural(steps.length, "step")}`,
    steps: measures,
  };
}
