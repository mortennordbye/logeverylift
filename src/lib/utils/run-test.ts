/**
 * The run threshold test (docs/plans/run-logger.md, 4.10): the two templates
 * the step editor and the assistant insert, the start check after being sick,
 * and the LTHR and threshold pace a run test gives with its checks.
 *
 * - Templates: warm-up 15 min with 3 x 1 min pickups, then the test as two
 *   work steps with the same target, 10 min and 20 min, then a 10 min
 *   cool-down. On a treadmill the test starts at 10.0 km/h and the 20 min
 *   step keeps the belt the 10 min step ended on (`run.carry`).
 * - Result (Friel, quick guide to setting zones): LTHR is the average heart
 *   rate of the 20 min step; threshold pace is the average pace of the whole
 *   30 minutes. Stored as protocol run_30min.
 *
 * Pure: the summary, the Save action and get_ride call it.
 */

import type { RidePlan, RidePlanStep } from "@/lib/utils/ride-timeline";
import { addDaysStr } from "@/lib/utils/seasons";
import type { ThresholdValues, Workout, WorkoutStep, WorkoutTarget } from "@/lib/utils/workout-steps";

export const RUN_TEST_MODES = ["treadmill", "outdoor"] as const;
export type RunTestMode = (typeof RUN_TEST_MODES)[number];

export const RUN_TEST_NAME: Record<RunTestMode, string> = { treadmill: "Treadmill test", outdoor: "Outdoor test" };
export const RUN_TEST_TEXT: Record<RunTestMode, string> = {
  treadmill: "15 min warm-up with 3 pickups, 30 min as hard as you can hold from 10.0 km/h",
  outdoor: "15 min warm-up with 3 pickups, 30 min as hard as you can hold on a flat route",
};

/** The belt a treadmill test starts at (4.10). */
export const TEST_START_KMH = 10;
export const TEST_NOTE = "Run as hard as you can hold for 30 min";
export const TREADMILL_TEST_NOTE = "Start at 10.0 km/h, raise it if you can";

const time = (seconds: number): WorkoutStep["end"] => ({ type: "time", seconds });
const effort = (low: number, high: number): WorkoutTarget => ({ metric: "rpe", anchor: "absolute", low, high });
const hrZone = (zone: number): WorkoutTarget => ({ metric: "hr", anchor: "lthr", zone });

/** The step tree of the 30 min run test, for a run exercise. */
export function runTestWorkout(mode: RunTestMode, name = "30 min run test"): Workout {
  const treadmill = mode === "treadmill";
  return {
    v: 2,
    sport: "run",
    name,
    test: "30min",
    steps: [
      { type: "warmup", end: time(9 * 60), target: hrZone(2) },
      {
        type: "repeat",
        count: 3,
        steps: [
          { type: "work", end: time(60), target: effort(8, 8), note: "Pickup, quick and relaxed" },
          { type: "recovery", end: time(60), target: effort(3, 3) },
        ],
      },
      { type: "work", end: time(10 * 60), target: effort(9, 10), note: treadmill ? `${TEST_NOTE}. ${TREADMILL_TEST_NOTE}` : TEST_NOTE, ...(treadmill && { belt: TEST_START_KMH }) },
      { type: "work", end: time(20 * 60), target: effort(9, 10), note: TEST_NOTE },
      { type: "cooldown", end: time(10 * 60), target: hrZone(1) },
    ],
  };
}

/**
 * The test steps of a run test: the 20 min step (the longest work step on
 * time) and the work step right before it (the first 10 min), by index.
 */
export function runTestSteps(steps: Pick<RidePlanStep, "step" | "seconds">[]): { first: number | null; last: number } | null {
  let last = -1;
  steps.forEach((s, i) => {
    if (s.step.type === "work" && s.seconds !== null && (last < 0 || s.seconds > steps[last].seconds!)) last = i;
  });
  if (last < 0) return null;
  const before = steps[last - 1];
  return { first: before && before.step.type === "work" && before.seconds !== null ? last - 1 : null, last };
}

// ── Start check ───────────────────────────────────────────────────────────────

/** Days to wait after a sick period before the test (4.10). */
export const SICK_WAIT_DAYS = 7;

/** A sick period that is open, or ended less than 7 days before `today`, stops the test from starting. */
export function sickBlocksTest(periods: { startedOn: string; endedOn: string | null }[], today: string): boolean {
  const since = addDaysStr(today, -SICK_WAIT_DAYS);
  return periods.some((p) => p.startedOn <= today && (p.endedOn === null || p.endedOn > since));
}

export const SICK_TEXT = "Wait 7 days after being sick";

// ── Result ────────────────────────────────────────────────────────────────────

/** A stop of more than this inside a test step fails the "no stops" check; rounding of the clock stays under it. */
export const STOP_S = 5;
/** A 20 min step with more pause than this gives no result (4.10). */
export const MAX_PAUSE_S = 60;
/** Sane values (4.10): LTHR in bpm, pace in seconds per km. */
export const LTHR_RANGE = { min: 120, max: 210 };
export const PACE_RANGE_S = { fast: 150, slow: 600 };

export type RunTestLog = {
  status: "done" | "partial" | "skipped";
  durationSeconds: number | null;
  distanceMeters: number | null;
  avgHr: number | null;
  rpe: number | null;
  /** Who wrote each number; a treadmill distance of source belt with no belt tap is the plan's, not a measure. */
  sources?: Partial<Record<string, string>> | null;
};
/** A step the run's timeline ended: its wall clock span and its active seconds, so the pause is the difference. */
export type RunTestTiming = { programSetId: number; startedAt: number; endedAt: number; activeSeconds: number };

export type RunTestChecks = {
  /** No pause in the two test steps. */
  noStops: boolean;
  /** The 20 min pace within 5% of the first 10 min; null without both distances. */
  evenPace: boolean | null;
  /** The 20 min heart rate at 80% of max HR or more; null without both. */
  hrHigh: boolean | null;
  /** Effort 8 or more; null when the runner gave none. */
  effort: boolean | null;
};

/** save: within 5 bpm and 3% of the current values; choose: 6 to 10 bpm or 3 to 8%; retest: further off. */
export type RunTestBand = "save" | "choose" | "retest";

export type RunTestResult = {
  /** LTHR in bpm, or null when the 20 min step has no heart rate or it is out of range. */
  lthr: number | null;
  /** The 20 min step's average heart rate, the test input of the LTHR. */
  hr20: number | null;
  /** Threshold speed in m/s, from `meters30` / 1800 s; null when no pace counts. */
  speed: number | null;
  /** The distance of 30 minutes at the test's average pace, the test input of the pace. */
  meters30: number | null;
  checks: RunTestChecks;
  /** No check failed. */
  valid: boolean;
  band: RunTestBand;
};

export type RunTestCurrent = { lthr: number | null; speed: number | null };

export type RunTestInput = {
  plan: Pick<RidePlan, "steps" | "test" | "mode" | "thresholds">;
  logs: Record<number, RunTestLog | undefined>;
  timing: RunTestTiming[];
  /** On a treadmill: the runner tapped the belt during a test step. Without it a belt distance is the plan's, so only a typed or Garmin distance counts. */
  beltEvents: boolean;
  current: RunTestCurrent;
};

const pauseOf = (t: RunTestTiming | undefined) => (t ? Math.max(0, Math.round((t.endedAt - t.startedAt) / 1000) - t.activeSeconds) : 0);

function band(r: Pick<RunTestResult, "lthr" | "speed">, current: RunTestCurrent): RunTestBand {
  const order: RunTestBand[] = ["save", "choose", "retest"];
  let worst = 0;
  if (r.lthr !== null && current.lthr !== null) {
    const d = Math.abs(r.lthr - Math.round(current.lthr));
    worst = Math.max(worst, d <= 5 ? 0 : d <= 10 ? 1 : 2);
  }
  if (r.speed !== null && current.speed !== null) {
    // Pace as time per km: the share it moved.
    const pct = (Math.abs(1 / r.speed - 1 / current.speed) / (1 / current.speed)) * 100;
    worst = Math.max(worst, pct <= 3 ? 0 : pct <= 8 ? 1 : 2);
  }
  return order[worst];
}

/**
 * The LTHR and threshold pace a run test gives, or null: not a test, the
 * 20 min step not done or paused more than 60 s, or neither value in range.
 * A treadmill test with no belt tap and only the plan's belt meters gives
 * LTHR only.
 */
export function runTestResult(input: RunTestInput): RunTestResult | null {
  const { plan, logs, timing } = input;
  if (plan.test !== "30min") return null;
  const idx = runTestSteps(plan.steps);
  if (!idx) return null;
  const lastStep = plan.steps[idx.last];
  const firstStep = idx.first !== null ? plan.steps[idx.first] : null;
  const last = logs[lastStep.programSetId];
  const first = firstStep ? logs[firstStep.programSetId] : undefined;
  if (last?.status !== "done") return null;
  const timeOf = (id: number) => timing.find((t) => t.programSetId === id);
  const lastPause = pauseOf(timeOf(lastStep.programSetId));
  if (lastPause > MAX_PAUSE_S) return null;
  const firstPause = firstStep ? pauseOf(timeOf(firstStep.programSetId)) : 0;

  const hr20 = last.avgHr !== null && last.avgHr > 0 ? last.avgHr : null;
  const lthr = hr20 !== null && Math.round(hr20) >= LTHR_RANGE.min && Math.round(hr20) <= LTHR_RANGE.max ? Math.round(hr20) : null;

  // The pace of the whole 30 minutes: both steps run with their distance.
  let speed: number | null = null;
  let meters30: number | null = null;
  let evenPace: boolean | null = null;
  // On a treadmill with no belt tap, the belt's meters are the plan's (as the summary says, "no belt changes"); a typed, Garmin or assistant distance is a measure.
  const measured = (l: RunTestLog | undefined) => !!l?.sources?.distanceMeters && l.sources.distanceMeters !== "belt";
  const paceCounts = plan.mode !== "indoor" || input.beltEvents || (measured(first) && measured(last));
  if (paceCounts && first?.status === "done" && first.distanceMeters && first.durationSeconds && last.distanceMeters && last.durationSeconds) {
    const s = (first.distanceMeters + last.distanceMeters) / (first.durationSeconds + last.durationSeconds);
    const m = Math.round(s * 1800);
    const secPerKm = 1000 / (m / 1800);
    if (m > 0 && secPerKm >= PACE_RANGE_S.fast && secPerKm <= PACE_RANGE_S.slow) {
      meters30 = m;
      speed = m / 1800;
      const p10 = first.durationSeconds / first.distanceMeters;
      const p20 = last.durationSeconds / last.distanceMeters;
      evenPace = Math.abs(p20 - p10) / p10 <= 0.05 + 1e-9;
    }
  }
  if (lthr === null && speed === null) return null;

  const maxHr = plan.thresholds.max_hr ?? null;
  const rpe = last.rpe ?? first?.rpe ?? null;
  const checks: RunTestChecks = {
    noStops: lastPause <= STOP_S && firstPause <= STOP_S,
    evenPace,
    hrHigh: hr20 !== null && maxHr ? hr20 >= 0.8 * maxHr : null,
    effort: rpe !== null ? rpe >= 8 : null,
  };
  const valid = Object.values(checks).every((c) => c !== false);
  const r = { lthr, hr20: lthr !== null ? hr20 : null, speed, meters30, checks, valid };
  return { ...r, band: band(r, input.current) };
}

export type RunTestView = {
  test: "30min";
  result: RunTestResult | null;
  current: RunTestCurrent;
  /** Every value the test gives is stored as a live test row of this date. Set by the server. */
  saved: boolean;
};

/** What the summary and get_ride show of a run test; null when the run is no test. `saved` is false until the server checks the rows. */
export function runTestView(input: RunTestInput): RunTestView | null {
  if (input.plan.test !== "30min") return null;
  return { test: "30min", result: runTestResult(input), current: input.current, saved: false };
}

/** The threshold rows a result saves: protocol run_30min with the input each kind takes. */
export function runTestThresholds(r: RunTestResult): { kind: "lthr_run" | "run_threshold_pace"; value: number; testData: Record<string, number> }[] {
  const out: ReturnType<typeof runTestThresholds> = [];
  if (r.lthr !== null && r.hr20 !== null) out.push({ kind: "lthr_run", value: r.lthr, testData: { avgHrLast20: r.hr20 } });
  if (r.speed !== null && r.meters30 !== null) out.push({ kind: "run_threshold_pace", value: r.speed, testData: { distance30Meters: r.meters30 } });
  return out;
}


/** The failed checks in words, for the line under "Test may be invalid". */
export function runTestCheckText(c: RunTestChecks): string[] {
  return [
    c.noStops ? null : "You stopped during the test",
    c.evenPace === false ? "The last 20 min pace was more than 5% off the first 10 min" : null,
    c.hrHigh === false ? "Heart rate stayed under 80% of max" : null,
    c.effort === false ? "Effort was under 8" : null,
  ].filter((t): t is string => t !== null);
}

/** The thresholds a run test reads now, as the result compares them. */
export const runTestCurrent = (th: ThresholdValues): RunTestCurrent => ({ lthr: th.lthr_run ?? null, speed: th.run_threshold_pace ?? null });
