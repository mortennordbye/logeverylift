/**
 * FTP test rides (docs/plans/bike-ride-logger.md, 4.9): the two templates the
 * step editor and the assistant insert, and the FTP a ridden test gives.
 *
 * - Ramp test: warm-up 10 min, then 1 min steps from 100 W up by 20 W to
 *   500 W. The rider taps Lap (or ends the ride) when they cannot hold the
 *   watts, and that ends the ride (`rideTimeline`). FTP = 75% of the best
 *   1 min power.
 * - 20 min test: warm-up 20 min with two 1 min hard efforts, 5 min easy,
 *   20 min all-out, cool-down 10 min. FTP = 95% of the all-out step's
 *   average power.
 *
 * The power comes from the Garmin stream when a fill stands (the best rolling
 * 60 s, or the all-out step's window), else from the step averages in the
 * results table (the highest done 1 min step, or its target when it has no
 * number; the all-out step's average).
 *
 * Pure: the summary, the Save action and get_ride call it.
 */

import { RAMP_FTP_FACTOR, thresholdRangeError } from "@/lib/utils/thresholds";
import { FTP_FACTOR } from "@/lib/garmin/analytics/trends";
import type { StepLog } from "@/lib/utils/ride-results";
import type { RidePlan, RidePlanStep } from "@/lib/utils/ride-timeline";
import type { RideTest, Workout, WorkoutStep } from "@/lib/utils/workout-steps";

export const TEST_NAME: Record<RideTest, string> = { ramp: "Ramp test", "20min": "20 min test" };

/** The ramp's steps: from 100 W up by 20 W, at most 500 W (21 steps). */
export const RAMP_FROM_W = 100;
export const RAMP_STEP_W = 20;
export const RAMP_TOP_W = 500;

const time = (seconds: number): WorkoutStep["end"] => ({ type: "time", seconds });
const zone = (z: number): WorkoutStep["target"] => ({ metric: "power", anchor: "ftp", zone: z });
const effort = (low: number, high: number): WorkoutStep["target"] => ({ metric: "rpe", anchor: "absolute", low, high });

/** The step tree of an FTP test, for a bike exercise. */
export function ftpTestWorkout(test: RideTest, name: string = TEST_NAME[test]): Workout {
  if (test === "ramp") {
    const steps: WorkoutStep[] = [{ type: "warmup", end: time(600), ramp: { anchor: "absolute", from: 60, to: RAMP_FROM_W } }];
    for (let w = RAMP_FROM_W; w <= RAMP_TOP_W; w += RAMP_STEP_W) {
      steps.push({
        type: "work",
        end: time(60),
        target: { metric: "power", anchor: "absolute", low: w, high: w },
        ...(w === RAMP_FROM_W && { note: "Tap Lap when you cannot hold the watts. That ends the test." }),
      });
    }
    return { v: 2, sport: "bike", name, test, steps };
  }
  return {
    v: 2,
    sport: "bike",
    name,
    test,
    steps: [
      { type: "warmup", end: time(13 * 60), target: zone(2) },
      { type: "work", end: time(60), target: effort(9, 9), note: "Hard effort" },
      { type: "recovery", end: time(5 * 60), target: zone(1) },
      { type: "work", end: time(60), target: effort(9, 9), note: "Hard effort" },
      { type: "recovery", end: time(5 * 60), target: zone(1), note: "Easy before the test" },
      { type: "work", end: time(20 * 60), target: effort(9, 10), note: "All-out. As hard as you can hold for the whole 20 minutes." },
      { type: "cooldown", end: time(10 * 60), target: zone(1) },
    ],
  };
}

/** In a ramp test, a work step is one of the 1 min steps: Lap or End ride on it ends the test. */
export function isRampTestStep(test: RideTest | undefined, step: Pick<RidePlanStep, "step">): boolean {
  return test === "ramp" && step.step.type === "work";
}

/** The all-out step of a 20 min test: its longest work step on time. */
export function allOutStep(steps: RidePlanStep[]): RidePlanStep | null {
  let best: RidePlanStep | null = null;
  for (const s of steps) if (s.step.type === "work" && s.seconds !== null && (!best || s.seconds > best.seconds!)) best = s;
  return best;
}

/** The stream numbers a test reads: the best rolling 60 s power, and each step's window average power. */
export type TestStreamPower = { best60sPower: number | null; stepPower: Record<number, number | null> };

export type FtpTestResult = {
  test: RideTest;
  /** The power the FTP comes from: the best 1 min (ramp) or the all-out step's average (20 min), whole watts. */
  power: number;
  /** "garmin": the stream; "typed": a step average (typed or filled); "target": the ramp step's planned watts. */
  basis: "garmin" | "typed" | "target";
  ftp: number;
};

/**
 * The FTP a ridden test gives, or null: not a test, no power to read, or an
 * FTP out of the threshold range. A ramp counts only 1 min steps ridden to
 * their end (done); a partial last step is the one the rider could not hold.
 * A 20 min test needs its all-out step done.
 */
export function ftpTestResult(
  plan: Pick<RidePlan, "steps"> & { test?: RideTest },
  logs: Record<number, Pick<StepLog, "status" | "avgPower">>,
  stream: TestStreamPower | null = null,
): FtpTestResult | null {
  const test = plan.test;
  if (!test) return null;
  let power: number | null = null;
  let basis: FtpTestResult["basis"] = "typed";
  if (test === "ramp") {
    const done = plan.steps.filter((s) => isRampTestStep(test, s) && logs[s.programSetId]?.status === "done");
    if (stream?.best60sPower != null && stream.best60sPower > 0 && done.length > 0) {
      power = stream.best60sPower;
      basis = "garmin";
    } else {
      // The highest done step: its planned watts are the highest.
      const top = done.reduce<RidePlanStep | null>((a, s) => (a === null || (s.power?.from ?? 0) >= (a.power?.from ?? 0) ? s : a), null);
      const typed = top ? logs[top.programSetId].avgPower : null;
      if (typed != null && typed > 0) power = typed;
      else if (top?.power?.from != null) {
        power = top.power.from;
        basis = "target";
      }
    }
  } else {
    const s = allOutStep(plan.steps);
    const log = s ? logs[s.programSetId] : null;
    if (s && log?.status === "done") {
      const fromStream = stream?.stepPower[s.programSetId];
      if (fromStream != null && fromStream > 0) {
        power = fromStream;
        basis = "garmin";
      } else if (log.avgPower != null && log.avgPower > 0) power = log.avgPower;
    }
  }
  if (power === null) return null;
  const watts = Math.round(power);
  const ftp = Math.round(watts * (test === "ramp" ? RAMP_FTP_FACTOR : FTP_FACTOR));
  if (thresholdRangeError("ftp", ftp)) return null;
  return { test, power: watts, basis, ftp };
}

export type FtpTestView = {
  test: RideTest;
  result: FtpTestResult | null;
  currentFtp: number | null;
  /** The current FTP is the one this test gives: Save is done. */
  saved: boolean;
};

/** What the summary and get_ride show of a test ride; null when the ride is no test. */
export function ftpTestView(
  plan: Pick<RidePlan, "steps"> & { test?: RideTest },
  logs: Record<number, Pick<StepLog, "status" | "avgPower">>,
  stream: TestStreamPower | null,
  currentFtp: number | null,
): FtpTestView | null {
  if (!plan.test) return null;
  const result = ftpTestResult(plan, logs, stream);
  const current = currentFtp != null ? Math.round(currentFtp) : null;
  return { test: plan.test, result, currentFtp: current, saved: result !== null && current === result.ftp };
}

/** The threshold field test a test ride saves as: its protocol and the input it takes. */
export function ftpTestThreshold(r: FtpTestResult): { protocol: "ftp_ramp" | "ftp_20min"; testData: Record<string, number> } {
  return r.test === "ramp" ? { protocol: "ftp_ramp", testData: { best1MinPower: r.power } } : { protocol: "ftp_20min", testData: { avgPower20: r.power } };
}
