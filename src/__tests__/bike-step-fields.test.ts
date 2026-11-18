import { buildWorkout, checkStepRows, EMPTY_STEP_FIELDS, stepOfRow, workoutToRows, type StepRow } from "@/lib/utils/program-steps";
import { diffSnapshots, syncOwnedSetFields, type ProgramSnapshot } from "@/lib/utils/plan-revisions";
import { plannedRows, workoutPlannedLoad } from "@/lib/utils/step-results";
import { isHardSession, programSteps } from "@/lib/utils/training-limits";
import { DEFAULT_IF } from "@/lib/utils/training-load";
import {
  describeWorkout,
  isHardWorkout,
  mainTarget,
  parseWorkout,
  resolveStepTarget,
  resolveWorkout,
  rowMainTarget,
  type Workout,
} from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/**
 * The bike step fields of docs/plans/bike-ride-logger.md, step 0: a ramp, a
 * free spin, an outdoor target and a test ride, and every reader of step
 * targets with them.
 */

const OUTDOOR = { metric: "hr", anchor: "lthr", low: 81, high: 89 } as const;

function bike(steps: unknown[], extra: Record<string, unknown> = {}): Workout {
  const p = parseWorkout({ v: 2, sport: "bike", name: "Ride", steps, ...extra });
  if (!p.ok) throw new Error(JSON.stringify(p.errors));
  return p.workout;
}

const ride = bike(
  [
    { type: "warmup", end: { type: "time", seconds: 600 }, ramp: { anchor: "ftp", from: 50, to: 70 }, outdoor: { metric: "hr", anchor: "lthr", low: 70, high: 81 } },
    { type: "work", end: { type: "time", seconds: 1200 }, ramp: { anchor: "ftp", from: 95, to: 105 }, outdoor: OUTDOOR },
    { type: "recovery", end: { type: "time", seconds: 300 }, free: true, outdoor: { metric: "rpe", anchor: "absolute", low: 2, high: 2 } },
  ],
  { test: "20min" },
);

describe("the step schema", () => {
  it("reads ramp, free, outdoor and test, and a version 1 tree as version 2", () => {
    expect(ride.v).toBe(2);
    expect(ride.test).toBe("20min");
    const v1 = parseWorkout({ v: 1, sport: "run", name: "Run", steps: [{ type: "work", end: { type: "lap" } }] });
    expect(v1.ok && v1.workout.v).toBe(2);
  });

  it("refuses the bike fields on a run or a swim, with the reason", () => {
    const run = parseWorkout({
      v: 2,
      sport: "run",
      name: "Run",
      test: "ramp",
      steps: [{ type: "work", end: { type: "lap" }, ramp: { anchor: "ftp", from: 50, to: 70 }, free: true, outdoor: OUTDOOR }],
    });
    expect(!run.ok && run.errors.map((e) => `${e.path} ${e.message}`)).toEqual(
      expect.arrayContaining([
        "test only for bike workouts",
        "steps[0].ramp ramp is only for bike steps",
        "steps[0].free free is only for bike steps",
        "steps[0].outdoor outdoor is only for bike steps",
      ]),
    );
  });

  it("refuses a ramp with a target, a ramp out of range, a free step with a target and a bad outdoor target", () => {
    const r = parseWorkout({
      v: 2,
      sport: "bike",
      name: "Ride",
      steps: [
        { type: "work", end: { type: "lap" }, ramp: { anchor: "ftp", from: 50, to: 250 }, target: { metric: "power", anchor: "ftp", low: 80, high: 90 } },
        { type: "work", end: { type: "lap" }, free: true, target2: { metric: "hr", anchor: "lthr", low: 80, high: 90 } },
        { type: "work", end: { type: "lap" }, outdoor: { metric: "pace", anchor: "css", low: 80, high: 90 } },
        { type: "work", end: { type: "lap" }, ramp: { anchor: "absolute", from: 100, to: 200 }, target2: { metric: "hr", anchor: "lthr", low: 80, high: 90 } },
      ],
    });
    expect(!r.ok && r.errors.map((e) => `${e.path} ${e.message}`)).toEqual(
      expect.arrayContaining([
        "steps[0].ramp give a target or a ramp, not both",
        "steps[0].ramp.to must be 30-200 % FTP",
        "steps[1].free a free step has no target",
        "steps[1].target2 a second target needs a first one",
        "steps[2].outdoor.anchor pace with anchor css is not allowed on a bike",
        "steps[3].target2 a ramp takes no cap",
      ]),
    );
  });

  it("a ramp is one power range for the readers, its ends in order", () => {
    expect(mainTarget({ ramp: { anchor: "ftp", from: 70, to: 50 } })).toEqual({ metric: "power", anchor: "ftp", low: 50, high: 70 });
    expect(rowMainTarget({ targets: null, ramp: { anchor: "absolute", from: 100, to: 200 } })).toEqual({ metric: "power", anchor: "absolute", low: 100, high: 200 });
    expect(rowMainTarget({ targets: [OUTDOOR], ramp: null })).toEqual(OUTDOOR);
  });
});

describe("workout-steps readers", () => {
  it("describe a ramp and a free spin; the outdoor target stays out of the indoor line", () => {
    expect(describeWorkout(ride)).toBe("10 min warm-up ramp 50 to 70% FTP · 20 min ramp 95 to 105% FTP · 5 min easy free");
  });

  it("resolve a ramp to watts in its order, and a free step to no target", () => {
    const r = resolveWorkout(ride, { ftp: 200 });
    expect(r.steps.map((s) => ("resolved" in s ? s.resolved?.text ?? null : null))).toEqual(["100 to 140 W", "190 to 210 W", null]);
    expect(resolveStepTarget(ride.steps[0] as never, "bike", {})?.text).toBe("ramp 50 to 70% FTP (no ftp set)");
  });

  it("a work ramp from threshold is hard; an outdoor target does not make a step hard", () => {
    expect(isHardWorkout(ride)).toBe(true);
    const easy = bike([{ type: "work", end: { type: "time", seconds: 600 }, free: true, outdoor: { metric: "hr", anchor: "lthr", zone: 5 } }]);
    expect(isHardWorkout(easy)).toBe(false);
  });
});

describe("program-steps readers", () => {
  it("rows keep ramp, free and outdoor, and read back the same tree", () => {
    const rows = workoutToRows(ride);
    expect(rows.map((r) => [r.ramp, r.free, r.outdoorTarget])).toEqual([
      [{ anchor: "ftp", from: 50, to: 70 }, false, { metric: "hr", anchor: "lthr", low: 70, high: 81 }],
      [{ anchor: "ftp", from: 95, to: 105 }, false, OUTDOOR],
      [null, true, { metric: "rpe", anchor: "absolute", low: 2, high: 2 }],
    ]);
    const built = buildWorkout(rows, { sport: "bike", name: "Ride" });
    // The test kind lives on the workout, not on a row.
    expect("workout" in built && parseWorkout(built.workout)).toEqual({ ok: true, workout: { ...ride, test: undefined } });
    expect(stepOfRow({ ...rows[2], setNumber: 3 })).toMatchObject({ free: true, outdoor: { metric: "rpe" } });
  });

  it("checkStepRows refuses a ramp on a run row, naming the set", () => {
    const row: StepRow = { ...EMPTY_STEP_FIELDS, setNumber: 1, stepKind: "work", endsOnLap: true, ramp: { anchor: "ftp", from: 50, to: 70 } };
    expect(checkStepRows([row], { sport: "run", name: "Run" })).toEqual([{ setNumber: 1, message: "ramp ramp is only for bike steps" }]);
  });
});

describe("step-results readers", () => {
  it("a planned row shows the ramp in watts; the free step has no target", () => {
    const rows = plannedRows(ride, { ftp: 200 });
    expect(rows.map((r) => r.target?.text ?? null)).toEqual(["100 to 140 W", "190 to 210 W", null]);
    expect(rows[1].target).toMatchObject({ low: 190, high: 210, unit: "W" });
  });

  it("planned load counts a ramp at its midpoint and a free step at its kind's default", () => {
    const { load, partial } = workoutPlannedLoad(ride, { ftp: 200 });
    // 10 min at 0.60, 20 min at 1.00, 5 min easy at the recovery default 0.55.
    const expected = (600 / 3600) * 0.6 ** 2 * 100 + (1200 / 3600) * 1 ** 2 * 100 + (300 / 3600) * DEFAULT_IF.recovery ** 2 * 100;
    expect(load).toBeCloseTo(expected, 6);
    expect(partial).toBe(true);
  });
});

describe("training-limits readers", () => {
  const rows = workoutToRows(ride).map((r) => ({ ...r, discipline: "bike" as const, sessionRole: null, targetHeartRateZone: null }));

  it("a work step with a ramp from threshold makes the session hard; a free step with a hard outdoor target does not", () => {
    expect(isHardSession(rows)).toBe(true);
    const free = { ...rows[2], stepKind: "work", outdoorTarget: { metric: "hr", anchor: "lthr", zone: 5 } };
    expect(isHardSession([free])).toBe(false);
  });

  it("programSteps gives a ramp row its range as the target", () => {
    const steps = programSteps(rows, {}, DEFAULT_IF);
    expect(steps.map((s) => s.target ?? null)).toEqual([
      { metric: "power", anchor: "ftp", low: 50, high: 70 },
      { metric: "power", anchor: "ftp", low: 95, high: 105 },
      null,
    ]);
  });
});

describe("plan-revisions readers", () => {
  const set = (extra: Record<string, unknown>) => ({ id: 1, setNumber: 1, programExerciseId: 10, stepKind: "work", targets: null, ramp: null, free: false, outdoorTarget: null, ...extra });
  const snap = (s: ReturnType<typeof set>): ProgramSnapshot => ({ v: 1, program: { id: 1, name: "Ride" }, exercises: [{ id: 10, exerciseId: 5, exerciseName: "Bike", notes: null, sets: [s] }] });

  it("name a changed ramp, free spin and outdoor target", () => {
    const before = snap(set({ ramp: { anchor: "ftp", from: 50, to: 70 }, outdoorTarget: OUTDOOR }));
    const after = snap(set({ ramp: null, free: true, outdoorTarget: { ...OUTDOOR, high: 90 } }));
    expect(diffSnapshots(before, after)).toEqual(["Bike, set 1, ramp changed", "Bike, set 1, free spin false → true", "Bike, set 1, outdoor target changed"]);
  });

  it("a restore leaves rest to the sync on a ramp or free work step, and never its target", () => {
    const anchored = { sessionRole: "work", peakDurationSeconds: 1200 };
    expect(syncOwnedSetFields(set({ ...anchored, ramp: { anchor: "ftp", from: 90, to: 100 } }))).toEqual(["durationSeconds", "restTimeSeconds"]);
    expect(syncOwnedSetFields(set({ ...anchored, free: true }))).toEqual(["durationSeconds", "restTimeSeconds"]);
    expect(syncOwnedSetFields(set({ ...anchored }))).toEqual(["durationSeconds", "targetHeartRateZone", "restTimeSeconds"]);
  });
});
