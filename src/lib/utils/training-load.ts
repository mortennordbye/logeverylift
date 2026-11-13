/**
 * Load without Garmin (package D1, docs/plans/endurance-app.md, section 6).
 *
 * One scale with the Garmin models in src/lib/garmin/analytics/load.ts:
 * 100 = one hour at threshold (decision I-3 in docs/plans/garmin-insights-design.md).
 *
 * Evidence (endurance-app.md 6.6):
 * - TSS = hours x IF^2 x 100: coach convention (research, "Race intensity sets
 *   the ceiling for training load"). Using IF from run speed over threshold
 *   speed is inference: the research gives the formula for power only.
 * - Swim load = hours x IF^3 x 100 with IF = speed / CSS: inference, from the
 *   Garmin design (2.2); the research has no swim load.
 * - Session RPE x minutes: inference (research, "Plans become data", strength as
 *   session RPE x minutes); the 0.22 factor is the Garmin design's strength scale.
 * - CTL 42 d, ATL 7 d, TSB = CTL - ATL: coach convention (research, "CTL ramp
 *   limits are conventions"); computed by computePmc.
 * - Planned load default IF per step type: inference (this brief).
 * The research reference has no section on these three load models; a research
 * pass is in BACKLOG (decision 20).
 */

import { computePmc, type DayLoad, type PmcDay } from "@/lib/garmin/analytics/pmc";
import type { Sport } from "@/lib/garmin/analytics/sport";

export type EnduranceSport = "swim" | "bike" | "run";
export type LoadMethod = "run_pace" | "swim_css" | "srpe" | "none";

/** One hour at RPE 7.5 is about 100, as for strength (load.ts). Inference. */
export const SRPE_FACTOR = 0.22;

/** IF outside this range is bad data (a typo in distance or time): fall through to the next method. */
export const IF_RANGE = { min: 0.3, max: 1.5 } as const;
/** Floors for the pace models: shorter efforts give no trustworthy speed. Inference. */
export const RUN_PACE_FLOOR = { meters: 400, seconds: 300 } as const;
export const SWIM_CSS_FLOOR = { meters: 100, seconds: 120 } as const;

/** Session RPE load: minutes x RPE x 0.22. RPE 1-10; null without time or RPE. */
export function srpeLoad(minutes: number, rpe: number | null | undefined): number | null {
  if (!(minutes > 0) || rpe === null || rpe === undefined || !(rpe >= 1 && rpe <= 10)) return null;
  return minutes * rpe * SRPE_FACTOR;
}

/** Duration-weighted mean RPE of a session's sets; sets without RPE or time are left out. */
export function weightedRpe(sets: { durationSeconds: number | null; rpe: number | null }[]): number | null {
  let w = 0;
  let sum = 0;
  for (const s of sets) {
    if (s.rpe === null || !(s.rpe >= 1 && s.rpe <= 10) || !(s.durationSeconds && s.durationSeconds > 0)) continue;
    w += s.durationSeconds;
    sum += s.rpe * s.durationSeconds;
  }
  return w > 0 ? sum / w : null;
}

/** Run pace load: hours x IF^2 x 100, IF = speed / threshold speed (m/s). Inference. */
export function runPaceLoad(
  r: { seconds: number; meters: number; inclinePercent?: number | null },
  thresholdSpeed: number | null | undefined,
): { load: number; intensityFactor: number } | null {
  if (!thresholdSpeed || thresholdSpeed <= 0) return null;
  if (r.inclinePercent) return null; // pace does not see the hill: sRPE instead
  if (r.meters < RUN_PACE_FLOOR.meters || r.seconds < RUN_PACE_FLOOR.seconds) return null;
  const intensityFactor = r.meters / r.seconds / thresholdSpeed;
  if (intensityFactor < IF_RANGE.min || intensityFactor > IF_RANGE.max) return null;
  return { load: (r.seconds / 3600) * intensityFactor ** 2 * 100, intensityFactor };
}

/** Swim load: hours x IF^3 x 100, IF = speed / CSS (m/s). Time is the moving time when known. Inference. */
export function swimCssLoad(s: { seconds: number; meters: number }, css: number | null | undefined): { load: number; intensityFactor: number } | null {
  if (!css || css <= 0) return null;
  if (s.meters < SWIM_CSS_FLOOR.meters || s.seconds < SWIM_CSS_FLOOR.seconds) return null;
  const intensityFactor = s.meters / s.seconds / css;
  if (intensityFactor < IF_RANGE.min || intensityFactor > IF_RANGE.max) return null;
  return { load: (s.seconds / 3600) * intensityFactor ** 3 * 100, intensityFactor };
}

export type LoadAnchors = { runThresholdSpeed?: number | null; swimCss?: number | null; ftp?: number | null };

export type SessionLoadInput = {
  sport: EnduranceSport;
  seconds: number;
  meters?: number | null;
  inclinePercent?: number | null;
  /** Moving time without wall rest, from step results (swim only). */
  movingSeconds?: number | null;
  rpe?: number | null;
};

export type SessionLoad = { load: number | null; method: LoadMethod; reason?: "needs_rpe" | "no_time" };

/**
 * The load of one endurance session (decision 12): run pace, then sRPE; CSS,
 * then sRPE; bike sRPE. No RPE and no usable anchor gives no load, never a
 * default (decision 22).
 */
export function sessionLoad(s: SessionLoadInput, anchors: LoadAnchors): SessionLoad {
  if (!(s.seconds > 0)) return { load: null, method: "none", reason: "no_time" };
  const meters = s.meters ?? 0;
  if (s.sport === "run") {
    const p = runPaceLoad({ seconds: s.seconds, meters, inclinePercent: s.inclinePercent }, anchors.runThresholdSpeed);
    if (p) return { load: p.load, method: "run_pace" };
  }
  if (s.sport === "swim") {
    // Moving time leaves the wall rest out; it is never longer than the logged time (review fix 3).
    const seconds = s.movingSeconds && s.movingSeconds > 0 ? Math.min(s.movingSeconds, s.seconds) : s.seconds;
    const p = swimCssLoad({ seconds, meters }, anchors.swimCss);
    if (p) return { load: p.load, method: "swim_css" };
  }
  const r = srpeLoad(s.seconds / 60, s.rpe);
  return r !== null ? { load: r, method: "srpe" } : { load: null, method: "none", reason: "needs_rpe" };
}

// ── Planned load (estimate, endurance-app.md 6.2) ────────────────────────────

/** Default IF when a step has no power or pace target. Inference. */
export const DEFAULT_IF: Record<"warmup" | "work" | "recovery" | "cooldown" | "rest", number> = {
  warmup: 0.65,
  cooldown: 0.65,
  recovery: 0.55,
  work: 0.8,
  rest: 0,
};

/** Coggan power zone midpoints in % FTP (research zone table; zone 1 and 5 closed at 45 and 112). Inference. */
const POWER_ZONE_MID = [45, 65, 82, 97, 112];

export type PlannedTarget = {
  metric: "power" | "hr" | "pace" | "cadence";
  anchor: "ftp" | "lthr" | "max_hr" | "threshold_pace" | "css" | "absolute";
  low?: number;
  high?: number;
  zone?: number;
  offsetLow?: number;
  offsetHigh?: number;
};
export type PlannedStep = { type: keyof typeof DEFAULT_IF; seconds: number | null; target?: PlannedTarget };

/** IF of one step from its target, or null when the target gives none (heart rate, cadence, a missing anchor). */
export function stepIntensity(sport: EnduranceSport, t: PlannedTarget | undefined, anchors: LoadAnchors): number | null {
  if (!t) return null;
  const mid = t.low !== undefined && t.high !== undefined ? (t.low + t.high) / 2 : null;
  if (t.metric === "power" && sport === "bike") {
    if (t.anchor === "ftp") {
      if (t.zone !== undefined) {
        const z = POWER_ZONE_MID[t.zone - 1];
        return z !== undefined ? z / 100 : null;
      }
      return mid !== null ? mid / 100 : null;
    }
    if (t.anchor === "absolute" && mid !== null && anchors.ftp) return mid / anchors.ftp;
    return null;
  }
  if (t.metric === "pace") {
    const anchor = sport === "run" ? anchors.runThresholdSpeed : sport === "swim" ? anchors.swimCss : null;
    if (t.anchor === "threshold_pace" || (t.anchor === "css" && t.offsetLow === undefined)) return mid !== null ? mid / 100 : null;
    if (t.anchor === "css" && t.offsetLow !== undefined && t.offsetHigh !== undefined && anchors.swimCss) {
      const speed = 100 / (100 / anchors.swimCss + (t.offsetLow + t.offsetHigh) / 2);
      return speed / anchors.swimCss;
    }
    if (t.anchor === "absolute" && mid !== null && anchor) return mid / anchor;
    return null;
  }
  return null;
}

/**
 * Estimated load of a planned workout, from steps already expanded and timed
 * (C4's estimate gives the seconds). `partial` is true when a step had no time
 * or used a default IF.
 */
export function plannedLoad(sport: EnduranceSport, steps: PlannedStep[], anchors: LoadAnchors): { load: number; partial: boolean } {
  const exponent = sport === "swim" ? 3 : 2;
  let load = 0;
  let partial = false;
  for (const s of steps) {
    if (s.seconds === null) {
      partial = true;
      continue;
    }
    let intensity = stepIntensity(sport, s.target, anchors);
    if (intensity === null) {
      intensity = DEFAULT_IF[s.type];
      if (s.type !== "rest") partial = true;
    }
    load += (s.seconds / 3600) * intensity ** exponent * 100;
  }
  return { load, partial };
}

// ── Garmin pairing and the series (endurance-app.md 6.4) ─────────────────────

/** durationS null: a Garmin activity with no start or end time; it pairs by sport and day, after the timed ones. */
export type PairItem = { id: number; sport: EnduranceSport; date: string; durationS: number | null };

/**
 * Pair app endurance sessions with Garmin activities one to one: same sport,
 * same local date, closest duration first (decision 16). A paired app session
 * adds no load; Garmin measured it.
 */
export function pairWithGarmin(app: PairItem[], garmin: PairItem[]): Map<number, number> {
  const candidates: { a: PairItem; g: PairItem; diff: number }[] = [];
  for (const a of app) {
    for (const g of garmin) {
      if (a.sport !== g.sport || a.date !== g.date) continue;
      const diff = a.durationS === null || g.durationS === null ? Number.MAX_SAFE_INTEGER : Math.abs(a.durationS - g.durationS);
      candidates.push({ a, g, diff });
    }
  }
  candidates.sort((x, y) => x.diff - y.diff || x.a.id - y.a.id || x.g.id - y.g.id);
  const pairs = new Map<number, number>();
  const usedGarmin = new Set<number>();
  for (const c of candidates) {
    if (pairs.has(c.a.id) || usedGarmin.has(c.g.id)) continue;
    pairs.set(c.a.id, c.g.id);
    usedGarmin.add(c.g.id);
  }
  return pairs;
}

/** One source of fitness per user, never both added (decision 16, 6.4). */
export function loadSource(p: { garminAllowed: boolean; garminDays: number }): "garmin" | "app" {
  return p.garminAllowed && p.garminDays > 0 ? "garmin" : "app";
}

export type AppSessionLoad = { id: number; date: string; sport: Sport; load: number | null; method: LoadMethod | "strength_srpe" };

/** Sum loads per day and sport; sessions with no load are listed, not guessed (decision 22). */
export function dailyLoads(sessions: AppSessionLoad[]): { loads: Record<string, DayLoad>; noLoad: AppSessionLoad[] } {
  const loads: Record<string, DayLoad> = {};
  const noLoad: AppSessionLoad[] = [];
  for (const s of sessions) {
    if (s.load === null) {
      noLoad.push(s);
      continue;
    }
    const day = (loads[s.date] ??= {});
    day[s.sport] = (day[s.sport] ?? 0) + s.load;
  }
  return { loads, noLoad };
}

/** Fitness, fatigue and form from app sessions, with the existing model (pmc.ts). */
export function appPmc(sessions: AppSessionLoad[], start: string, end: string): { days: PmcDay[]; noLoad: AppSessionLoad[] } {
  const { loads, noLoad } = dailyLoads(sessions.filter((s) => s.date >= start && s.date <= end));
  return { days: computePmc(loads, start, end), noLoad };
}
