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
