import { describe, expect, it } from "vitest";
import {
  EXERCISE_TYPES,
  exerciseTypeFromPattern,
  isCompoundType,
  programOverrideForRole,
  resolveExerciseType,
} from "@/lib/utils/exercise-type";
import { adaptiveIncrementKg } from "@/lib/utils/progression";

describe("exerciseTypeFromPattern", () => {
  it("maps multi-joint patterns to compound", () => {
    for (const p of ["squat", "hinge", "push", "pull", "carry"]) {
      expect(exerciseTypeFromPattern(p)).toBe("compound");
    }
  });
  it("maps isometric and rotation explicitly", () => {
    expect(exerciseTypeFromPattern("isometric")).toBe("isometric");
    expect(exerciseTypeFromPattern("rotation")).toBe("isolation");
  });
  it("returns null for cardio / unknown / null", () => {
    expect(exerciseTypeFromPattern("cardio")).toBeNull();
    expect(exerciseTypeFromPattern(null)).toBeNull();
    expect(exerciseTypeFromPattern(undefined)).toBeNull();
  });
});

describe("resolveExerciseType", () => {
  it("prefers the per-program override", () => {
    expect(resolveExerciseType("accessory", "compound")).toBe("accessory");
  });
  it("falls back to the exercise default", () => {
    expect(resolveExerciseType(null, "compound")).toBe("compound");
    expect(resolveExerciseType(undefined, "isolation")).toBe("isolation");
  });
  it("returns null when neither is set", () => {
    expect(resolveExerciseType(null, null)).toBeNull();
  });
});

describe("isCompoundType", () => {
  it("is true only for compound", () => {
    expect(isCompoundType("compound")).toBe(true);
    for (const t of EXERCISE_TYPES.filter((t) => t !== "compound")) {
      expect(isCompoundType(t)).toBe(false);
    }
    expect(isCompoundType(null)).toBe(false);
  });
});

// The import/AI-generation path stores a per-program override only when the
// assigned role differs from the exercise's intrinsic default.
describe("programOverrideForRole", () => {
  it("stores no override when the role matches the default", () => {
    expect(programOverrideForRole("compound", "compound")).toBeNull();
  });
  it("stores an override when the role differs (e.g. a compound used as accessory)", () => {
    expect(programOverrideForRole("accessory", "compound")).toBe("accessory");
  });
  it("stores the role as override when the exercise has no default", () => {
    expect(programOverrideForRole("isolation", null)).toBe("isolation");
  });
  it("stores no override when no role was assigned", () => {
    expect(programOverrideForRole(null, "compound")).toBeNull();
    expect(programOverrideForRole(undefined, null)).toBeNull();
  });
});

// The progression engine should size load jumps off the explicit type when set,
// overriding the coarse movement-pattern guess.
describe("adaptiveIncrementKg honours exerciseType", () => {
  // No stored increment, no experience level, mid-weight band (<30kg) where
  // compound vs isolation diverges (2.5 vs 1.0).
  it("treats a 'push' bicep curl as isolation when type=isolation", () => {
    // movementPattern alone ("push") would say compound → 2.5
    expect(adaptiveIncrementKg(null, 20, "push", null, null)).toBe(2.5);
    // explicit isolation type overrides → 1.0
    expect(adaptiveIncrementKg(null, 20, "push", null, null, "isolation")).toBe(1.0);
  });
  it("treats a 'rotation' exercise as compound when overridden to compound", () => {
    expect(adaptiveIncrementKg(null, 20, "rotation", null, null)).toBe(1.0);
    expect(adaptiveIncrementKg(null, 20, "rotation", null, null, "compound")).toBe(2.5);
  });
  it("falls back to the movement-pattern heuristic when type is null", () => {
    expect(adaptiveIncrementKg(null, 20, "squat", null, null, null)).toBe(2.5);
  });
});
