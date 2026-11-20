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
  v: 2,
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
      v: 2,
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

describe("one step list: a program reads like the same workout", () => {
  it("gives the same planned load, time and hard flag as the tree", async () => {
    const { programSteps, isHardSession } = await import("@/lib/utils/training-limits");
    const { plannedLoad, DEFAULT_IF } = await import("@/lib/utils/training-load");
    const { workoutPlannedLoad, loadAnchors } = await import("@/lib/utils/step-results");
    const thresholds = { run_threshold_pace: 4.2, ftp: 260, swim_css: 1.4 };
    const bike: Workout = {
      v: 2,
      sport: "bike",
      name: "Sweet spot",
      steps: [
        { type: "warmup", end: { type: "time", seconds: 900 }, target: { metric: "power", anchor: "ftp", low: 55, high: 70 } },
        { type: "repeat", count: 3, steps: [{ type: "work", end: { type: "time", seconds: 600 }, target: { metric: "power", anchor: "ftp", low: 88, high: 93 }, target2: { metric: "hr", anchor: "lthr", low: 80, high: 95 } }, { type: "recovery", end: { type: "time", seconds: 300 }, target: { metric: "power", anchor: "ftp", zone: 1 } }] },
        { type: "cooldown", end: { type: "time", seconds: 600 } },
      ],
    };
    const steady: Workout = { v: 2, sport: "run", name: "Easy", steps: [{ type: "work", end: { type: "time", seconds: 3600 }, target: { metric: "hr", anchor: "lthr", zone: 2 } }] };
    const tempo: Workout = { v: 2, sport: "run", name: "Tempo", steps: [{ type: "work", end: { type: "distance", meters: 8000 }, target: { metric: "pace", anchor: "threshold_pace", low: 95, high: 100 } }] };
    const swimSet: Workout = { v: 2, sport: "swim", name: "CSS", poolLengthM: 25, steps: [{ type: "repeat", count: 8, steps: [{ type: "work", end: { type: "distance", meters: 100 }, target: { metric: "pace", anchor: "css", offsetLow: 1, offsetHigh: 3 } }, { type: "rest", end: { type: "time", seconds: 15 } }] }] };

    for (const w of [intervals, bike, steady, tempo, swimSet]) {
      const sets = workoutToRows(w).map((r) => ({ ...r, discipline: w.sport, sessionRole: null, targetHeartRateZone: null }));
      const steps = programSteps(sets, loadAnchors(thresholds), DEFAULT_IF);
      expect(plannedLoad(w.sport, steps, loadAnchors(thresholds)), w.name).toEqual(workoutPlannedLoad(w, thresholds));
      const est = estimateWorkout(w, thresholds);
      const seconds = steps.every((s) => s.seconds != null) ? steps.reduce((a, s) => a + s.seconds!, 0) : null;
      if (!est.durationComplete) expect(seconds, w.name).toBeNull();
      // Each step is rounded to whole seconds; the tree rounds its total once.
      else expect(Math.abs(seconds! - est.durationSeconds), w.name).toBeLessThanOrEqual(steps.length);
      expect(isHardSession(sets, thresholds), w.name).toBe(isHardWorkout(w, thresholds));
    }
  });

  it("a steady work step is not hard, though the old rule made every work set hard", async () => {
    const { isHardSession } = await import("@/lib/utils/training-limits");
    expect(isHardSession([{ discipline: "run", sessionRole: "work", targetHeartRateZone: null, stepKind: "work", blockId: null, targets: [{ metric: "hr", anchor: "lthr", zone: 2 }] }])).toBe(false);
    expect(isHardSession([{ discipline: "run", sessionRole: "work", targetHeartRateZone: null }])).toBe(true);
  });
});

describe("plainSetsToWorkout", () => {
  it("turns plain run sets into steps, with zones as HR targets", async () => {
    const { plainSetsToWorkout } = await import("@/lib/utils/program-steps");
    const w = plainSetsToWorkout(
      [
        { setNumber: 2, distanceMeters: 1000, durationSeconds: null, targetHeartRateZone: 4, sessionRole: "work" },
        { setNumber: 1, distanceMeters: null, durationSeconds: 600, targetHeartRateZone: 1, sessionRole: null },
        { setNumber: 3, distanceMeters: null, durationSeconds: null, targetHeartRateZone: null, sessionRole: null },
      ],
      { sport: "run", name: "Run" },
    );
    expect(w.steps).toEqual([
      { type: "recovery", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 1 } },
      { type: "work", end: { type: "distance", meters: 1000 }, target: { metric: "hr", anchor: "lthr", zone: 4 } },
      { type: "work", end: { type: "lap" } },
    ]);
    expect(parseWorkout(w).ok).toBe(true);
  });

  it("keeps a warm-up set as a warm-up step", async () => {
    const { plainSetsToWorkout } = await import("@/lib/utils/program-steps");
    const w = plainSetsToWorkout([{ setNumber: 1, distanceMeters: null, durationSeconds: 600, targetHeartRateZone: 1, sessionRole: null, setType: "warmup" }], { sport: "bike", name: "Ride" });
    expect(w.steps).toEqual([{ type: "warmup", end: { type: "time", seconds: 600 }, target: { metric: "hr", anchor: "lthr", zone: 1 } }]);
  });

  // docs/plans/run-logger.md, step 1.
  it("a run set with time and distance ends on its time with the pace of distance over time", async () => {
    const { plainSetsToWorkout } = await import("@/lib/utils/program-steps");
    const w = plainSetsToWorkout(
      [
        { setNumber: 1, distanceMeters: 5000, durationSeconds: 1500, targetHeartRateZone: 2, sessionRole: null },
        { setNumber: 2, distanceMeters: 3000, durationSeconds: 1200, targetHeartRateZone: null, sessionRole: null },
      ],
      { sport: "run", name: "Run" },
    );
    // 5000 m in 25 min is 3.333 m/s, as a range 2% each side; the zone stays as the cap.
    expect(w.steps).toEqual([
      { type: "work", end: { type: "time", seconds: 1500 }, target: { metric: "pace", anchor: "absolute", low: 3.267, high: 3.4 }, target2: { metric: "hr", anchor: "lthr", zone: 2 } },
      { type: "work", end: { type: "time", seconds: 1200 }, target: { metric: "pace", anchor: "absolute", low: 2.45, high: 2.55 } },
    ]);
    expect(parseWorkout(w).ok).toBe(true);
  });

  it("a run set whose sync anchor is its distance keeps the distance end, with the pace", async () => {
    const { plainSetsToWorkout } = await import("@/lib/utils/program-steps");
    const w = plainSetsToWorkout([{ setNumber: 1, distanceMeters: 10000, durationSeconds: 3600, peakDistanceMeters: 10000, targetHeartRateZone: null, sessionRole: null }], { sport: "run", name: "Run" });
    expect(w.steps[0]).toMatchObject({ end: { type: "distance", meters: 10000 }, target: { metric: "pace", anchor: "absolute" } });
  });

  it("a run set's incline becomes the step's incline; a ride ignores it", async () => {
    const { plainSetsToWorkout } = await import("@/lib/utils/program-steps");
    const set = { setNumber: 1, distanceMeters: null, durationSeconds: 1800, targetHeartRateZone: 2, sessionRole: null, inclinePercent: 1.5 };
    expect(plainSetsToWorkout([set], { sport: "run", name: "Run" }).steps[0]).toMatchObject({ incline: 1.5 });
    expect(plainSetsToWorkout([set], { sport: "bike", name: "Ride" }).steps[0]).not.toHaveProperty("incline");
  });

  it("a ride with time and distance keeps today's end and no pace", async () => {
    const { plainSetsToWorkout } = await import("@/lib/utils/program-steps");
    const w = plainSetsToWorkout([{ setNumber: 1, distanceMeters: 30000, durationSeconds: 3600, targetHeartRateZone: null, sessionRole: null }], { sport: "bike", name: "Ride" });
    expect(w.steps).toEqual([{ type: "work", end: { type: "distance", meters: 30000 } }]);
  });
});

describe("plainSetsToStepRows (bike-ride-logger, step 1)", () => {
  const plain = (setNumber: number, f: Partial<{ durationSeconds: number | null; distanceMeters: number | null; targetHeartRateZone: number | null; sessionRole: string | null; setType: string | null; restTimeSeconds: number }>) => ({
    setNumber,
    durationSeconds: null,
    distanceMeters: null,
    targetHeartRateZone: null,
    sessionRole: null,
    setType: "working",
    restTimeSeconds: 0,
    ...f,
  });

  it("puts a rest step after a set with rest, but not after the last set, and names each row's set", async () => {
    const { plainSetsToStepRows } = await import("@/lib/utils/program-steps");
    const out = plainSetsToStepRows(
      [
        plain(1, { durationSeconds: 900, targetHeartRateZone: 2, setType: "warmup", restTimeSeconds: 60 }),
        plain(2, { durationSeconds: 900, targetHeartRateZone: 3, restTimeSeconds: 3 }),
        plain(3, { durationSeconds: 300, targetHeartRateZone: 4, sessionRole: "work", restTimeSeconds: 120 }),
      ],
      { sport: "bike", name: "Bike tempo" },
    );
    if ("error" in out) throw new Error(out.error);
    expect(out.rows.map((r) => [r.setNumber, r.from, r.stepKind, r.durationSeconds, r.targets])).toEqual([
      [1, 1, "warmup", 900, [{ metric: "hr", anchor: "lthr", zone: 2 }]],
      [2, null, "rest", 60, null],
      [3, 2, "work", 900, [{ metric: "hr", anchor: "lthr", zone: 3 }]],
      // A rest under 5 s rounds up to the 5 s a step needs.
      [4, null, "rest", 5, null],
      [5, 3, "work", 300, [{ metric: "hr", anchor: "lthr", zone: 4 }]],
    ]);
  });

  it("returns the schema problem for a set no step can hold", async () => {
    const { plainSetsToStepRows } = await import("@/lib/utils/program-steps");
    const out = plainSetsToStepRows([plain(1, { durationSeconds: 13 * 3600 })], { sport: "bike", name: "Ride" });
    expect("error" in out && out.error).toMatch(/seconds/);
  });
});

describe("programPlay (one-program-model journey review)", () => {
  it("names the leg of each step in a brick, and keys steps by exercise", async () => {
    const { programPlay } = await import("@/lib/utils/program-steps");
    const ride: Workout = { v: 2, sport: "bike", name: "B", steps: [{ type: "work", end: { type: "time", seconds: 3600 } }] };
    const run: Workout = { v: 2, sport: "run", name: "B", steps: [{ type: "work", end: { type: "time", seconds: 1200 } }] };
    const plays = programPlay([{ programExerciseId: 1, sport: "bike", workout: ride }, { programExerciseId: 2, sport: "run", workout: run }], {});
    expect(plays.flatMap((p) => p.rows.map((r) => [r.key, r.text]))).toEqual([["e1:n1", "Ride · 1 h"], ["e2:n1", "Run · 20 min"]]);
    const single = programPlay([{ programExerciseId: 1, sport: "run", workout: run }], {});
    expect(single[0].rows[0]).toMatchObject({ key: "n1", text: "20 min" });
  });
});
