/**
 * Average cadence of a Garmin activity and its laps, for the coach to estimate
 * the athlete's typical cadence (docs/plans/strict-targets.md, decision 11).
 * Rides in rpm, runs in steps per minute. Other sports have none here.
 */

import type { Sport } from "./analytics/sport";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** From Garmin's activity summary, which already counts both feet on a run. */
export function summaryCadence(sport: Sport, summary: Record<string, unknown> | null | undefined): number | null {
  const v =
    sport === "bike" ? num(summary?.averageBikingCadenceInRevPerMinute) : sport === "run" ? num(summary?.averageRunningCadenceInStepsPerMinute) : null;
  return v === null ? null : Math.round(v);
}

/** From a FIT lap. FIT stores run cadence per foot (strides), so a run's is doubled to steps per minute. */
export function lapCadence(sport: Sport, lap: Record<string, unknown>): number | null {
  if (sport !== "bike" && sport !== "run") return null;
  const whole = num(lap.avgCadence);
  if (whole === null) return null;
  const v = whole + (num(lap.avgFractionalCadence) ?? 0);
  return Math.round(sport === "run" ? v * 2 : v);
}
