/**
 * The numbers of a ridden bike ride without a power stream
 * (docs/plans/bike-ride-logger.md, 4.6): avg power, kJ, time in zones by step
 * average, and the load by the 4.6 rules.
 *
 * - Avg power: time-weighted over the steps with a power value.
 * - Load: an estimated power load (time-weighted fourth-power mean of the
 *   step averages as NP, IF = NP / FTP, hours x IF^2 x 100) only when power
 *   covers at least 90% of the ridden time and an FTP is set. Else the effort
 *   load (minutes x RPE x 0.22, `srpeLoad`). Else no load.
 * - kJ: avg power x seconds / 1000, only when power covers 90% of the time.
 *
 * NP and IF from Garmin's 1 s stream come with step 7: a ride with a stream
 * fills `np` and `intensityFactor` and its load is not an estimate. Until then
 * they are null and the summary shows no NP or IF tile.
 *
 * Pure: the summary screen and `appSessionLoads` both call it.
 */

import { powerZone } from "@/lib/utils/bike-outdoor";
import { plannedPowerIf, srpeLoad } from "@/lib/utils/training-load";

/** Power on steps that cover at least this share of the ridden time gives a power load (4.6). */
export const POWER_COVERAGE_MIN = 0.9;

/** One ridden step: its ridden seconds and its average power, if known. */
export type RiddenStep = { seconds: number; avgPower: number | null };

export type RideLoad = {
  value: number;
  /** "power": from the step averages (est.); "effort": minutes x RPE x 0.22 (est.). */
  method: "power" | "effort";
  estimated: boolean;
};

export type DoneRideNumbers = {
  /** Ridden seconds of all the steps. */
  seconds: number;
  /** Time-weighted avg power of the steps with power; null when no step has one. */
  avgPower: number | null;
  /** Share of the ridden time with a power value, 0 to 1. */
  powerCoverage: number;
  /** NP and IF from a Garmin stream (step 7); null without one. */
  np: number | null;
  intensityFactor: number | null;
  /** NP estimated from the step averages; null unless the power load applies. */
  npEstimate: number | null;
  kj: number | null;
  /** Null: no load, listed as missing (no power with an FTP, no effort). */
  load: RideLoad | null;
  /** Minutes per power zone by step average, index 0 is zone 1; all 0 without an FTP. */
  zoneMinutes: number[];
};

/** Numbers of the ridden steps (skipped and not ridden steps left out by the caller). */
export function doneRideNumbers(steps: RiddenStep[], opts: { ftp: number | null; rpe: number | null }): DoneRideNumbers {
  const ridden = steps.filter((s) => s.seconds > 0);
  const seconds = ridden.reduce((a, s) => a + s.seconds, 0);
  const powered = ridden.filter((s) => s.avgPower !== null && s.avgPower >= 0) as { seconds: number; avgPower: number }[];
  const powerSeconds = powered.reduce((a, s) => a + s.seconds, 0);
  const avgPower = powerSeconds > 0 ? powered.reduce((a, s) => a + s.avgPower * s.seconds, 0) / powerSeconds : null;
  const powerCoverage = seconds > 0 ? powerSeconds / seconds : 0;
  const covered = avgPower !== null && powerCoverage >= POWER_COVERAGE_MIN;

  const ftp = opts.ftp && opts.ftp > 0 ? opts.ftp : null;
  let load: RideLoad | null = null;
  let npEstimate: number | null = null;
  if (covered && ftp && avgPower! > 0) {
    // The fourth-power mean of the step averages, as plannedLoad does for a plan.
    const ifEst = plannedPowerIf(powered.map((s) => ({ seconds: s.seconds, intensity: s.avgPower / ftp })))!;
    npEstimate = ifEst * ftp;
    load = { value: (seconds / 3600) * ifEst ** 2 * 100, method: "power", estimated: true };
  } else {
    const effort = srpeLoad(seconds / 60, opts.rpe);
    if (effort !== null) load = { value: effort, method: "effort", estimated: true };
  }

  const zoneSeconds = [0, 0, 0, 0, 0, 0, 0];
  if (ftp) for (const s of powered) zoneSeconds[powerZone((s.avgPower / ftp) * 100) - 1] += s.seconds;

  return {
    seconds,
    avgPower,
    powerCoverage,
    np: null,
    intensityFactor: null,
    npEstimate,
    kj: covered ? Math.round((avgPower! * seconds) / 1000) : null,
    load,
    zoneMinutes: zoneSeconds.map((z) => Math.round(z / 60)),
  };
}
