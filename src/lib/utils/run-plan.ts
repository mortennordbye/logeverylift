/**
 * A run's frozen plan (docs/plans/run-logger.md, 4.2 and 4.3): the steps in
 * the order they are run, each with its end rule, and on a treadmill its
 * frozen belt and incline. `rideTimeline` reads only these, so a later
 * Garmin mode correction (4.8) changes labels and fill fields, never the
 * timeline.
 *
 * Pure: no database, no clock.
 */

import type { RideMode, RunSurface } from "@/db/schema/rides";
import {
  RUN_OPEN_STEP_SPEED_MS,
  LAP_STEP_EST_S,
  type BeltSource,
  type RidePlan,
  type RidePlanStep,
  type RunStepPlan,
} from "@/lib/utils/ride-timeline";
import { runTestSteps } from "@/lib/utils/run-test";
import { flattenWorkout } from "@/lib/utils/workout-player";
import {
  mainTarget,
  paceTargetSpeed,
  resolveStepTarget,
  resolveTarget,
  runHrZoneOf,
  runZoneSpeed,
  type RunPaceZone,
  type ThresholdValues,
  type Workout,
  type WorkoutStep,
  type WorkoutTarget,
} from "@/lib/utils/workout-steps";

/** A walk or an easy jog: the belt of an effort 1 to 2 step (4.2). */
export const WALK_BELT_KMH = 5.5;
/** A heart rate step's belt from history needs this many done steps of 10 min or more (4.2). */
export const BELT_HISTORY_MIN_STEPS = 2;
export const BELT_HISTORY_MIN_S = 600;
/** A repeat whose work step is under this is a short-step block (4.5). */
export const BLOCK_WORK_UNDER_S = 60;

/** A done treadmill step of the last 6 weeks: its belt (km/h), Garmin average heart rate and seconds. */
export type BeltHistoryStep = { beltKmh: number; avgHr: number; seconds: number };

/** A done outdoor run step of the last 6 weeks: its meters, seconds and average heart rate. */
export type EasyHistoryStep = { meters: number; seconds: number; avgHr: number };

/**
 * The runner's recent easy pace (4.3), as a speed in m/s: the median speed of
 * 2 or more done outdoor steps of 10 min or more whose average heart rate was
 * in zone 1 or 2 (run LTHR). Null without an LTHR or enough steps; an outdoor
 * distance step then runs on the zone 2 pace.
 */
export function recentEasySpeed(steps: EasyHistoryStep[], lthr: number | null | undefined): number | null {
  if (!lthr) return null;
  const easy = steps.filter((s) => s.seconds >= BELT_HISTORY_MIN_S && s.meters > 0 && runHrZoneOf((s.avgHr / lthr) * 100) <= 2);
  return easy.length >= BELT_HISTORY_MIN_STEPS ? median(easy.map((s) => s.meters / s.seconds)) : null;
}

/** km/h of a speed in m/s, to the nearest `step` km/h. */
const kmh = (ms: number, step: number) => Math.round(Math.round((ms * 3.6) / step) * step * 10) / 10;
const tenth = (n: number) => Math.round(n * 10) / 10;

/** The run heart rate zone a heart rate target stands for (its midpoint), or null without the numbers to tell. */
export function hrTargetZone(t: WorkoutTarget, thresholds: ThresholdValues): number | null {
  if (t.metric !== "hr") return null;
  if (t.anchor === "lthr" && t.zone !== undefined) return t.zone;
  const mid = t.low !== undefined && t.high !== undefined ? (t.low + t.high) / 2 : null;
  if (mid === null) return null;
  if (t.anchor === "lthr") return runHrZoneOf(mid);
  const lthr = thresholds.lthr_run;
  if (!lthr) return null;
  const bpm = t.anchor === "max_hr" ? (thresholds.max_hr ? (thresholds.max_hr * mid) / 100 : null) : t.anchor === "absolute" ? mid : null;
  return bpm === null ? null : runHrZoneOf((bpm / lthr) * 100);
}

/** The pace zone an effort stands for (4.2): effort 3 to 4 is Z1, 5 to 6 Z2, 7 Z3, 8 Z4, 9 to 10 Z5b. */
function effortZone(effort: number): RunPaceZone | "walk" {
  if (effort <= 2) return "walk";
  if (effort <= 4) return "1";
  if (effort <= 6) return "2";
  if (effort === 7) return "3";
  if (effort === 8) return "4";
  return "5b";
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * A treadmill step's frozen belt in km/h (4.2), the first that exists:
 * the belt written on the step; the pace target's midpoint (to 0.5 km/h);
 * for a heart rate target, the median belt of 2 or more done treadmill steps
 * of 10 min or more in that zone, else the slow end of the pace zone of the
 * same number; for an effort target, the pace its effort stands for. Else
 * null: the runner sets the belt by feel.
 */
export function resolveBelt(
  s: Pick<WorkoutStep, "target" | "belt" | "ramp">,
  thresholds: ThresholdValues,
  history: BeltHistoryStep[] = [],
): { kmh: number; from: BeltSource } | null {
  if (s.belt !== undefined) return { kmh: s.belt, from: "step" };
  const t = mainTarget(s);
  if (!t) return null;
  const speed = thresholds.run_threshold_pace;
  if (t.metric === "pace") {
    const mid = paceTargetSpeed(t, "run", thresholds);
    return mid ? { kmh: kmh(mid, 0.5), from: "pace" } : null;
  }
  if (t.metric === "hr") {
    const zone = hrTargetZone(t, thresholds);
    if (zone === null) return null;
    const lthr = thresholds.lthr_run;
    if (lthr) {
      const inZone = history.filter((h) => h.seconds >= BELT_HISTORY_MIN_S && runHrZoneOf((h.avgHr / lthr) * 100) === zone);
      if (inZone.length >= BELT_HISTORY_MIN_STEPS) return { kmh: tenth(median(inZone.map((h) => h.beltKmh))), from: "history" };
    }
    return speed ? { kmh: kmh(runZoneSpeed(String(zone) as RunPaceZone, speed), 0.1), from: "zone" } : null;
  }
  if (t.metric === "rpe" && t.low !== undefined && t.high !== undefined) {
    const zone = effortZone(Math.round((t.low + t.high) / 2));
    if (zone === "walk") return { kmh: WALK_BELT_KMH, from: "effort" };
    return speed ? { kmh: kmh(runZoneSpeed(zone, speed), 0.1), from: "effort" } : null;
  }
  return null;
}

/**
 * The seconds an outdoor distance step runs (R9, 4.3): from its pace target,
 * else the runner's recent easy pace for a heart rate step, else the Z2
 * pace. Null when none is known: the step then ends on Lap.
 */
export function estimateSeconds(s: Pick<WorkoutStep, "target" | "ramp">, meters: number, thresholds: ThresholdValues, easySpeed?: number | null): number | null {
  const t = mainTarget(s);
  const pace = paceTargetSpeed(t, "run", thresholds);
  const speed =
    pace ?? (t?.metric === "hr" && easySpeed ? easySpeed : null) ?? (thresholds.run_threshold_pace ? runZoneSpeed("2", thresholds.run_threshold_pace) : null);
  return speed ? Math.round(meters / speed) : null;
}

/**
 * The steps of a run workout as one run, each with the program set it logs
 * to (`setIds`, one per step once repeats are expanded). Unlike a ride, the
 * recovery after a repeat's last round stays: it is the jog before the next
 * step. A treadmill distance step ends on the belt's meters; an outdoor one
 * on its estimated time, or on Lap when no pace is known.
 */
export function buildRunPlan(
  workout: Workout,
  setIds: number[],
  thresholds: ThresholdValues,
  mode: RideMode,
  opts: { surface?: RunSurface; history?: BeltHistoryStep[]; easySpeed?: number | null } = {},
): RidePlan {
  const play = flattenWorkout(workout);
  if (play.length !== setIds.length) throw new RangeError(`${play.length} steps but ${setIds.length} sets`);
  // The block of each play step: the repeat id when its work step is short.
  const blockOf: (string | null)[] = [];
  workout.steps.forEach((n, i) => {
    if (n.type !== "repeat") return void blockOf.push(null);
    const short = n.steps.some((s) => s.type === "work" && s.end.type === "time" && s.end.seconds < BLOCK_WORK_UNDER_S);
    for (let k = 0; k < n.count * n.steps.length; k++) blockOf.push(short ? (n.id ?? `n${i + 1}`) : null);
  });
  const treadmill = mode === "indoor";

  const steps: RidePlanStep[] = play.map((p, k) => {
    const s = p.step as WorkoutStep;
    const belt = treadmill ? resolveBelt(s, thresholds, opts.history) : null;
    const beltT = belt ? Math.round(belt.kmh * 10) : null;
    let rule: RunStepPlan["rule"] = "lap";
    let seconds: number | null = null;
    let estSeconds = LAP_STEP_EST_S;
    const meters = s.end.type === "distance" ? s.end.meters : null;
    if (s.end.type === "time") {
      rule = "time";
      seconds = s.end.seconds;
      estSeconds = seconds;
    } else if (meters !== null && treadmill) {
      rule = "belt_distance";
      estSeconds = Math.round(meters / (beltT ? beltT / 36 : RUN_OPEN_STEP_SPEED_MS));
    } else if (meters !== null) {
      const est = estimateSeconds(s, meters, thresholds, opts.easySpeed);
      rule = est !== null ? "estimate" : "lap";
      seconds = est;
      estSeconds = est ?? Math.round(meters / RUN_OPEN_STEP_SPEED_MS);
    }
    return {
      key: p.key,
      programSetId: setIds[k],
      step: s,
      round: p.round,
      seconds,
      estSeconds,
      target: resolveStepTarget(s, "run", thresholds),
      target2: s.target2 ? resolveTarget(s.target2, "run", thresholds) : null,
      outdoor: s.outdoor ? resolveTarget(s.outdoor, "run", thresholds) : null,
      outdoor2: null,
      power: null,
      run: {
        rule,
        meters,
        belt: beltT,
        beltFrom: belt?.from ?? null,
        incline: treadmill && s.incline !== undefined ? Math.round(s.incline * 10) : null,
        block: blockOf[k],
      },
    };
  });
  // A treadmill run test: the 20 min step keeps the belt the runner raised in the first 10 min (4.10).
  const test = workout.test === "30min" && treadmill ? runTestSteps(steps) : null;
  if (test && test.first !== null && steps[test.last].step.belt === undefined) {
    steps[test.last] = { ...steps[test.last], run: { ...steps[test.last].run!, belt: null, beltFrom: null, carry: true } };
  }
  return {
    v: 2,
    sport: "run",
    mode,
    ...(mode === "outdoor" && { surface: opts.surface ?? "road" }),
    name: workout.name,
    ...(workout.test && { test: workout.test }),
    thresholds,
    steps,
    dropped: [],
  };
}
