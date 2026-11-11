/**
 * Efficiency factor and aerobic decoupling (docs/plans/garmin-insights-design.md, 2.7).
 *
 *   EF (ride) = normalized power / mean HR      EF (run) = speed in m/min / mean HR
 *   decoupling = (EF first half - EF second half) / EF first half x 100
 *
 * Under 5 % means the aerobic base holds for the session's length. Valid only
 * for a steady session: 60 min or more on a bike, 45 on a run, the first
 * 10 min dropped, ride variability index under 1.10. Runs use plain speed
 * (no grade adjustment yet), so hilly runs say so instead of giving a number.
 */

import { normalizedPower, sampleDurations } from "./load";

type Series = (number | null)[];

export type Decoupling =
  | { valid: true; efFirst: number; efSecond: number; pct: number; ef: number; minutes: number; temperature: number | null }
  | { valid: false; reason: string; ef: number | null };

const WARMUP_S = 600;
const MIN_RIDE_S = 3600;
const MIN_RUN_S = 2700;
const MAX_VI = 1.1;
/** Mean output (power or speed) may differ this much between halves; more is a progressive session, not a steady one. */
const MAX_OUTPUT_CHANGE = 0.1;
/** Elevation gain per km above which a run's plain speed is not comparable between halves. */
const MAX_RUN_CLIMB_M_PER_KM = 15;

function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Indices of samples from `from` seconds on, split into two halves of equal time. */
function halves(t: Series, from: number): [number[], number[]] | null {
  const idx = t.map((v, i) => [v, i] as const).filter(([v]) => v !== null && v >= from).map(([, i]) => i);
  if (idx.length < 20) return null;
  const mid = ((t[idx[0]] as number) + (t[idx.at(-1)!] as number)) / 2;
  return [idx.filter((i) => (t[i] as number) < mid), idx.filter((i) => (t[i] as number) >= mid)];
}

function pick(series: Series, idx: number[]) {
  return idx.map((i) => series[i]);
}

function nonNull(xs: Series) {
  return xs.filter((x): x is number => x !== null && x > 0);
}

/** Raw altitude jitters by a metre or two; climb only counts once it passes this. */
const CLIMB_DEADBAND_M = 3;

/**
 * Metres climbed per km: Garmin's filtered gain when the summary has it, else
 * the altitude stream with a deadband, so sensor noise doesn't add up to hills.
 */
export function runClimbPerKm(input: { altitude?: Series; distance?: Series; elevationGainM?: number | null; distanceM?: number | null }): number | null {
  if (input.elevationGainM != null && input.distanceM) return input.elevationGainM / (input.distanceM / 1000);
  const alt = input.altitude ? nonNull(input.altitude) : [];
  const dist = input.distance ? nonNull(input.distance) : [];
  if (alt.length < 2 || dist.length < 2) return null;
  let climb = 0;
  let anchor = alt[0];
  for (const a of alt) {
    if (a - anchor >= CLIMB_DEADBAND_M) {
      climb += a - anchor;
      anchor = a;
    } else if (anchor - a >= CLIMB_DEADBAND_M) {
      anchor = a;
    }
  }
  const km = (dist.at(-1)! - dist[0]) / 1000;
  return km > 0 ? climb / km : null;
}

export function decoupling(input: {
  sport: "bike" | "run" | string;
  t: Series;
  hr: Series | undefined;
  power?: Series;
  speed?: Series;
  altitude?: Series;
  distance?: Series;
  temperature?: Series;
  /** Garmin's filtered elevation gain and distance for the session, preferred over the raw altitude stream. */
  elevationGainM?: number | null;
  distanceM?: number | null;
  /** A treadmill run: its speed is the watch's estimate, not measured. */
  treadmill?: boolean;
}): Decoupling {
  const { t, hr } = input;
  if (!hr || nonNull(hr).length < 60) return { valid: false, reason: "No heart rate", ef: null };
  const moving = sampleDurations(t).reduce((a, b) => a + b, 0);
  const temperature = input.temperature ? mean(nonNull(input.temperature)) : null;

  if (input.sport === "bike" && input.power && nonNull(input.power).length > 60) {
    const np = normalizedPower(t, input.power);
    const hrMean = mean(nonNull(hr));
    const ef = np && hrMean ? np / hrMean : null;
    if (moving < MIN_RIDE_S) return { valid: false, reason: "Under 60 min", ef };
    const meanPower = mean(nonNull(input.power));
    if (np && meanPower && np / meanPower > MAX_VI) return { valid: false, reason: "Not a steady session (intervals)", ef };
    const h = halves(t, WARMUP_S);
    if (!h) return { valid: false, reason: "Too few samples", ef };
    const [p1, p2] = h.map((idx) => mean(nonNull(pick(input.power!, idx))));
    if (p1 && p2 && Math.abs(p2 - p1) / p1 > MAX_OUTPUT_CHANGE) return { valid: false, reason: "Output changed between halves (progressive session)", ef };
    const efOf = (idx: number[]) => {
      const p = normalizedPower(pick(t, idx), pick(input.power!, idx));
      const m = mean(nonNull(pick(hr, idx)));
      return p && m ? p / m : null;
    };
    const [a, b] = h.map(efOf);
    if (!a || !b) return { valid: false, reason: "Too few samples", ef };
    return { valid: true, efFirst: a, efSecond: b, pct: ((a - b) / a) * 100, ef: ef ?? a, minutes: moving / 60, temperature };
  }

  if (input.sport === "run" && input.speed && nonNull(input.speed).length > 60) {
    const speedMean = mean(nonNull(input.speed));
    const hrMean = mean(nonNull(hr));
    const ef = speedMean && hrMean ? (speedMean * 60) / hrMean : null;
    if (input.treadmill) return { valid: false, reason: "Treadmill pace is not measured", ef };
    if (moving < MIN_RUN_S) return { valid: false, reason: "Under 45 min", ef };
    const climbPerKm = runClimbPerKm(input);
    if (climbPerKm !== null && climbPerKm > MAX_RUN_CLIMB_M_PER_KM) return { valid: false, reason: "Too hilly for a flat-speed comparison", ef };
    const h = halves(t, WARMUP_S);
    if (!h) return { valid: false, reason: "Too few samples", ef };
    const [s1, s2] = h.map((idx) => mean(nonNull(pick(input.speed!, idx))));
    if (s1 && s2 && Math.abs(s2 - s1) / s1 > MAX_OUTPUT_CHANGE) return { valid: false, reason: "Output changed between halves (progressive session)", ef };
    const efOf = (idx: number[]) => {
      const s = mean(nonNull(pick(input.speed!, idx)));
      const m = mean(nonNull(pick(hr, idx)));
      return s && m ? (s * 60) / m : null;
    };
    const [a, b] = h.map(efOf);
    if (!a || !b) return { valid: false, reason: "Too few samples", ef };
    return { valid: true, efFirst: a, efSecond: b, pct: ((a - b) / a) * 100, ef: ef ?? a, minutes: moving / 60, temperature };
  }

  return { valid: false, reason: input.sport === "bike" ? "No power" : input.sport === "run" ? "No speed" : "Rides and runs only", ef: null };
}
