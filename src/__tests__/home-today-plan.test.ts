import { todayPlanFrom, type PlanRow } from "@/lib/home/today-plan";
import { describe, expect, it } from "vitest";

/** Today's plan from the program rows (src/lib/home/today-plan.ts). */

const set = (programExerciseId: number, name: string, over: Partial<PlanRow> = {}): PlanRow => ({
  programExerciseId,
  name,
  setType: "working",
  targetReps: 8,
  repRangeMin: null,
  repRangeMax: null,
  weightKg: null,
  durationSeconds: null,
  distanceMeters: null,
  restTimeSeconds: 90,
  ...over,
});

describe("todayPlanFrom", () => {
  it("counts exercises and working sets, formats the first three, names the rest", () => {
    const rows = [
      set(1, "Bench Press", { setType: "warmup", weightKg: "40.00" }),
      ...Array.from({ length: 4 }, () => set(1, "Bench Press", { repRangeMin: 6, repRangeMax: 8, weightKg: "80.00" })),
      ...Array.from({ length: 3 }, () => set(2, "Overhead Press", { weightKg: "47.50" })),
      set(3, "Plank", { targetReps: null, durationSeconds: 45 }),
      set(4, "Pull-up"),
      set(5, "Curl", { setType: null }),
    ];
    const p = todayPlanFrom(rows)!;
    expect(p.exerciseCount).toBe(5);
    expect(p.setCount).toBe(9);
    expect(p.exercises).toEqual([
      { name: "Bench Press", sets: "4 × 6–8 · 80 kg" },
      { name: "Overhead Press", sets: "3 × 8 · 47.5 kg" },
      { name: "Plank", sets: "1 × 45 s" },
    ]);
    expect(p.more).toEqual(["Pull-up", "Curl"]);
    // 5 changeovers (300 s) and 10 sets, the warm-up included, at 45 + 90 s (1350 s): 1650 s, 27.5 min, rounded to 30.
    expect(p.minutes).toBe(30);
  });

  it("null without exercises", () => {
    expect(todayPlanFrom([])).toBeNull();
  });
});

describe("todayPlanFrom with endurance steps (docs/plans/one-program-model.md)", () => {
  const step = (over: Partial<PlanRow>): PlanRow => set(1, "Run", { targetReps: null, restTimeSeconds: 0, ...over });
  it("names each block once with its rounds, counts steps, and leaves the time out when a step has none", () => {
    const rows = [
      step({ stepKind: "warmup", distanceMeters: 2000 }),
      ...[1, 2].flatMap((round) => [
        step({ stepKind: "work", distanceMeters: 1000, blockId: 1, blockRound: round }),
        step({ stepKind: "recovery", durationSeconds: 120, blockId: 1, blockRound: round }),
      ]),
      step({ stepKind: "cooldown", endsOnLap: true }),
    ];
    const p = todayPlanFrom(rows)!;
    expect(p.exercises[0].sets).toBe("2 km warm-up · 2 × (1 km, 2 min easy) · to lap cool-down");
    expect(p.minutes).toBeNull();
    expect(p.stepsOnly).toBe(true);
    expect(p.setCount).toBe(6);
  });

  it("marks a program of one run with steps as a run day (docs/plans/run-logger.md, planned day card)", () => {
    const run = todayPlanFrom([step({ stepKind: "warmup", durationSeconds: 600, discipline: "run" }), step({ stepKind: "work", durationSeconds: 3000, discipline: "run" })])!;
    expect(run.runExerciseId).toBe(1);
    // A run of plain sets, a bike, and a run with a second exercise are not.
    expect(todayPlanFrom([step({ durationSeconds: 3000, discipline: "run" })])!.runExerciseId).toBeUndefined();
    expect(todayPlanFrom([step({ stepKind: "work", durationSeconds: 3000, discipline: "bike" })])!.runExerciseId).toBeUndefined();
    expect(todayPlanFrom([step({ stepKind: "work", durationSeconds: 3000, discipline: "run" }), set(2, "Plank", { durationSeconds: 45 })])!.runExerciseId).toBeUndefined();
  });

  it("keeps the time when every step is timed, and a lifter's plan has no step fields", () => {
    const timed = todayPlanFrom([step({ stepKind: "work", durationSeconds: 1800 })])!;
    expect(timed.minutes).toBe(30);
    const lift = todayPlanFrom([set(1, "Bench Press", { weightKg: "80.00" })])!;
    expect(lift.stepsOnly).toBeUndefined();
    expect(lift.minutes).not.toBeNull();
  });
});
