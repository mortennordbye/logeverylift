/**
 * Per-activity best efforts and estimates for the Trends tab
 * (docs/plans/garmin-insights-design.md, 2.8 and 2.10). Pure.
 *
 * - Best mean power and speed for fixed durations (prefix sums on a 1 s grid).
 * - Best time for fixed distances (two pointers on the distance stream).
 * - A VO2 max estimate per outdoor run (vo2FromRun).
 * - hr30: the mean HR of the last 20 minutes of the hardest 30 minutes, the
 *   input to the LTHR estimate.
 * - Run dynamics by speed bin, so a trend compares like with like.
 */

export const POWER_DURATIONS = [5, 15, 30, 60, 120, 180, 300, 600, 720, 1200, 1800, 3600, 5400, 7200] as const;
export const SPEED_DURATIONS = [60, 180, 300, 600, 720, 1200, 1800, 3600, 5400, 7200] as const;
export const PACE_DISTANCES = [400, 1000, 1609, 5000, 10000, 21097, 42195] as const;

type Series = (number | null)[];

/** A gap longer than this (s) is a pause: the grid gets zeros (no power, no movement). */
const MAX_FILL_S = 5;

/** The values on a 1 s grid from t = 0: short gaps are held, long ones are zero. */
export function perSecond(t: Series, v: Series): number[] {
  const out: number[] = [];
  let last: { t: number; v: number } | null = null;
  for (let i = 0; i < t.length; i++) {
    const ti = t[i];
    if (ti === null) continue;
    const vi = v[i] ?? 0;
    if (last) {
      for (let s = last.t + 1; s < ti; s++) out[s] = s - last.t <= MAX_FILL_S ? last.v : 0;
    }
    out[ti] = vi;
    last = { t: ti, v: vi };
  }
  for (let s = 0; s < out.length; s++) if (out[s] === undefined) out[s] = 0;
  return out;
}

/** Best mean of the grid over each duration (s) that fits in it. */
export function bestMeans(grid: number[], durations: readonly number[]): Record<number, number> {
  const pre = [0];
  for (const x of grid) pre.push(pre[pre.length - 1] + x);
  const out: Record<number, number> = {};
  for (const d of durations) {
    if (d > grid.length) continue;
    let best = 0;
    for (let i = d; i < pre.length; i++) best = Math.max(best, pre[i] - pre[i - d]);
    if (best > 0) out[d] = Math.round((best / d) * 100) / 100;
  }
  return out;
}

/** Fastest time (s) to cover each distance (m), from cumulative distance samples. */
export function bestTimes(t: Series, dist: Series, distances: readonly number[]): Record<number, number> {
  const pts: [number, number][] = [];
  for (let i = 0; i < t.length; i++) if (t[i] !== null && dist[i] !== null) pts.push([t[i]!, dist[i]!]);
  const out: Record<number, number> = {};
  for (const d of distances) {
    let j = 0;
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      while (j < i && pts[i][1] - pts[j + 1][1] >= d) j++;
      if (pts[i][1] - pts[j][1] >= d) best = Math.min(best, pts[i][0] - pts[j][0]);
    }
    if (Number.isFinite(best)) out[d] = best;
  }
  return out;
}

function rolling(xs: number[], w: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= w) sum -= xs[i - w];
    out.push(sum / Math.min(i + 1, w));
  }
  return out;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** Seconds of usable data needed, and the part of the run used: 10 to 70 minutes in. */
export const VO2_MIN_SAMPLES = 900;
export const VO2_FROM_S = 600;
export const VO2_TO_S = 4200;
/** Shorter runs read high (heart rate has not caught up with pace), so they give no estimate. */
export const VO2_MIN_RUN_S = 1800;

/**
 * VO2 max from one outdoor run, without a lab:
 *
 *   VO2 (ml/kg/min) = 3.5 + 0.2 x v + 0.9 x v x grade     ACSM running equation, v in m/min
 *   VO2max = 3.5 + (VO2 - 3.5) / HRR                      %HRR tracks %VO2 reserve (Swain 1997)
 *
 * per second, on 30 s means (heart rate lags pace), from 10 to 70 minutes
 * into a run of 30 minutes or more, while running (over 1.8 m/s) at 50 to 95 %
 * of heart-rate reserve, on grades from -2 % to +15 % (the equation has no
 * downhill term). The estimate is the median, with the number of seconds it
 * used. Measured on the owner's runs (2026-11-11): within 1.5 of Garmin's
 * value on runs of 30 to 65 minutes; short runs read high, and past about an
 * hour cardiac drift reads low, hence the window.
 */
export function vo2FromRun(input: { t: Series; hr: Series; speed: Series; altitude?: Series; restHr: number; maxHr: number }): { value: number; samples: number } | null {
  const { restHr, maxHr } = input;
  if (maxHr <= restHr) return null;
  const hr = rolling(perSecond(input.t, input.hr), 30);
  const v = rolling(perSecond(input.t, input.speed), 30);
  const alt = input.altitude ? perSecond(input.t, input.altitude) : null;
  const values: number[] = [];
  if (Math.min(hr.length, v.length) < VO2_MIN_RUN_S) return null;
  for (let s = VO2_FROM_S; s < Math.min(hr.length, v.length, VO2_TO_S); s++) {
    if (v[s] < 1.8) continue;
    const hrr = (hr[s] - restHr) / (maxHr - restHr);
    if (hrr < 0.5 || hrr > 0.95) continue;
    let grade = 0;
    if (alt && s >= 30 && alt[s] && alt[s - 30]) {
      const run = v.slice(s - 29, s + 1).reduce((a, b) => a + b, 0);
      grade = run > 0 ? (alt[s] - alt[s - 30]) / run : 0;
      if (grade < -0.02 || grade > 0.15) continue;
      grade = Math.max(0, grade);
    }
    const vMin = v[s] * 60;
    const vo2 = 3.5 + 0.2 * vMin + 0.9 * vMin * grade;
    values.push(3.5 + (vo2 - 3.5) / hrr);
  }
  if (values.length < VO2_MIN_SAMPLES) return null;
  return { value: Math.round(median(values) * 10) / 10, samples: values.length };
}

/** Mean HR of the last 20 minutes of the 30 minutes with the highest mean HR. Null under 30 minutes. */
export function hr30(t: Series, hr: Series): number | null {
  const grid = perSecond(t, hr);
  if (grid.length < 1800) return null;
  const pre = [0];
  for (const x of grid) pre.push(pre[pre.length - 1] + x);
  let bestEnd = -1;
  let best = 0;
  for (let i = 1800; i < pre.length; i++) {
    const m = pre[i] - pre[i - 1800];
    if (m > best) {
      best = m;
      bestEnd = i;
    }
  }
  if (bestEnd < 0) return null;
  return Math.round((pre[bestEnd] - pre[bestEnd - 1200]) / 1200);
}

export type DynamicsBin = { speed: number; seconds: number; cadence: number | null; gct: number | null; vo: number | null; stepLength: number | null };

/** Bin width in m/s: dynamics change with speed, so compare at the same speed (2.10). */
export const DYNAMICS_BIN = 0.25;

/** Run dynamics averaged per speed bin, bins with 2 minutes or more only. */
export function dynamicsBins(input: { t: Series; speed: Series; cadence?: Series; gct?: Series; vo?: Series; stepLength?: Series }): DynamicsBin[] {
  const bins = new Map<number, { n: number; sums: Record<string, number>; counts: Record<string, number> }>();
  const keys = ["cadence", "gct", "vo", "stepLength"] as const;
  for (let i = 0; i < input.t.length; i++) {
    const sp = input.speed[i];
    if (sp === null || sp < 1.8) continue;
    const key = Math.floor(sp / DYNAMICS_BIN) * DYNAMICS_BIN;
    const b = bins.get(key) ?? { n: 0, sums: {}, counts: {} };
    b.n++;
    for (const k of keys) {
      const v = input[k]?.[i];
      if (typeof v === "number" && v > 0) {
        b.sums[k] = (b.sums[k] ?? 0) + v;
        b.counts[k] = (b.counts[k] ?? 0) + 1;
      }
    }
    bins.set(key, b);
  }
  const mean = (b: { sums: Record<string, number>; counts: Record<string, number> }, k: string) => (b.counts[k] ? Math.round((b.sums[k] / b.counts[k]) * 10) / 10 : null);
  return [...bins.entries()]
    .filter(([, b]) => b.n >= 120)
    .sort(([a], [b]) => a - b)
    .map(([speed, b]) => ({ speed, seconds: b.n, cadence: mean(b, "cadence"), gct: mean(b, "gct"), vo: mean(b, "vo"), stepLength: mean(b, "stepLength") }));
}

export type Efforts = {
  /** Best mean power (W) per duration (s). */
  power: Record<number, number>;
  /** Best mean speed (m/s) per duration (s), runs only. */
  speed: Record<number, number>;
  /** Best time (s) per distance (m), runs only. */
  distance: Record<number, number>;
  vo2: { value: number; samples: number } | null;
  hr30: number | null;
  dynamics: DynamicsBin[];
};

type Json = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Garmin's own bests in the summary, for activities with no stream: maxAvgPower_N (W) and fastestSplit_N (s). */
export function summaryEfforts(summary: Json): Pick<Efforts, "power" | "distance"> {
  const power: Record<number, number> = {};
  const distance: Record<number, number> = {};
  for (const d of POWER_DURATIONS) {
    const v = num(summary[`maxAvgPower_${d}`]);
    if (v) power[d] = v;
  }
  for (const d of PACE_DISTANCES) {
    const v = num(summary[`fastestSplit_${d}`]);
    if (v) distance[d] = v;
  }
  return { power, distance };
}

export function computeEfforts(input: {
  sport: string;
  indoor: boolean;
  summary: Json;
  streams: Partial<Record<string, Series>> | null;
  restHr: number | null;
  maxHr: number | null;
}): Efforts {
  const s = input.streams;
  const t = s?.t ?? null;
  const fallback = summaryEfforts(input.summary);
  const isRun = input.sport === "run";
  // Treadmill speed is not measured, so its pace and VO2 are left out (2.2).
  const outdoorRun = isRun && !input.indoor;
  const power = t && s?.power?.some((v) => v) ? bestMeans(perSecond(t, s.power!), POWER_DURATIONS) : fallback.power;
  const speed = t && outdoorRun && s?.speed ? bestMeans(perSecond(t, s.speed), SPEED_DURATIONS) : {};
  const distance = t && outdoorRun && s?.distance ? bestTimes(t, s.distance, PACE_DISTANCES) : outdoorRun ? fallback.distance : {};
  const vo2 =
    t && outdoorRun && s?.hr && s?.speed && input.restHr && input.maxHr
      ? vo2FromRun({ t, hr: s.hr, speed: s.speed, altitude: s.altitude ?? undefined, restHr: input.restHr, maxHr: input.maxHr })
      : null;
  return {
    power,
    speed,
    distance,
    vo2,
    hr30: t && s?.hr && (input.sport === "run" || input.sport === "bike") ? hr30(t, s.hr) : null,
    dynamics: t && outdoorRun && s?.speed ? dynamicsBins({ t, speed: s.speed, cadence: s.cadence ?? undefined, gct: s.groundContactTime ?? undefined, vo: s.verticalOscillation ?? undefined, stepLength: s.stepLength ?? undefined }) : [],
  };
}
