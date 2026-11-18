/**
 * The outdoor target of a bike step (docs/plans/bike-ride-logger.md, 4.2).
 * Outdoors there is often no power meter, so a step the assistant wrote no
 * outdoor target for gets one from its indoor power target: a heart rate
 * range of the same zone, a heart rate cap, or an effort (1-10).
 *
 * Pure: the bike exercise screen and the frozen ride plan both call it.
 */

import { DEFAULT_UNITS, type Units } from "@/lib/utils/units";
import { mainTarget, resolveTarget, type ResolvedTarget, type RideTest, type ThresholdValues, type WorkoutStep, type WorkoutTarget } from "@/lib/utils/workout-steps";

/**
 * Coggan power zone (1-7) of a percent of FTP: zone 1 up to 55, 2 up to 75,
 * 3 up to 90, 4 up to 105, 5 up to 120, 6 up to 150, 7 above. A value on a
 * zone's start belongs to the zone below (75% FTP is zone 2), so the low and
 * the high end of a range are read the same way.
 */
export function powerZone(pctFtp: number): number {
  const upTo = [55, 75, 90, 105, 120, 150];
  let z = 1;
  for (const u of upTo) if (pctFtp > u) z++;
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

/** Power zone of the low end of a step's indoor target: a zone target's own zone, else powerZone of its low end. */
export function powerLowZone(step: Pick<WorkoutStep, "target" | "ramp">, ftp: number | undefined): number | null {
  const t = mainTarget(step);
  if (t?.metric === "power" && t.zone !== undefined) return t.zone;
  const pct = powerLowPct(step, ftp);
  return pct === null ? null : powerZone(pct);
}

/** Friel bike heart rate zones in % LTHR, for zones 2 to 4, and the top of zone 1. */
const HR_RANGE: Record<number, [number, number]> = { 2: [81, 89], 3: [90, 93], 4: [94, 99] };
const HR_CAP_PCT = 81;

/** Friel bike heart rate zone (1-5) of a percent of bike LTHR: zone 2 from 81, 3 from 90, 4 from 94, 5 from 100. */
export function bikeHrZone(pctLthr: number): number {
  let z = 1;
  for (const from of [81, 90, 94, 100]) if (pctLthr >= from) z++;
  return z;
}
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
 * warm-up, cool-down and ramp get a heart rate cap at the top of zone 1
 * (a warm-up or cool-down with a heart rate target keeps that target);
 * recovery, zone 1 and free spin effort 2; work of 5 min or more in zone 2
 * to 4 the heart rate range of that zone; under 3 min or zone 5 and above an
 * effort; 3 to 5 min the heart rate range with the effort as a second line.
 * Without a bike LTHR each heart rate target becomes its effort. A rest step,
 * and a work step whose zone is unknown, get none.
 *
 * An FTP test ride (`test`, 4.9) is ridden by effort outdoors, never by a
 * heart rate cap or range: each step gets the effort of its zone, as without
 * a bike LTHR; a step whose own target is an effort keeps it; a work ramp
 * takes the effort of the zone of its top end, as it is ridden to failure.
 *
 * `seconds` is the step's time, or its estimate for a distance or lap step.
 */
export function outdoorTarget(
  step: WorkoutStep,
  seconds: number,
  thresholds: ThresholdValues,
  units: Units = DEFAULT_UNITS,
  test?: RideTest,
): OutdoorTarget | null {
  if (step.outdoor) {
    const r = resolveTarget(step.outdoor, "bike", thresholds, units);
    if (!r.missing) return { main: { ...r, text: writtenText(step.outdoor, r) }, second: null };
  }
  if (step.type === "rest") return null;
  if (test) {
    if (step.target?.metric === "rpe") {
      const r = resolveTarget(step.target, "bike", thresholds, units);
      return { main: { ...r, text: writtenText(step.target, r) }, second: null };
    }
    if (step.type === "work" && step.ramp) {
      const top = powerLowPct({ target: { metric: "power", anchor: step.ramp.anchor, low: step.ramp.to, high: step.ramp.to } }, thresholds.ftp);
      return top === null ? null : { main: effort(EFFORT[powerZone(top)]), second: null };
    }
    const { lthr_bike: _hr, ...noHr } = thresholds;
    void _hr;
    return outdoorTarget(step, seconds, noHr, units);
  }
  const lthr = thresholds.lthr_bike;
  const cap = lthr ? hrCap(lthr) : effort(EFFORT[1]);
  if (step.type === "warmup" || step.type === "cooldown" || step.ramp) {
    // A warm-up or cool-down already ridden by heart rate keeps its target.
    if (step.target?.metric === "hr") {
      const r = resolveTarget(step.target, "bike", thresholds, units);
      if (!r.missing) return { main: { ...r, text: writtenText(step.target, r) }, second: null };
    }
    return { main: cap, second: null };
  }
  const zone = powerLowZone(step, thresholds.ftp);
  if (step.type === "recovery" || step.free || zone === 1) return { main: effort(EFFORT[1]), second: null };
  if (zone === null) return null;
  if (zone >= 5 || seconds < 180) return { main: effort(EFFORT[zone]), second: null };
  if (!lthr) return { main: effort(EFFORT[zone]), second: null };
  return { main: hrRange(lthr, HR_RANGE[zone]), second: seconds < 300 ? effort(EFFORT[zone]) : null };
}
