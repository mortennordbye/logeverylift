/**
 * The numbers of a run that need no Garmin stream (docs/plans/run-logger.md,
 * 4.9): distance and moving pace from the steps, grade-adjusted pace (GAP)
 * from the belt and incline, the load per step, and time in heart rate zones
 * by step average.
 *
 * - GAP: `gapSpeed` (src/lib/utils/run-gap.ts), Minetti 2002 with a treadmill's
 *   first 1% counted as flat.
 * - Load: per step, hours x IF^2 x 100 with IF = GAP speed / threshold speed,
 *   summed. Only when distance covers 90% of the run's time, a threshold pace
 *   is set and the surface is not Trail or snow; else the effort load
 *   (minutes x RPE x 0.22). Both are estimates.
 * - Totals count the active seconds and distance of skipped steps too: a
 *   skipped step was still run (4.7). The caller passes them in.
 *
 * Pure: the summary screen and `appSessionLoads` both call it.
 */

import { gapSpeed } from "@/lib/utils/run-gap";
import { minSec } from "@/lib/utils/thresholds";
import { IF_RANGE, RUN_PACE_FLOOR, srpeLoad } from "@/lib/utils/training-load";
import { runHrZoneOf } from "@/lib/utils/workout-steps";

/** Distance on steps that cover this share of the run's time gives a pace load, as power does for a ride. */
export const DISTANCE_COVERAGE_MIN = 0.9;

/** "7:39 /km": seconds per km, cut to the whole second as a watch shows it. */
export function paceText(secondsPerKm: number): string {
  return `${minSec(Math.floor(secondsPerKm))} /km`;
}

/** One run step: its active seconds, meters when known, time-weighted incline in % and average heart rate. */
export type RunDoneStep = { seconds: number; meters: number | null; inclinePct: number | null; avgHr: number | null };

export type RunLoad = {
  value: number;
  /** "pace": hours x IF^2 x 100 per step; "effort": minutes x RPE x 0.22. Both are estimates. */
  method: "pace" | "effort";
  estimated: true;
};

export type DoneRunNumbers = {
  /** Active seconds of all the steps. */
  seconds: number;
  /** Meters of the steps with a distance; null when no step has one. */
  meters: number | null;
  /** Moving pace in seconds per km over the steps with a distance; null without one. */
  paceSPerKm: number | null;
  /** Grade-adjusted pace in seconds per km; null without a distance. */
  gapSPerKm: number | null;
  /** Time-weighted average heart rate of the steps with one. */
  avgHr: number | null;
  /** IF of the whole run (the root of the time-weighted mean of IF^2); null without the pace load. */
  intensityFactor: number | null;
  /** Null: no load, listed as missing (no pace load and no effort). */
  load: RunLoad | null;
  /** Minutes per heart rate zone (Friel, run LTHR) by step average, index 0 is zone 1; all 0 without an LTHR. */
  hrZoneMinutes: number[];
};

/** The numbers of the run steps that were run (the caller leaves out steps not run). */
export function doneRunNumbers(
  steps: RunDoneStep[],
  opts: { thresholdSpeed: number | null | undefined; lthr: number | null | undefined; rpe: number | null; treadmill: boolean; surface?: "road" | "trail" | null },
): DoneRunNumbers {
  const run = steps.filter((s) => s.seconds > 0);
  const seconds = run.reduce((a, s) => a + s.seconds, 0);
  const measured = run.filter((s): s is RunDoneStep & { meters: number } => s.meters !== null && s.meters >= 0);
  const distSeconds = measured.reduce((a, s) => a + s.seconds, 0);
  const meters = measured.length ? measured.reduce((a, s) => a + s.meters, 0) : null;
  const paceSPerKm = meters ? distSeconds / (meters / 1000) : null;
  const gap = measured.map((s) => ({ seconds: s.seconds, speed: gapSpeed(s.meters / s.seconds, s.inclinePct, opts.treadmill) }));
  const gapMeters = gap.reduce((a, s) => a + s.speed * s.seconds, 0);
  const gapSPerKm = gapMeters > 0 ? distSeconds / (gapMeters / 1000) : null;

  const hr = run.filter((s): s is RunDoneStep & { avgHr: number } => s.avgHr !== null);
  const hrSeconds = hr.reduce((a, s) => a + s.seconds, 0);
  const avgHr = hrSeconds > 0 ? hr.reduce((a, s) => a + s.avgHr * s.seconds, 0) / hrSeconds : null;

  const thr = opts.thresholdSpeed && opts.thresholdSpeed > 0 ? opts.thresholdSpeed : null;
  let load: RunLoad | null = null;
  let intensityFactor: number | null = null;
  const covered = seconds > 0 && distSeconds / seconds >= DISTANCE_COVERAGE_MIN;
  const floors = (meters ?? 0) >= RUN_PACE_FLOOR.meters && seconds >= RUN_PACE_FLOOR.seconds;
  if (thr && covered && floors && opts.surface !== "trail") {
    // The steps without a distance (at most 10% of the time) count at the mean IF^2 of the others.
    const meanIf2 = gap.reduce((a, s) => a + s.seconds * (s.speed / thr) ** 2, 0) / distSeconds;
    const ifRun = Math.sqrt(meanIf2);
    if (ifRun >= IF_RANGE.min && ifRun <= IF_RANGE.max) {
      intensityFactor = ifRun;
      load = { value: (seconds / 3600) * meanIf2 * 100, method: "pace", estimated: true };
    }
  }
  if (!load) {
    const effort = srpeLoad(seconds / 60, opts.rpe);
    if (effort !== null) load = { value: effort, method: "effort", estimated: true };
  }

  const zoneSeconds = [0, 0, 0, 0, 0];
  if (opts.lthr) for (const s of hr) zoneSeconds[runHrZoneOf((s.avgHr / opts.lthr) * 100) - 1] += s.seconds;

  return { seconds, meters, paceSPerKm, gapSPerKm, avgHr, intensityFactor, load, hrZoneMinutes: zoneWholeMinutes(zoneSeconds) };
}

/**
 * Seconds per zone as whole minutes that add up to the whole run's minutes:
 * each zone takes its whole minutes, and the minutes left go to the zones
 * with the largest rest (rounding each zone alone gave 67 min for a 66 min run).
 */
export function zoneWholeMinutes(seconds: number[]): number[] {
  const exact = seconds.map((s) => s / 60);
  const out = exact.map(Math.floor);
  let left = Math.round(exact.reduce((a, b) => a + b, 0)) - out.reduce((a, b) => a + b, 0);
  for (const i of exact.map((m, i) => i).sort((a, b) => exact[b] - out[b] - (exact[a] - out[a]))) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}
