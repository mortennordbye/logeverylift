import { buildSetLog } from "@/lib/utils/set-log";
import { describe, expect, it } from "vitest";

const plan = { targetReps: 8, weightKg: "80", durationSeconds: null, distanceMeters: null };

describe("buildSetLog", () => {
  it("a plain tap claims the plan", () => {
    expect(buildSetLog(plan, undefined, { restTimeSeconds: 90 })).toEqual({
      targetReps: 8,
      actualReps: 8,
      weightKg: 80,
      durationSeconds: undefined,
      distanceMeters: undefined,
      rir: undefined,
      restTimeSeconds: 90,
      notes: null,
      isCompleted: true,
      isFailed: false,
      wasEasy: false,
    });
  });

  it("uses what the session recorded over the plan", () => {
    const log = buildSetLog(
      plan,
      { targetReps: 10, weightKg: 82.5, actualReps: 9, rir: 1, notes: "belt", wasEasy: true },
      { restTimeSeconds: 60 },
    );
    expect(log).toMatchObject({ targetReps: 10, actualReps: 9, weightKg: 82.5, rir: 1, notes: "belt", wasEasy: true });
  });

  it("a set marked failed logs as failed, at RIR 0, never easy, and 0 reps when none were recorded", () => {
    // The catch-up path used to drop this: a failed set was logged as a clean
    // hit at the full target.
    const log = buildSetLog(plan, { targetReps: 8, weightKg: 80, isFailed: true, wasEasy: true, rir: 3 }, { restTimeSeconds: 0 });
    expect(log).toMatchObject({ isFailed: true, rir: 0, wasEasy: false, actualReps: 0, targetReps: 8 });
  });

  it("a failed set keeps the reps it did get", () => {
    expect(buildSetLog(plan, { targetReps: 8, weightKg: 80, isFailed: true, actualReps: 5 }, { restTimeSeconds: 0 }).actualReps).toBe(5);
  });

  it("reps and effort entered while logging win over the override", () => {
    const log = buildSetLog(plan, { targetReps: 8, weightKg: 80, actualReps: 6, rir: 2 }, {
      restTimeSeconds: 90,
      recorded: { actualReps: 7, rir: 0 },
    });
    expect(log).toMatchObject({ actualReps: 7, rir: 0 });
  });

  it("a timed set sends no target and keeps its duration", () => {
    const log = buildSetLog({ ...plan, targetReps: 0, weightKg: null, durationSeconds: 45 }, undefined, { restTimeSeconds: 60 });
    expect(log).toMatchObject({ targetReps: undefined, durationSeconds: 45, weightKg: 0 });
  });
});
