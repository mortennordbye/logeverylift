import { describe, expect, it } from "vitest";
import {
  EMPTY_STEP_FIELDS,
  buildWorkout,
  checkStepRows,
  workoutToRows,
  type StepRow,
} from "@/lib/utils/program-steps";
import { estimateWorkout, isHardWorkout, parseWorkout, type Workout } from "@/lib/utils/workout-steps";

const row = (setNumber: number, f: Partial<StepRow>): StepRow => ({ ...EMPTY_STEP_FIELDS, setNumber, ...f });

const intervals: Workout = {
  v: 1,
  sport: "run",
  name: "Run · Threshold",
  steps: [
    { type: "warmup", end: { type: "distance", meters: 2000 }, target: { metric: "hr", anchor: "lthr", zone: 2 } },
    {
      type: "repeat",
      count: 4,
      steps: [
        { type: "work", end: { type: "distance", meters: 1000 }, target: { metric: "pace", anchor: "threshold_pace", low: 98, high: 102 } },
        { type: "recovery", end: { type: "time", seconds: 120 } },
      ],
    },
    { type: "cooldown", end: { type: "lap" } },
  ],
};

describe("workoutToRows and buildWorkout", () => {
  it("stores a repeat block one row per round and reads it back as the same tree", () => {
    const rows = workoutToRows(intervals);
    expect(rows).toHaveLength(1 + 4 * 2 + 1);
    expect(rows.map((r) => r.setNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows.slice(1, 9).map((r) => [r.blockId, r.blockRound])).toEqual([
      [1, 1], [1, 1], [1, 2], [1, 2], [1, 3], [1, 3], [1, 4], [1, 4],
    ]);
    const built = buildWorkout(rows, { sport: "run", name: "Run · Threshold" });
    expect("workout" in built && built.workout).toEqual(intervals);
  });

  it("gives the same estimate and hard flag as the tree", () => {
    const built = buildWorkout(workoutToRows(intervals), { sport: "run", name: "x" });
    if (!("workout" in built)) throw new Error("not built");
    const thresholds = { run_threshold_pace: 4 };
    expect(estimateWorkout(built.workout, thresholds)).toEqual(estimateWorkout(intervals, thresholds));
    expect(isHardWorkout(built.workout)).toBe(true);
  });

  it("keeps a second target, swim fields and cadence", () => {
    const swim: Workout = {
      v: 1,
      sport: "swim",
      name: "Swim",
      poolLengthM: 25,
      steps: [
        {
          type: "repeat",
          count: 10,
          steps: [{ type: "work", end: { type: "distance", meters: 100 }, sendOffSeconds: 105, stroke: "free", equipment: ["pull_buoy", "paddles"], target: { metric: "pace", anchor: "css", offsetLow: 2, offsetHigh: 4 }, target2: { metric: "rpe", anchor: "absolute", low: 6, high: 7 }, note: "long strokes" }],
        },
      ],
    };
    expect(parseWorkout(swim).ok).toBe(true);
    const built = buildWorkout(workoutToRows(swim), { sport: "swim", name: "Swim", poolLengthM: 25 });
    expect("workout" in built && built.workout).toEqual(swim);
  });
});

describe("checkStepRows", () => {
  const meta = { sport: "run" as const, name: "Run" };

  it("passes strength and legacy rows untouched", () => {
    expect(checkStepRows([row(1, {}), row(2, { durationSeconds: 60 })], { sport: null, name: "Bench" })).toEqual([]);
  });

  it("refuses steps on an exercise with no sport", () => {
    expect(checkStepRows([row(1, { stepKind: "work", durationSeconds: 60 })], { sport: null, name: "Bench" })[0].message).toMatch(/only a swim, bike or run/);
  });

  it("refuses a mix of step rows and plain rows", () => {
    const p = checkStepRows([row(1, { stepKind: "work", durationSeconds: 60 }), row(2, { distanceMeters: 1000 })], meta);
    expect(p).toEqual([{ setNumber: 2, message: "every set of a structured exercise needs a step kind" }]);
  });

  it("refuses a step with two ends or none", () => {
    expect(checkStepRows([row(1, { stepKind: "work", durationSeconds: 60, distanceMeters: 200 })], meta)[0]).toEqual({ setNumber: 1, message: "give exactly one end: time, distance or lap" });
    expect(checkStepRows([row(1, { stepKind: "work" })], meta)[0].setNumber).toBe(1);
  });

  it("refuses a block that is split, out of order or has differing rounds", () => {
    const base = { stepKind: "work" as const, distanceMeters: 400, blockId: 1 };
    const split = checkStepRows([row(1, { ...base, blockRound: 1 }), row(2, { stepKind: "recovery", durationSeconds: 60 }), row(3, { ...base, blockRound: 2 })], meta);
    expect(split.map((p) => p.message)).toContain("the sets of a repeat block must be next to each other");
    const differ = checkStepRows([row(1, { ...base, blockRound: 1 }), row(2, { ...base, blockRound: 2, distanceMeters: 800 })], meta);
    expect(differ.map((p) => p.message)).toContain("round 2 of the repeat block differs from round 1");
    const single = checkStepRows([row(1, { ...base, blockRound: 1 })], meta);
    expect(single.map((p) => p.message)).toContain("a repeat block needs at least 2 rounds");
  });

  it("names the set behind a schema problem", () => {
    const rows = [row(1, { stepKind: "warmup", durationSeconds: 600 }), row(2, { stepKind: "work", durationSeconds: 300, targets: [{ metric: "power", anchor: "ftp", low: 250, high: 260 }] })];
    const p = checkStepRows(rows, { sport: "bike", name: "Bike" });
    expect(p).toEqual([{ setNumber: 2, message: "target.low must be 30-200 % FTP" }, { setNumber: 2, message: "target.high must be 30-200 % FTP" }]);
  });

  it("refuses power on a run and a send-off outside a repeat", () => {
    expect(checkStepRows([row(1, { stepKind: "work", durationSeconds: 300, targets: [{ metric: "power", anchor: "ftp", zone: 3 }] })], meta)[0].message).toMatch(/not allowed on a run/);
    const swim = checkStepRows([row(1, { stepKind: "work", distanceMeters: 100, sendOffSeconds: 100 })], { sport: "swim", name: "Swim" });
    expect(swim[0].message).toMatch(/only on a work step inside a repeat/);
  });

  it("accepts a yard pool distance rounded to whole metres", () => {
    // 100 yd = 91.44 m, stored as 91 in a 25 yd (22.86 m) pool.
    expect(checkStepRows([row(1, { stepKind: "work", distanceMeters: 91 })], { sport: "swim", name: "Swim", poolLengthM: 22.86 })).toEqual([]);
    expect(checkStepRows([row(1, { stepKind: "work", distanceMeters: 95 })], { sport: "swim", name: "Swim", poolLengthM: 22.86 })[0].message).toMatch(/whole number/);
  });
});

describe("program_sets columns", () => {
  it("every column is either a step field or one the copy paths already handle", async () => {
    const { getTableColumns } = await import("drizzle-orm");
    const { programSets } = await import("@/db/schema");
    const { STEP_FIELD_KEYS } = await import("@/lib/utils/program-steps");
    // The columns that existed before steps. Program sharing, export/import and
    // the assistant's set list copy each by name; a new column must be added
    // to STEP_FIELD_KEYS (copied by stepFieldsOf) or to this list on purpose.
    const before = [
      "id", "programExerciseId", "setNumber", "targetReps", "repRangeMin", "repRangeMax", "weightKg",
      "durationSeconds", "startDelaySeconds", "distanceMeters", "peakDistanceMeters", "peakDurationSeconds",
      "inclinePercent", "targetHeartRateZone", "restTimeSeconds", "setType", "targetRir", "sessionRole", "deletedAt",
    ];
    expect(Object.keys(getTableColumns(programSets)).sort()).toEqual([...before, ...STEP_FIELD_KEYS].sort());
  });
});
