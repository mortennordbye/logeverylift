/**
 * "What moves my HRV" (docs/plans/garmin-insights-design.md, 2.12): a fixed
 * list of pairs, chosen up front so the page does not go hunting for chance
 * hits. Spearman rank correlation, shown only with MIN_PAIRS pairs or more and
 * |rho| of MIN_RHO or more, and stated as a split, which is easier to act on.
 * Wording says "goes with", never "causes". Pure.
 */

import { addDays } from "../dates";

export const MIN_PAIRS = 20;
export const MIN_RHO = 0.3;

/** Average ranks, ties shared. */
function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = r;
    i = j + 1;
  }
  return out;
}

export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** One day's inputs. Every field may be missing. */
export type CorrelationDay = {
  date: string;
  hrvMs: number | null;
  hrvMean7: number | null;
  sleepH: number | null;
  sleepDebtH: number | null;
  regularity: number | null;
  load: number | null;
  highMin: number | null;
  strengthLoad: number | null;
  /** Efficiency of the day's steady run (m/min per bpm), and its decoupling. */
  runEf: number | null;
  decoupling: number | null;
};

type Pick = (byDate: Map<string, CorrelationDay>, d: CorrelationDay) => [number | null, number | null];

const prev = (byDate: Map<string, CorrelationDay>, d: CorrelationDay) => byDate.get(addDays(d.date, -1));

export type PairDef = {
  id: string;
  /** "Sleep the night before", "HRV that night" */
  x: string;
  y: string;
  unitX: string;
  unitY: string;
  pick: Pick;
};

/**
 * The pairs. Garmin dates a night's sleep and HRV by the morning they end, so
 * "tonight" after day d is day d + 1's value and "last night" is day d's.
 */
export const PAIRS: PairDef[] = [
  { id: "sleep_ef", x: "sleep the night before", y: "run efficiency", unitX: "h", unitY: "", pick: (_b, d) => [d.sleepH, d.runEf] },
  { id: "hrv_ef", x: "HRV that morning", y: "run efficiency", unitX: "ms", unitY: "", pick: (_b, d) => [d.hrvMs, d.runEf] },
  { id: "load_hrv", x: "the day's training load", y: "HRV the next morning", unitX: "", unitY: "ms", pick: (b, d) => [prev(b, d)?.load ?? null, d.hrvMs] },
  { id: "high_hrv", x: "minutes above threshold", y: "HRV the next morning", unitX: "min", unitY: "ms", pick: (b, d) => [prev(b, d)?.highMin ?? null, d.hrvMs] },
  { id: "strength_ef", x: "strength load the day before", y: "run efficiency", unitX: "", unitY: "", pick: (b, d) => [prev(b, d)?.strengthLoad ?? null, d.runEf] },
  { id: "debt_decoupling", x: "sleep debt", y: "decoupling", unitX: "h", unitY: "%", pick: (_b, d) => [d.sleepDebtH, d.decoupling] },
  { id: "regularity_hrv", x: "sleep regularity", y: "HRV 7-day mean", unitX: "", unitY: "ms", pick: (_b, d) => [d.regularity, d.hrvMean7] },
  { id: "sleep_hrv", x: "sleep the night before", y: "HRV that morning", unitX: "h", unitY: "ms", pick: (_b, d) => [d.sleepH, d.hrvMs] },
];

export type Finding = {
  id: string;
  rho: number;
  n: number;
  /** The median of x that splits the days, and y's mean on each side. */
  split: number;
  yLow: number;
  yHigh: number;
  sentence: string;
  points: [number, number][];
};

const fmt = (v: number) => (Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));

/** The pairs that pass, strongest first. */
export function findings(days: CorrelationDay[]): Finding[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out: Finding[] = [];
  for (const p of PAIRS) {
    const pts = days.flatMap((d) => {
      const [x, y] = p.pick(byDate, d);
      return x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y) ? [[x, y] as [number, number]] : [];
    });
    if (pts.length < MIN_PAIRS) continue;
    const rho = spearman(pts.map(([x]) => x), pts.map(([, y]) => y));
    if (rho === null || Math.abs(rho) < MIN_RHO) continue;
    const sorted = pts.map(([x]) => x).sort((a, b) => a - b);
    const split = sorted[Math.floor(sorted.length / 2)];
    const hi = pts.filter(([x]) => x >= split).map(([, y]) => y);
    const lo = pts.filter(([x]) => x < split).map(([, y]) => y);
    if (!hi.length || !lo.length) continue;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const yHigh = mean(hi);
    const yLow = mean(lo);
    const pct = yLow !== 0 ? ((yHigh - yLow) / Math.abs(yLow)) * 100 : 0;
    const dir = pct >= 0 ? "higher" : "lower";
    const sentence = `With ${p.x} at ${fmt(split)}${p.unitX ? ` ${p.unitX}` : ""} or more, ${p.y} goes with ${Math.abs(Math.round(pct))} % ${dir} (${fmt(yHigh)} against ${fmt(yLow)}${p.unitY ? ` ${p.unitY}` : ""}; ${pts.length} days).`;
    out.push({ id: p.id, rho, n: pts.length, split, yLow, yHigh, sentence, points: pts });
  }
  return out.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
}
