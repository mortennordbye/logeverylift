import { ftpTestWorkout } from "@/lib/utils/ftp-tests";
import { runTestWorkout } from "@/lib/utils/run-test";
import { stepTargetKey, workStepGaps, workStepMissing, workStepRuleText, workoutStepKeys } from "@/lib/utils/work-step-gaps";
import { parseWorkout, type Workout, type WorkoutStep } from "@/lib/utils/workout-steps";
import { describe, expect, it } from "vitest";

/** The strict work step check (docs/plans/strict-targets.md, decisions 2 and 3). */

const POWER = { metric: "power", anchor: "ftp", low: 88, high: 93 } as const;
const HR = { metric: "hr", anchor: "lthr", zone: 3 } as const;
const PACE = { metric: "pace", anchor: "threshold_pace", low: 85, high: 90 } as const;
const CADENCE = { low: 85, high: 95 };
const time = (seconds: number): WorkoutStep["end"] => ({ type: "time", seconds });
const work = (extra: Partial<WorkoutStep> = {}): WorkoutStep => ({ type: "work", end: time(600), ...extra });

describe("workStepMissing: a bike work step", () => {
  it("passes with power, heart rate and cadence, either target first", () => {
    expect(workStepMissing(work({ target: POWER, target2: HR, cadence: CADENCE }), "bike")).toEqual([]);
    expect(workStepMissing(work({ target: HR, target2: POWER, cadence: CADENCE }), "bike")).toEqual([]);
  });

  it("names each target it lacks", () => {
    expect(workStepMissing(work(), "bike")).toEqual(["power", "hr", "cadence"]);
    expect(workStepMissing(work({ target: POWER }), "bike")).toEqual(["hr", "cadence"]);
    expect(workStepMissing(work({ target: POWER, target2: HR }), "bike")).toEqual(["cadence"]);
    expect(workStepMissing(work({ target: HR, cadence: CADENCE }), "bike")).toEqual(["power"]);
  });

  it("counts a cadence target as cadence", () => {
    expect(workStepMissing(work({ target: POWER, target2: { metric: "cadence", anchor: "absolute", low: 85, high: 95 } }), "bike")).toEqual(["hr"]);
  });
});

describe("workStepMissing: a run work step", () => {
  it("passes with belt, heart rate and cadence", () => {
    expect(workStepMissing(work({ belt: 9.5, target: HR, cadence: { low: 166, high: 176 } }), "run")).toEqual([]);
    expect(workStepMissing(work({ belt: 13, target: PACE, target2: HR, cadence: { low: 176, high: 186 } }), "run")).toEqual([]);
  });

  it("names each target it lacks, and never asks for power", () => {
    expect(workStepMissing(work(), "run")).toEqual(["belt", "hr", "cadence"]);
    expect(workStepMissing(work({ target: PACE, cadence: CADENCE }), "run")).toEqual(["belt", "hr"]);
    expect(workStepMissing(work({ target: HR, belt: 10 }), "run")).toEqual(["cadence"]);
  });
});

describe("workStepMissing: exempt steps", () => {
  it.each(["warmup", "recovery", "cooldown", "rest"] as const)("a %s step needs nothing new", (type) => {
    expect(workStepMissing({ type, end: time(600), target: POWER }, "bike")).toEqual([]);
    expect(workStepMissing({ type, end: time(600) }, "run")).toEqual([]);
  });

  it("a ramp and a free spin", () => {
    expect(workStepMissing(work({ ramp: { anchor: "ftp", from: 50, to: 80 } }), "bike")).toEqual([]);
    expect(workStepMissing(work({ free: true }), "bike")).toEqual([]);
  });

  it("every step of a test", () => {
    expect(workStepMissing(work({ target: POWER }), "bike", "ramp")).toEqual([]);
    expect(workStepMissing(work(), "run", "30min")).toEqual([]);
    expect(workStepGaps(ftpTestWorkout("ramp"))).toEqual([]);
    expect(workStepGaps(ftpTestWorkout("20min"))).toEqual([]);
    expect(workStepGaps(runTestWorkout("treadmill"))).toEqual([]);
    expect(workStepGaps(runTestWorkout("outdoor"))).toEqual([]);
  });

  it("a swim", () => {
    expect(workStepMissing(work(), "swim")).toEqual([]);
  });
});

describe("workStepGaps", () => {
  const ride: Workout = {
    v: 2,
    sport: "bike",
    name: "Ride",
    steps: [
      { type: "warmup", end: time(600), target: { metric: "power", anchor: "ftp", zone: 1 } },
      { type: "repeat", count: 3, steps: [work({ target: POWER }), { type: "recovery", end: time(120) }] },
      work({ target: POWER, target2: HR, cadence: CADENCE }),
      work({ target: HR }),
    ],
  };

  it("lists each work step that lacks a target, with its path and place", () => {
    expect(workStepGaps(ride)).toEqual([
      { path: "steps[1].steps[0]", number: 2, missing: ["hr", "cadence"] },
      { path: "steps[3]", number: 5, missing: ["power", "cadence"] },
    ]);
  });

  it("leaves out the steps the exercise held already", () => {
    expect(workStepGaps(ride, workoutStepKeys(ride))).toEqual([]);
  });

  it("checks a held step again when its kind or a target changed", () => {
    const known = workoutStepKeys(ride);
    const changed: Workout = { ...ride, steps: [...ride.steps.slice(0, 3), work({ target: { ...HR, zone: 4 } })] };
    expect(workStepGaps(changed, known)).toEqual([{ path: "steps[3]", number: 5, missing: ["power", "cadence"] }]);
    const kind: Workout = { ...ride, steps: [{ type: "work", end: time(600), target: { metric: "power", anchor: "ftp", zone: 1 } }] };
    expect(workStepGaps(kind, known)).toHaveLength(1);
  });

  it("keeps a held step whose length or note changed", () => {
    const known = workoutStepKeys(ride);
    const longer: Workout = { ...ride, steps: [work({ target: HR, end: time(900), note: "Steady" })] };
    expect(workStepGaps(longer, known)).toEqual([]);
  });
});

describe("stepTargetKey", () => {
  it("does not depend on the order of keys, so a target read back from jsonb matches", () => {
    const a = work({ target: { metric: "hr", anchor: "lthr", low: 80, high: 85 } });
    const b = work({ target: { high: 85, low: 80, anchor: "lthr", metric: "hr" } as WorkoutStep["target"] });
    expect(stepTargetKey(a)).toBe(stepTargetKey(b));
  });

  it("ignores the end, the note and the id", () => {
    expect(stepTargetKey(work({ target: HR, id: "s1" }))).toBe(stepTargetKey(work({ target: HR, end: time(60), note: "x" })));
  });
});

describe("workStepRuleText", () => {
  it("says what a work step needs per sport", () => {
    expect(workStepRuleText("bike")).toBe("A bike work step needs power, heart rate and cadence");
    expect(workStepRuleText("run")).toBe("A run work step needs belt speed, heart rate and cadence");
  });
});

describe("parseWorkout keeps reading old steps", () => {
  it("a bike work step with power alone still parses", () => {
    expect(parseWorkout({ v: 2, sport: "bike", name: "Old", steps: [work({ target: POWER })] }).ok).toBe(true);
  });

  it("says spm for a run cadence and rpm for a bike cadence", () => {
    const run = parseWorkout({ v: 2, sport: "run", name: "x", steps: [work({ cadence: { low: 10, high: 180 } })] });
    const bike = parseWorkout({ v: 2, sport: "bike", name: "x", steps: [work({ cadence: { low: 10, high: 90 } })] });
    expect(run.ok ? [] : run.errors.map((e) => e.message)).toContain("must be 20-200 spm");
    expect(bike.ok ? [] : bike.errors.map((e) => e.message)).toContain("must be 20-200 rpm");
    const target = parseWorkout({ v: 2, sport: "run", name: "x", steps: [work({ target: { metric: "cadence", anchor: "absolute", low: 10, high: 180 } })] });
    expect(target.ok ? [] : target.errors.map((e) => e.message)).toContain("must be 20-200 spm");
  });
});
