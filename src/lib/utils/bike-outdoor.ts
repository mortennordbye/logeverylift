/**
 * The outdoor target of a bike step (docs/plans/bike-ride-logger.md, 4.2).
 * Outdoors there is often no power meter, so a step the assistant wrote no
 * outdoor target for gets one from its indoor power target: a heart rate
 * range of the same zone, a heart rate cap, or an effort (1-10).
 *
 * Pure: the bike exercise screen and the frozen ride plan both call it.
 */

import { DEFAULT_UNITS, type Units } from "@/lib/utils/units";
import { mainTarget, resolveTarget, type ResolvedTarget, type ThresholdValues, type WorkoutStep, type WorkoutTarget } from "@/lib/utils/workout-steps";

/**
 * Coggan power zone (1-7) of a percent of FTP. The bounds are the zone table
 * of workout-steps.ts (zone 2 from 55, 3 from 75, 4 from 90, 5 from 105),
 * with zone 6 from 121 and zone 7 from 151.
 */
export function powerZone(pctFtp: number): number {
  const from = [55, 75, 90, 105, 121, 151];
  let z = 1;
  for (const f of from) if (pctFtp >= f) z++;
  return z;
}

/** Low end of each power zone in % FTP: zone 1 starts at 0. */
const ZONE_FROM = [0, 55, 75, 90, 105, 121, 151];

/** The low end of a step's indoor power target in % FTP; null when it has no power target, or watts with no FTP. */
export function powerLowPct(step: Pick<WorkoutStep, "target" | "ramp">, ftp: number | undefined): number | null {
  const t = mainTarget(step);
  if (!t || t.metric !== "power") return null;
  if (t.zone !== undefined) return ZONE_FROM[t.zone - 1] ?? null;
  if (t.low === undefined) return null;
  if (t.anchor === "ftp") return t.low;
  return ftp ? (t.low / ftp) * 100 : null;
}

/** Friel bike heart rate zones in % LTHR, for zones 2 to 4, and the top of zone 1. */
const HR_RANGE: Record<number, [number, number]> = { 2: [81, 89], 3: [90, 93], 4: [94, 99] };
const HR_CAP_PCT = 81;
/** Effort per power zone, when heart rate cannot be the target. */
const EFFORT: Record<number, number> = { 1: 2, 2: 4, 3: 6, 4: 7, 5: 8, 6: 9, 7: 10 };

const effort = (n: number): ResolvedTarget => ({ low: n, high: n, unit: "RPE", text: `Effort ${n}`, missing: null });

function hrRange(lthr: number, [lo, hi]: [number, number]): ResolvedTarget {
  const low = Math.round((lthr * lo) / 100);
  const high = Math.round((lthr * hi) / 100);
  return { low, high, unit: "bpm", text: `HR ${low}-${high}`, missing: null };
}

function hrCap(lthr: number): ResolvedTarget {
  const high = Math.round((lthr * HR_CAP_PCT) / 100);
  return { low: null, high, unit: "bpm", text: `HR under ${high}`, missing: null };
}

/** A written outdoor target in the words the bike screen uses: "HR 142-152", "Effort 3". */
function writtenText(t: WorkoutTarget, r: ResolvedTarget): string {
  const n = (v: number) => Math.round(v);
  if (t.metric === "hr") {
    if (r.low === null && r.high !== null) return `HR under ${n(r.high)}`;
    if (r.high === null && r.low !== null) return `HR ${n(r.low)} or more`;
    return r.low !== null && r.high !== null ? (n(r.low) === n(r.high) ? `HR ${n(r.low)}` : `HR ${n(r.low)}-${n(r.high)}`) : r.text;
  }
  if (t.metric === "rpe") return t.low === t.high ? `Effort ${t.low}` : `Effort ${t.low}-${t.high}`;
  return r.text;
}

export type OutdoorTarget = { main: ResolvedTarget; second: ResolvedTarget | null };

/**
 * The outdoor target of one bike step. A written one wins when it resolves;
 * else it is derived from the zone of the indoor target's low end (4.2):
 * warm-up, cool-down and ramp get a heart rate cap at the top of zone 1;
 * recovery, zone 1 and free spin effort 2; work of 5 min or more in zone 2
 * to 4 the heart rate range of that zone; under 3 min or zone 5 and above an
 * effort; 3 to 5 min the heart rate range with the effort as a second line.
 * Without a bike LTHR each heart rate target becomes its effort. A rest step,
 * and a work step whose zone is unknown, get none.
 *
 * `seconds` is the step's time, or its estimate for a distance or lap step.
 */
export function outdoorTarget(step: WorkoutStep, seconds: number, thresholds: ThresholdValues, units: Units = DEFAULT_UNITS): OutdoorTarget | null {
  if (step.outdoor) {
    const r = resolveTarget(step.outdoor, "bike", thresholds, units);
    if (!r.missing) return { main: { ...r, text: writtenText(step.outdoor, r) }, second: null };
  }
  if (step.type === "rest") return null;
  const lthr = thresholds.lthr_bike;
  const cap = lthr ? hrCap(lthr) : effort(EFFORT[1]);
  if (step.type === "warmup" || step.type === "cooldown" || step.ramp) return { main: cap, second: null };
  const pct = powerLowPct(step, thresholds.ftp);
  const zone = pct === null ? null : powerZone(pct);
  if (step.type === "recovery" || step.free || zone === 1) return { main: effort(EFFORT[1]), second: null };
  if (zone === null) return null;
  if (zone >= 5 || seconds < 180) return { main: effort(EFFORT[zone]), second: null };
  if (!lthr) return { main: effort(EFFORT[zone]), second: null };
  return { main: hrRange(lthr, HR_RANGE[zone]), second: seconds < 300 ? effort(EFFORT[zone]) : null };
}
