/**
 * "2 Base · Run" of the run logger mockups (docs/plans/run-logger.md, 4.9):
 * warm-up 10 min at 7.5 km/h with 1% incline, steady 50 min in heart rate
 * zone 2, 6 strides of 30 s at 13 km/h with 90 s at 7 km/h, cool-down 3 min
 * walk. 75 min. OWNER holds the owner's threshold pace 5:39 /km and LTHR 180.
 */

import type { ThresholdValues } from "@/lib/utils/workout-steps";

export const BASE_RUN = {
  v: 2,
  sport: "run",
  name: "2 Base · Run",
  steps: [
    { type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 1 }, belt: 7.5, incline: 1 },
    { type: "work", end: { type: "time", seconds: 3000 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
    {
      type: "repeat",
      count: 6,
      steps: [
        { type: "work", end: { type: "time", seconds: 30 }, target: { metric: "rpe", anchor: "absolute", low: 9, high: 9 }, belt: 13 },
        { type: "recovery", end: { type: "time", seconds: 90 }, target: { metric: "rpe", anchor: "absolute", low: 2, high: 3 }, belt: 7 },
      ],
    },
    { type: "cooldown", end: { type: "time", seconds: 180 }, target: { metric: "rpe", anchor: "absolute", low: 1, high: 2 } },
  ],
};

export const OWNER: ThresholdValues = { run_threshold_pace: 1000 / 339, lthr_run: 180 };

