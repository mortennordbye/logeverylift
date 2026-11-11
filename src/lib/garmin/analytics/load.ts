/**
 * Load per session, on one scale for every sport: 100 = one hour at threshold
 * (docs/plans/garmin-insights-design.md, 2.2 and decision I-3).
 *
 * Streams are columnar arrays aligned by index: t (seconds from start), hr,
 * power. Gaps between samples longer than MAX_GAP_S count as paused time and
 * are not counted (Garmin's smart recording writes a sample every 1 to 5 s).
 */

export type LoadMethod = "power" | "trimp" | "zones" | "srpe" | "garmin_tss" | "none";

/** A sample gap longer than this is a pause. */
export const MAX_GAP_S = 10;

type Series = (number | null)[];

/** Seconds each sample stands for: the time to the next sample, capped at MAX_GAP_S. */
export function sampleDurations(t: Series): number[] {
  return t.map((ti, i) => {
    const next = t[i + 1];
    if (ti === null || next === null || next === undefined) return i === t.length - 1 ? 1 : 0;
    const dt = next - ti;
    return dt > 0 && dt <= MAX_GAP_S ? dt : 0;
  });
}

/**
 * Normalized power: resample to 1 s (holding each sample for its duration),
 * 30 s rolling mean, fourth power, mean, fourth root. Null under 30 s of data.
 */
export function normalizedPower(t: Series, power: Series): number | null {
  const durations = sampleDurations(t);
  const perSecond: number[] = [];
  power.forEach((p, i) => {
    for (let s = 0; s < durations[i]; s++) perSecond.push(p ?? 0);
  });
  if (perSecond.length < 30) return null;
  let window = 0;
  let sum4 = 0;
  let n = 0;
  for (let i = 0; i < perSecond.length; i++) {
    window += perSecond[i];
    if (i >= 30) window -= perSecond[i - 30];
    if (i >= 29) {
      sum4 += (window / 30) ** 4;
      n++;
    }
  }
  return (sum4 / n) ** 0.25;
}

/** Power-based load: seconds x NP x IF / (FTP x 3600) x 100, IF = NP / FTP. */
export function powerLoad(t: Series, power: Series, ftp: number): { load: number; np: number; intensityFactor: number } | null {
  const np = normalizedPower(t, power);
  if (np === null || ftp <= 0) return null;
  const seconds = sampleDurations(t).reduce((a, b) => a + b, 0);
  const intensityFactor = np / ftp;
  return { load: ((seconds * np * intensityFactor) / (ftp * 3600)) * 100, np, intensityFactor };
}

export type HrThresholds = { maxHr: number; restHr: number; lthr: number; female?: boolean };

/** Banister TRIMP weight for one minute at heart-rate reserve fraction x. */
function trimpPerMinute(x: number, female: boolean) {
  const clamped = Math.min(Math.max(x, 0), 1);
  return female ? clamped * 0.86 * Math.exp(1.67 * clamped) : clamped * 0.64 * Math.exp(1.92 * clamped);
}

function reserve(hr: number, th: HrThresholds) {
  return (hr - th.restHr) / (th.maxHr - th.restHr);
}

/** TRIMP of one hour at LTHR: the 100 on our scale. */
export function trimpHourAtThreshold(th: HrThresholds): number {
  return 60 * trimpPerMinute(reserve(th.lthr, th), th.female ?? false);
}

function validThresholds(th: HrThresholds) {
  return th.maxHr > th.restHr && th.lthr > th.restHr && th.lthr <= th.maxHr;
}

/** HR-based load from a stream: TRIMP scaled so one hour at LTHR = 100. */
export function trimpLoad(t: Series, hr: Series, th: HrThresholds): number | null {
  if (!validThresholds(th)) return null;
  const durations = sampleDurations(t);
  let trimp = 0;
  let counted = 0;
  hr.forEach((h, i) => {
    if (h === null || h <= 0 || durations[i] === 0) return;
    trimp += (durations[i] / 60) * trimpPerMinute(reserve(h, th), th.female ?? false);
    counted += durations[i];
  });
  if (counted < 60) return null;
  return (trimp / trimpHourAtThreshold(th)) * 100;
}

/**
 * HR-based load from Garmin's seconds in zones 1 to 5, when there is no
 * stream. Each zone's time counts at its midpoint; floors are zone 1 to 5
 * lower bounds in bpm.
 */
export function zoneLoad(secondsInZone: (number | null)[], floors: number[], th: HrThresholds): number | null {
  if (!validThresholds(th) || floors.length !== 5 || secondsInZone.length !== 5) return null;
  const tops = [...floors.slice(1), th.maxHr];
  let trimp = 0;
  let total = 0;
  secondsInZone.forEach((s, z) => {
    if (!s || s <= 0) return;
    const mid = (floors[z] + tops[z]) / 2;
    trimp += (s / 60) * trimpPerMinute(reserve(mid, th), th.female ?? false);
    total += s;
  });
  if (total < 60) return null;
  return (trimp / trimpHourAtThreshold(th)) * 100;
}

/** Zone floors as % of max HR, when neither the FIT file nor a snapshot gives them. */
const DEFAULT_FLOOR_PCT = [0.5, 0.6, 0.7, 0.8, 0.9];

export function defaultZoneFloors(maxHr: number): number[] {
  return DEFAULT_FLOOR_PCT.map((p) => Math.round(p * maxHr));
}

/** Session RPE from LogEveryLift's feeling when no set has RIR or RPE. A harder-feeling day counts higher. */
const FEELING_RPE: Record<string, number> = { Awesome: 6, Good: 6.5, OK: 7, Tired: 8 };

/** Strength load: minutes x session RPE x 0.22, so one hour at RPE 7.5 is about 100. */
export function strengthLoad(minutes: number, setRpes: (number | null)[], feeling: string | null): { load: number; rpe: number } | null {
  if (!(minutes > 0)) return null;
  const rpes = setRpes.filter((r): r is number => r !== null && r >= 1 && r <= 10);
  const rpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : (feeling && FEELING_RPE[feeling]) || 6;
  return { load: minutes * rpe * 0.22, rpe };
}

/** Share of the shorter session that two time ranges overlap (0 to 1). Times in ms. */
export function overlapShare(a: [number, number], b: [number, number]): number {
  const overlap = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
  const shorter = Math.min(a[1] - a[0], b[1] - b[0]);
  return overlap > 0 && shorter > 0 ? overlap / shorter : 0;
}
