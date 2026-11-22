/**
 * The treadmill belts the runner ran and the heart rate on them, for the
 * coach to set belt speeds per zone (docs/plans/strict-targets.md, decision 7:
 * from the belts the app logged, not the watch's indoor speed). Built from
 * the same step history the run plan reads (runPlanHistory).
 */

import type { BeltHistoryStep } from "@/lib/utils/run-plan";

export type BeltHeartRate = { beltKmh: number; avgHr: number; minutes: number; steps: number };

/** One row per belt speed (to 0.1 km/h): the time-weighted average heart rate and the minutes run, slowest first. */
export function beltHeartRates(history: BeltHistoryStep[]): BeltHeartRate[] {
  const byBelt = new Map<number, { hrSeconds: number; seconds: number; steps: number }>();
  for (const s of history) {
    if (!(s.seconds > 0)) continue;
    const belt = Math.round(s.beltKmh * 10) / 10;
    const g = byBelt.get(belt) ?? { hrSeconds: 0, seconds: 0, steps: 0 };
    g.hrSeconds += s.avgHr * s.seconds;
    g.seconds += s.seconds;
    g.steps += 1;
    byBelt.set(belt, g);
  }
  return [...byBelt]
    .sort(([a], [b]) => a - b)
    .map(([beltKmh, g]) => ({ beltKmh, avgHr: Math.round(g.hrSeconds / g.seconds), minutes: Math.round((g.seconds / 60) * 10) / 10, steps: g.steps }));
}
