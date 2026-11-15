/**
 * The Trends tab's models, from per-activity efforts (efforts.ts) and the
 * stored series (docs/plans/garmin-insights-design.md, 2.8 and 3.7). Pure.
 *
 * - Duration curves for a window: the best per duration, with its date.
 * - Critical power and W' (and critical speed with D') by least squares.
 * - Thresholds week by week from the 90 days before: FTP, CP, critical
 *   speed, LTHR per sport.
 * - The FTP estimate with its basis (docs/plans/bike-sessions.md, section 3).
 * - The app's VO2 max: the median of the run estimates of the last 42 days.
 */

import { dateLabel } from "@/lib/utils/date-label";
import { addDays, mondayOf } from "../dates";
import type { Decoupling } from "./decoupling";
import type { DynamicsBin, Efforts } from "./efforts";
import type { Sport } from "./sport";

export type TrendActivity = {
  id: number;
  day: string;
  sport: Sport;
  indoor: boolean;
  durationS: number | null;
  efforts: Efforts;
  decoupling: Decoupling | null;
  /** The LTHR and max HR the watch used for this activity. */
  watchLthr: number | null;
  watchMaxHr?: number | null;
};

export type CurvePoint = { x: number; value: number; id: number; day: string };

type CurveKind = "power" | "speed";

/** Best value per duration over activities in [from, to]. Higher is better for both kinds. */
export function curve(acts: TrendActivity[], kind: CurveKind, from: string, to: string): CurvePoint[] {
  const best = new Map<number, CurvePoint>();
  for (const a of acts) {
    if (a.day < from || a.day > to) continue;
    for (const [k, v] of Object.entries(a.efforts[kind])) {
      const x = Number(k);
      if (!best.has(x) || best.get(x)!.value < v) best.set(x, { x, value: v, id: a.id, day: a.day });
    }
  }
  return [...best.values()].sort((a, b) => a.x - b.x);
}

/** Durations the CP and CS fits use (plan 2.8): 3, 5, 12 and 20 minutes. */
export const FIT_DURATIONS = [180, 300, 720, 1200] as const;
export const MIN_R2 = 0.95;

/**
 * Fit work = CP x t + W' (or distance = CS x t + D') by least squares on the
 * bests at FIT_DURATIONS. Null under 3 points, or when R squared is under 0.95
 * ("not enough hard efforts").
 */
export function criticalFit(points: CurvePoint[]): { cp: number; w: number; r2: number } | null {
  const pts = points.filter((p) => (FIT_DURATIONS as readonly number[]).includes(p.x)).map((p) => [p.x, p.value * p.x] as const);
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((s, [x]) => s + x, 0) / n;
  const my = pts.reduce((s, [, y]) => s + y, 0) / n;
  const sxx = pts.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  const sxy = pts.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0);
  const cp = sxy / sxx;
  const w = my - cp * mx;
  const ssTot = pts.reduce((s, [, y]) => s + (y - my) ** 2, 0);
  const ssRes = pts.reduce((s, [x, y]) => s + (y - (cp * x + w)) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  if (r2 < MIN_R2 || cp <= 0 || w < 0) return null;
  return { cp, w, r2 };
}

/** Days the threshold estimates look back (plan 2.8). */
export const THRESHOLD_DAYS = 90;
/** One FTP candidate: 0.95 x best 20 minute power. */
export const FTP_FACTOR = 0.95;

export type FtpEstimate = {
  value: number;
  /** Which candidate won: 95 % of the best 20 min, the best 60 min, or critical power. */
  from: "p20" | "p60" | "cp";
  /** The ride of the best effort; null for critical power, which fits several. */
  day: string | null;
};

/**
 * FTP from a power curve: the highest of 95 % of the best 20 min, the best
 * 60 min, and critical power. Null with none of them.
 */
export function ftpFromCurve(power: CurvePoint[]): FtpEstimate | null {
  const p20 = power.find((p) => p.x === 1200);
  const p60 = power.find((p) => p.x === 3600);
  const cp = criticalFit(power)?.cp;
  const candidates: FtpEstimate[] = [];
  if (p20) candidates.push({ value: Math.round(p20.value * FTP_FACTOR), from: "p20", day: p20.day });
  if (p60) candidates.push({ value: Math.round(p60.value), from: "p60", day: p60.day });
  if (cp !== undefined) candidates.push({ value: Math.round(cp), from: "cp", day: null });
  // Ties keep the first: a single ride is easier to read back than a fit.
  return candidates.reduce<FtpEstimate | null>((best, c) => (!best || c.value > best.value ? c : best), null);
}

/** The FTP estimate from the rides in the 90 days up to `to` (YYYY-MM-DD). */
export function ftpEstimate(acts: TrendActivity[], to: string): FtpEstimate | null {
  const from = addDays(to, -(THRESHOLD_DAYS - 1));
  return ftpFromCurve(curve(acts.filter((a) => a.sport === "bike"), "power", from, to));
}

/** "best 60 min on 10 Nov", "95 % of best 20 min on 3 Nov", "critical power, last 90 days". */
export function ftpBasis(e: FtpEstimate): string {
  if (e.from === "cp") return `critical power, last ${THRESHOLD_DAYS} days`;
  const on = e.day ? ` on ${dateLabel(e.day, "d MMM")}` : "";
  return e.from === "p60" ? `best 60 min${on}` : `95 % of best 20 min${on}`;
}
/**
 * A 30 minute effort counts for the LTHR estimate only at 85 % of max HR or
 * more. LTHR usually sits near 90 %; an easier session would pull the estimate
 * down and raise a false gap against the watch.
 */
export const LTHR_MIN_SHARE_OF_MAX = 0.85;

export type ThresholdWeek = {
  weekStart: string;
  ftp: number | null;
  cp: number | null;
  /** Critical speed, m/s. */
  cs: number | null;
  lthrRun: number | null;
  lthrBike: number | null;
  watchLthr: number | null;
};

/** Thresholds at the end of each week, each from the 90 days before it. */
export function thresholdHistory(acts: TrendActivity[], from: string, to: string): ThresholdWeek[] {
  const out: ThresholdWeek[] = [];
  for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) {
    const end = addDays(w, 6) < to ? addDays(w, 6) : to;
    const start = addDays(end, -(THRESHOLD_DAYS - 1));
    const window = acts.filter((a) => a.day >= start && a.day <= end);
    const bike = window.filter((a) => a.sport === "bike");
    const run = window.filter((a) => a.sport === "run");
    const power = curve(bike, "power", start, end);
    const speed = curve(run, "speed", start, end);
    const maxHr30 = (xs: TrendActivity[]) => {
      const v = xs
        .filter((a) => a.efforts.hr30 !== null && a.watchMaxHr && a.efforts.hr30 >= LTHR_MIN_SHARE_OF_MAX * a.watchMaxHr)
        .map((a) => a.efforts.hr30!);
      return v.length ? Math.max(...v) : null;
    };
    const watch = [...window].reverse().find((a) => a.watchLthr !== null)?.watchLthr ?? null;
    out.push({
      weekStart: w,
      ftp: ftpFromCurve(power)?.value ?? null,
      cp: criticalFit(power)?.cp ?? null,
      cs: criticalFit(speed)?.cp ?? null,
      lthrRun: maxHr30(run),
      lthrBike: maxHr30(bike),
      watchLthr: watch,
    });
  }
  return out;
}

/** Days of run estimates the app's VO2 max is the median of. */
export const VO2_WINDOW_DAYS = 42;

export type Vo2Point = { day: string; value: number; id: number };

/** Each run's estimate, and the app's VO2 max on each of those days: the median of the last 42 days. */
export function vo2Series(acts: TrendActivity[]): { runs: Vo2Point[]; trend: { day: string; value: number }[] } {
  const runs = acts
    .filter((a) => a.efforts.vo2)
    .map((a) => ({ day: a.day, value: a.efforts.vo2!.value, id: a.id }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const trend = runs.map((r) => {
    const from = addDays(r.day, -(VO2_WINDOW_DAYS - 1));
    const xs = runs.filter((x) => x.day >= from && x.day <= r.day).map((x) => x.value).sort((a, b) => a - b);
    const m = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
    return { day: r.day, value: Math.round(m * 10) / 10 };
  });
  // One trend point per day.
  const byDay = new Map(trend.map((t) => [t.day, t]));
  return { runs, trend: [...byDay.values()] };
}

export type EfPoint = { day: string; sport: "bike" | "run"; ef: number; durationS: number; decoupling: number | null; temperature: number | null; id: number };

/** Steady rides and runs with a valid decoupling: efficiency and drift per session. */
export function efPoints(acts: TrendActivity[]): EfPoint[] {
  return acts
    .filter((a) => (a.sport === "bike" || a.sport === "run") && a.decoupling?.valid)
    .map((a) => {
      const d = a.decoupling as Extract<Decoupling, { valid: true }>;
      return { day: a.day, sport: a.sport as "bike" | "run", ef: Math.round(d.ef * 1000) / 1000, durationS: d.minutes * 60, decoupling: Math.round(d.pct * 10) / 10, temperature: d.temperature, id: a.id };
    })
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Run dynamics at one speed: the bin with the most seconds over all runs, so
 * every point compares the same speed (2.10).
 */
export function dynamicsTrend(acts: TrendActivity[]): { speed: number; points: ({ day: string; id: number } & DynamicsBin)[] } | null {
  const total = new Map<number, number>();
  for (const a of acts) for (const b of a.efforts.dynamics) total.set(b.speed, (total.get(b.speed) ?? 0) + b.seconds);
  const top = [...total.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const points = acts
    .flatMap((a) => {
      const b = a.efforts.dynamics.find((x) => x.speed === top[0]);
      return b ? [{ day: a.day, id: a.id, ...b }] : [];
    })
    .sort((a, b) => a.day.localeCompare(b.day));
  return points.length >= 2 ? { speed: top[0], points } : null;
}
