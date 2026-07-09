import { describe, expect, it } from "vitest";
import {
  createTrainingCycleSchema,
  reorderCycleSlotsSchema,
  updateTrainingCycleSchema,
  upsertCycleSlotSchema,
} from "@/lib/validators/training-cycles";

// ─── createTrainingCycleSchema ────────────────────────────────────────────────

describe("createTrainingCycleSchema", () => {
  const valid = { name: "My Cycle", durationWeeks: 8 };

  it("accepts valid minimal input", () => {
    expect(createTrainingCycleSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(createTrainingCycleSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects name over 100 characters", () => {
    expect(createTrainingCycleSchema.safeParse({ ...valid, name: "a".repeat(101) }).success).toBe(false);
  });

  it("accepts all valid durationWeeks values", () => {
    for (const weeks of [4, 6, 8, 10, 12, 16]) {
      expect(createTrainingCycleSchema.safeParse({ ...valid, durationWeeks: weeks }).success).toBe(true);
    }
  });

  it("rejects invalid durationWeeks values", () => {
    for (const weeks of [3, 5, 7, 14, 100]) {
      expect(createTrainingCycleSchema.safeParse({ ...valid, durationWeeks: weeks }).success).toBe(false);
    }
  });

  it("defaults scheduleType to day_of_week", () => {
    const result = createTrainingCycleSchema.safeParse(valid);
    expect(result.success && result.data.scheduleType).toBe("day_of_week");
  });

  it("defaults endAction to none", () => {
    const result = createTrainingCycleSchema.safeParse(valid);
    expect(result.success && result.data.endAction).toBe("none");
  });

  it("accepts all valid endAction values", () => {
    for (const action of ["deload", "new_cycle", "rest", "none"]) {
      expect(createTrainingCycleSchema.safeParse({ ...valid, endAction: action }).success).toBe(true);
    }
  });

  it("rejects invalid endAction", () => {
    expect(createTrainingCycleSchema.safeParse({ ...valid, endAction: "pause" }).success).toBe(false);
  });

  it("accepts all valid scheduleType values", () => {
    for (const type of ["day_of_week", "rotation"]) {
      expect(createTrainingCycleSchema.safeParse({ ...valid, scheduleType: type }).success).toBe(true);
    }
  });

  it("rejects invalid scheduleType", () => {
    expect(createTrainingCycleSchema.safeParse({ ...valid, scheduleType: "weekly" }).success).toBe(false);
  });

  it("rejects endMessage over 500 characters", () => {
    expect(createTrainingCycleSchema.safeParse({ ...valid, endMessage: "a".repeat(501) }).success).toBe(false);
  });
});

// ─── updateTrainingCycleSchema ────────────────────────────────────────────────

describe("updateTrainingCycleSchema", () => {
  it("accepts valid input with only id", () => {
    expect(updateTrainingCycleSchema.safeParse({ id: 1 }).success).toBe(true);
  });

  it("rejects non-positive id", () => {
    expect(updateTrainingCycleSchema.safeParse({ id: 0 }).success).toBe(false);
    expect(updateTrainingCycleSchema.safeParse({ id: -1 }).success).toBe(false);
  });

  it("all other fields are optional", () => {
    expect(updateTrainingCycleSchema.safeParse({ id: 1, name: "Updated" }).success).toBe(true);
    expect(updateTrainingCycleSchema.safeParse({ id: 1, endAction: "deload" }).success).toBe(true);
    expect(updateTrainingCycleSchema.safeParse({ id: 1, status: "active" }).success).toBe(true);
  });

  it("accepts all valid status values", () => {
    for (const status of ["draft", "active", "completed"]) {
      expect(updateTrainingCycleSchema.safeParse({ id: 1, status }).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(updateTrainingCycleSchema.safeParse({ id: 1, status: "paused" }).success).toBe(false);
  });

  it("accepts endMessage as null", () => {
    expect(updateTrainingCycleSchema.safeParse({ id: 1, endMessage: null }).success).toBe(true);
  });

  it("rejects invalid durationWeeks", () => {
    expect(updateTrainingCycleSchema.safeParse({ id: 1, durationWeeks: 5 }).success).toBe(false);
    expect(updateTrainingCycleSchema.safeParse({ id: 1, durationWeeks: 100 }).success).toBe(false);
  });
});

// ─── upsertCycleSlotSchema ────────────────────────────────────────────────────

describe("upsertCycleSlotSchema", () => {
  const valid = {
    trainingCycleId: 1,
    dayOfWeek: 3,
    orderIndex: 1,
    label: "Leg Day",
    programId: 5,
    notes: "Heavy squat day",
  };

  it("accepts valid input with all fields", () => {
    expect(upsertCycleSlotSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects non-positive trainingCycleId", () => {
    expect(upsertCycleSlotSchema.safeParse({ ...valid, trainingCycleId: 0 }).success).toBe(false);
    expect(upsertCycleSlotSchema.safeParse({ ...valid, trainingCycleId: -1 }).success).toBe(false);
  });

  it("accepts dayOfWeek boundary values 1 and 7", () => {
    expect(upsertCycleSlotSchema.safeParse({ ...valid, dayOfWeek: 1 }).success).toBe(true);
    expect(upsertCycleSlotSchema.safeParse({ ...valid, dayOfWeek: 7 }).success).toBe(true);
  });

  it("rejects dayOfWeek out of range", () => {
    expect(upsertCycleSlotSchema.safeParse({ ...valid, dayOfWeek: 0 }).success).toBe(false);
    expect(upsertCycleSlotSchema.safeParse({ ...valid, dayOfWeek: 8 }).success).toBe(false);
  });

  it("rejects non-positive orderIndex", () => {
    expect(upsertCycleSlotSchema.safeParse({ ...valid, orderIndex: 0 }).success).toBe(false);
  });

  it("accepts positive orderIndex", () => {
    expect(upsertCycleSlotSchema.safeParse({ ...valid, orderIndex: 1 }).success).toBe(true);
  });

  it("rejects label over 100 characters", () => {
    expect(upsertCycleSlotSchema.safeParse({ ...valid, label: "a".repeat(101) }).success).toBe(false);
  });

  it("rejects notes over 500 characters", () => {
    expect(upsertCycleSlotSchema.safeParse({ ...valid, notes: "a".repeat(501) }).success).toBe(false);
  });

  it("accepts programId as null", () => {
    expect(upsertCycleSlotSchema.safeParse({ ...valid, programId: null }).success).toBe(true);
  });
});

// ─── reorderCycleSlotsSchema ──────────────────────────────────────────────────

describe("reorderCycleSlotsSchema", () => {
  it("accepts valid input", () => {
    expect(reorderCycleSlotsSchema.safeParse({ cycleId: 1, orderedIds: [3, 1, 2] }).success).toBe(true);
  });

  it("rejects non-positive cycleId", () => {
    expect(reorderCycleSlotsSchema.safeParse({ cycleId: 0, orderedIds: [1] }).success).toBe(false);
    expect(reorderCycleSlotsSchema.safeParse({ cycleId: -1, orderedIds: [1] }).success).toBe(false);
  });

  it("rejects non-positive IDs in orderedIds array", () => {
    expect(reorderCycleSlotsSchema.safeParse({ cycleId: 1, orderedIds: [1, 0] }).success).toBe(false);
    expect(reorderCycleSlotsSchema.safeParse({ cycleId: 1, orderedIds: [-1] }).success).toBe(false);
  });

  it("accepts empty orderedIds array", () => {
    expect(reorderCycleSlotsSchema.safeParse({ cycleId: 1, orderedIds: [] }).success).toBe(true);
  });
});
