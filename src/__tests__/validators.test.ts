import { describe, expect, it } from "vitest";
import {
  addExerciseToProgramSchema,
  addProgramSetSchema,
  completeWorkoutSessionSchema,
  createExerciseSchema,
  createProgramSchema,
  createWorkoutSessionSchema,
  deleteProgramSetSchema,
  importProgramSchema,
  logWorkoutSetSchema,
  removeExerciseFromProgramSchema,
  reorderProgramExercisesSchema,
  reorderProgramSetsSchema,
  updateProgramSetSchema,
  workoutHistoryQuerySchema,
} from "@/lib/validators/workout";

// ─── createWorkoutSessionSchema ───────────────────────────────────────────────

describe("createWorkoutSessionSchema", () => {
  const valid = { date: "2026-03-17" };

  it("accepts valid input", () => {
    expect(createWorkoutSessionSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid date format", () => {
    expect(createWorkoutSessionSchema.safeParse({ ...valid, date: "17-03-2026" }).success).toBe(false);
    expect(createWorkoutSessionSchema.safeParse({ ...valid, date: "2026/03/17" }).success).toBe(false);
    expect(createWorkoutSessionSchema.safeParse({ ...valid, date: "not-a-date" }).success).toBe(false);
  });

  it("accepts valid date format", () => {
    expect(createWorkoutSessionSchema.safeParse({ ...valid, date: "2026-01-01" }).success).toBe(true);
  });

  it("accepts optional notes within limit", () => {
    expect(createWorkoutSessionSchema.safeParse({ ...valid, notes: "Felt good" }).success).toBe(true);
  });

  it("rejects notes over 1000 characters", () => {
    const longNotes = "a".repeat(1001);
    expect(createWorkoutSessionSchema.safeParse({ ...valid, notes: longNotes }).success).toBe(false);
  });
});

// ─── logWorkoutSetSchema ──────────────────────────────────────────────────────

describe("logWorkoutSetSchema", () => {
  const valid = {
    sessionId: 1,
    exerciseId: 1,
    setNumber: 1,
    actualReps: 10,
    weightKg: 80,
    rpe: 8,
    restTimeSeconds: 90,
  };

  it("accepts valid input", () => {
    expect(logWorkoutSetSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects RPE below 1", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, rpe: 0 }).success).toBe(false);
  });

  it("rejects RPE above 10", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, rpe: 11 }).success).toBe(false);
  });

  it("accepts RPE boundary values 1 and 10", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, rpe: 1 }).success).toBe(true);
    expect(logWorkoutSetSchema.safeParse({ ...valid, rpe: 10 }).success).toBe(true);
  });

  it("rejects negative weight", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, weightKg: -1 }).success).toBe(false);
  });

  it("rejects weight over 1000kg", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, weightKg: 1001 }).success).toBe(false);
  });

  it("accepts 0kg weight", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, weightKg: 0 }).success).toBe(true);
  });

  it("rejects negative actualReps", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, actualReps: -1 }).success).toBe(false);
  });

  it("accepts 0 actualReps (failed set)", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, actualReps: 0 }).success).toBe(true);
  });

  it("rejects rest time over 3600 seconds", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, restTimeSeconds: 3601 }).success).toBe(false);
  });

  it("accepts 3600 seconds rest (boundary)", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, restTimeSeconds: 3600 }).success).toBe(true);
  });

  it("defaults isCompleted to true", () => {
    const result = logWorkoutSetSchema.safeParse(valid);
    expect(result.success && result.data.isCompleted).toBe(true);
  });

  it("accepts RIR within 0-5", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, rir: 0 }).success).toBe(true);
    expect(logWorkoutSetSchema.safeParse({ ...valid, rir: 5 }).success).toBe(true);
  });

  it("rejects RIR above 5", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, rir: 6 }).success).toBe(false);
  });

  it("rejects negative RIR", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, rir: -1 }).success).toBe(false);
  });

  it("treats RIR as optional", () => {
    expect(logWorkoutSetSchema.safeParse(valid).success).toBe(true);
  });
});

// ─── addProgramSetSchema ──────────────────────────────────────────────────────

describe("addProgramSetSchema", () => {
  const valid = { programExerciseId: 1, setNumber: 1 };

  it("accepts valid minimal input", () => {
    expect(addProgramSetSchema.safeParse(valid).success).toBe(true);
  });

  it("defaults restTimeSeconds to 0", () => {
    const result = addProgramSetSchema.safeParse(valid);
    expect(result.success && result.data.restTimeSeconds).toBe(0);
  });

  it("accepts optional weightKg", () => {
    expect(addProgramSetSchema.safeParse({ ...valid, weightKg: 100 }).success).toBe(true);
  });

  it("rejects weightKg over 1000", () => {
    expect(addProgramSetSchema.safeParse({ ...valid, weightKg: 1001 }).success).toBe(false);
  });

  it("rejects non-positive setNumber", () => {
    expect(addProgramSetSchema.safeParse({ ...valid, setNumber: 0 }).success).toBe(false);
  });
});

// ─── createProgramSchema ──────────────────────────────────────────────────────

describe("createProgramSchema", () => {
  const valid = { name: "Push Day" };

  it("accepts valid input", () => {
    expect(createProgramSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty name", () => {
    expect(createProgramSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects name over 100 characters", () => {
    expect(createProgramSchema.safeParse({ ...valid, name: "a".repeat(101) }).success).toBe(false);
  });

  it("accepts name of exactly 100 characters", () => {
    expect(createProgramSchema.safeParse({ ...valid, name: "a".repeat(100) }).success).toBe(true);
  });
});

// ─── createExerciseSchema ─────────────────────────────────────────────────────

describe("createExerciseSchema", () => {
  const valid = { name: "Bench Press", category: "strength" as const };

  it("accepts valid strength exercise", () => {
    expect(createExerciseSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts cardio and flexibility categories", () => {
    expect(createExerciseSchema.safeParse({ ...valid, category: "cardio" }).success).toBe(true);
    expect(createExerciseSchema.safeParse({ ...valid, category: "flexibility" }).success).toBe(true);
  });

  it("rejects invalid category", () => {
    expect(createExerciseSchema.safeParse({ ...valid, category: "yoga" }).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(createExerciseSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
  });

  it("rejects name over 100 characters", () => {
    expect(createExerciseSchema.safeParse({ ...valid, name: "a".repeat(101) }).success).toBe(false);
  });

  it("defaults isCustom to true", () => {
    const result = createExerciseSchema.safeParse(valid);
    expect(result.success && result.data.isCustom).toBe(true);
  });
});

// ─── completeWorkoutSessionSchema ─────────────────────────────────────────────

describe("completeWorkoutSessionSchema", () => {
  it("accepts valid sessionId", () => {
    expect(completeWorkoutSessionSchema.safeParse({ sessionId: 1 }).success).toBe(true);
  });

  it("rejects non-positive sessionId", () => {
    expect(completeWorkoutSessionSchema.safeParse({ sessionId: 0 }).success).toBe(false);
  });

  it("accepts optional notes", () => {
    expect(completeWorkoutSessionSchema.safeParse({ sessionId: 1, notes: "Good session" }).success).toBe(true);
  });

  it("rejects notes over 1000 characters", () => {
    expect(completeWorkoutSessionSchema.safeParse({ sessionId: 1, notes: "a".repeat(1001) }).success).toBe(false);
  });
});

// ─── reorder schemas ──────────────────────────────────────────────────────────

describe("reorderProgramExercisesSchema", () => {
  it("accepts valid input", () => {
    expect(reorderProgramExercisesSchema.safeParse({ programId: 1, orderedIds: [3, 1, 2] }).success).toBe(true);
  });

  it("rejects empty orderedIds array", () => {
    expect(reorderProgramExercisesSchema.safeParse({ programId: 1, orderedIds: [] }).success).toBe(false);
  });

  it("rejects non-positive IDs in orderedIds", () => {
    expect(reorderProgramExercisesSchema.safeParse({ programId: 1, orderedIds: [1, 0] }).success).toBe(false);
  });
});

describe("reorderProgramSetsSchema", () => {
  it("accepts valid input", () => {
    expect(reorderProgramSetsSchema.safeParse({ programExerciseId: 1, orderedIds: [2, 1] }).success).toBe(true);
  });

  it("rejects empty orderedIds array", () => {
    expect(reorderProgramSetsSchema.safeParse({ programExerciseId: 1, orderedIds: [] }).success).toBe(false);
  });
});

// ─── workoutHistoryQuerySchema ─────────────────────────────────────────────────

describe("workoutHistoryQuerySchema", () => {
  it("accepts empty input", () => {
    expect(workoutHistoryQuerySchema.safeParse({}).success).toBe(true);
  });

  it("accepts optional exerciseId", () => {
    expect(workoutHistoryQuerySchema.safeParse({ exerciseId: 5 }).success).toBe(true);
  });

  it("rejects non-positive exerciseId", () => {
    expect(workoutHistoryQuerySchema.safeParse({ exerciseId: 0 }).success).toBe(false);
  });

  it("defaults limit to 50", () => {
    const result = workoutHistoryQuerySchema.safeParse({});
    expect(result.success && result.data.limit).toBe(50);
  });

  it("rejects limit over 100", () => {
    expect(workoutHistoryQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("defaults offset to 0", () => {
    const result = workoutHistoryQuerySchema.safeParse({});
    expect(result.success && result.data.offset).toBe(0);
  });

  it("rejects negative offset", () => {
    expect(workoutHistoryQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
  });
});

// ─── addExerciseToProgramSchema ───────────────────────────────────────────────

describe("addExerciseToProgramSchema", () => {
  const valid = { programId: 1, exerciseId: 2 };

  it("accepts valid input", () => {
    expect(addExerciseToProgramSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects non-positive programId", () => {
    expect(addExerciseToProgramSchema.safeParse({ ...valid, programId: 0 }).success).toBe(false);
  });

  it("rejects non-positive exerciseId", () => {
    expect(addExerciseToProgramSchema.safeParse({ ...valid, exerciseId: 0 }).success).toBe(false);
  });

  it("accepts optional orderIndex of 0", () => {
    expect(addExerciseToProgramSchema.safeParse({ ...valid, orderIndex: 0 }).success).toBe(true);
  });

  it("accepts optional notes within limit", () => {
    expect(addExerciseToProgramSchema.safeParse({ ...valid, notes: "a".repeat(500) }).success).toBe(true);
  });

  it("rejects notes over 500 characters", () => {
    expect(addExerciseToProgramSchema.safeParse({ ...valid, notes: "a".repeat(501) }).success).toBe(false);
  });
});

// ─── updateProgramSetSchema ───────────────────────────────────────────────────

describe("updateProgramSetSchema", () => {
  it("accepts valid input with only id", () => {
    expect(updateProgramSetSchema.safeParse({ id: 1 }).success).toBe(true);
  });

  it("rejects non-positive id", () => {
    expect(updateProgramSetSchema.safeParse({ id: 0 }).success).toBe(false);
    expect(updateProgramSetSchema.safeParse({ id: -1 }).success).toBe(false);
  });

  it("accepts restTimeSeconds at boundary 3600", () => {
    expect(updateProgramSetSchema.safeParse({ id: 1, restTimeSeconds: 3600 }).success).toBe(true);
  });

  it("rejects restTimeSeconds over 3600", () => {
    expect(updateProgramSetSchema.safeParse({ id: 1, restTimeSeconds: 3601 }).success).toBe(false);
  });

  it("accepts durationSeconds field", () => {
    expect(updateProgramSetSchema.safeParse({ id: 1, durationSeconds: 90 }).success).toBe(true);
  });
});

// ─── removeExerciseFromProgramSchema ──────────────────────────────────────────

describe("removeExerciseFromProgramSchema", () => {
  const valid = { programExerciseId: 1, programId: 2 };

  it("accepts valid input", () => {
    expect(removeExerciseFromProgramSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects non-positive programExerciseId", () => {
    expect(removeExerciseFromProgramSchema.safeParse({ ...valid, programExerciseId: 0 }).success).toBe(false);
  });

  it("rejects non-positive programId", () => {
    expect(removeExerciseFromProgramSchema.safeParse({ ...valid, programId: 0 }).success).toBe(false);
  });
});

// ─── deleteProgramSetSchema ───────────────────────────────────────────────────

describe("deleteProgramSetSchema", () => {
  it("accepts valid input", () => {
    expect(deleteProgramSetSchema.safeParse({ programSetId: 1 }).success).toBe(true);
  });

  it("rejects non-positive programSetId", () => {
    expect(deleteProgramSetSchema.safeParse({ programSetId: 0 }).success).toBe(false);
    expect(deleteProgramSetSchema.safeParse({ programSetId: -1 }).success).toBe(false);
  });
});

// ─── addProgramSetSchema (additional cases) ───────────────────────────────────

describe("addProgramSetSchema additional", () => {
  const valid = { programExerciseId: 1, setNumber: 1 };

  it("accepts durationSeconds field", () => {
    expect(addProgramSetSchema.safeParse({ ...valid, durationSeconds: 60 }).success).toBe(true);
  });

  it("accepts restTimeSeconds at boundary 3600", () => {
    expect(addProgramSetSchema.safeParse({ ...valid, restTimeSeconds: 3600 }).success).toBe(true);
  });

  it("rejects restTimeSeconds over 3600", () => {
    expect(addProgramSetSchema.safeParse({ ...valid, restTimeSeconds: 3601 }).success).toBe(false);
  });
});

// ─── createExerciseSchema (enum fields) ──────────────────────────────────────

describe("createExerciseSchema enum fields", () => {
  const valid = { name: "Squat", category: "strength" as const };

  it("accepts valid bodyArea values", () => {
    for (const v of ["upper_body", "lower_body", "core", "full_body", "cardio"]) {
      expect(createExerciseSchema.safeParse({ ...valid, bodyArea: v }).success).toBe(true);
    }
  });

  it("rejects invalid bodyArea", () => {
    expect(createExerciseSchema.safeParse({ ...valid, bodyArea: "arms" }).success).toBe(false);
  });

  it("accepts valid muscleGroup values", () => {
    for (const v of ["chest", "back", "shoulders", "quads", "glutes"]) {
      expect(createExerciseSchema.safeParse({ ...valid, muscleGroup: v }).success).toBe(true);
    }
  });

  it("rejects invalid muscleGroup", () => {
    expect(createExerciseSchema.safeParse({ ...valid, muscleGroup: "legs" }).success).toBe(false);
  });

  it("accepts valid equipment values", () => {
    for (const v of ["barbell", "dumbbell", "machine", "bodyweight", "kettlebell"]) {
      expect(createExerciseSchema.safeParse({ ...valid, equipment: v }).success).toBe(true);
    }
  });

  it("rejects invalid equipment", () => {
    expect(createExerciseSchema.safeParse({ ...valid, equipment: "rope" }).success).toBe(false);
  });

  it("accepts valid movementPattern values", () => {
    for (const v of ["push", "pull", "hinge", "squat", "carry", "rotation", "isometric", "cardio"]) {
      expect(createExerciseSchema.safeParse({ ...valid, movementPattern: v }).success).toBe(true);
    }
  });

  it("rejects invalid movementPattern", () => {
    expect(createExerciseSchema.safeParse({ ...valid, movementPattern: "stretch" }).success).toBe(false);
  });

  it("accepts valid exerciseType values", () => {
    for (const v of ["compound", "accessory", "isolation", "plyometric", "isometric"]) {
      expect(createExerciseSchema.safeParse({ ...valid, exerciseType: v }).success).toBe(true);
    }
  });

  it("rejects invalid exerciseType", () => {
    expect(createExerciseSchema.safeParse({ ...valid, exerciseType: "main" }).success).toBe(false);
  });

  it("treats exerciseType as optional", () => {
    expect(createExerciseSchema.safeParse(valid).success).toBe(true);
  });
});

// ─── addProgramSetSchema (targetRir field) ────────────────────────────────────

describe("addProgramSetSchema targetRir", () => {
  const valid = { programExerciseId: 1, setNumber: 1 };

  it("accepts a target RIR within 0–5", () => {
    expect(addProgramSetSchema.safeParse({ ...valid, targetRir: 0 }).success).toBe(true);
    expect(addProgramSetSchema.safeParse({ ...valid, targetRir: 5 }).success).toBe(true);
  });

  it("rejects a target RIR above 5", () => {
    expect(addProgramSetSchema.safeParse({ ...valid, targetRir: 6 }).success).toBe(false);
  });

  it("treats targetRir as optional", () => {
    expect(addProgramSetSchema.safeParse(valid).success).toBe(true);
  });
});

// ─── addProgramSetSchema (startDelaySeconds field) ────────────────────────────

describe("addProgramSetSchema startDelaySeconds", () => {
  const valid = { programExerciseId: 1, setNumber: 1 };

  it("accepts a start delay within 0–60", () => {
    expect(addProgramSetSchema.safeParse({ ...valid, startDelaySeconds: 0 }).success).toBe(true);
    expect(addProgramSetSchema.safeParse({ ...valid, startDelaySeconds: 60 }).success).toBe(true);
  });

  it("rejects a delay above 60, negative, or fractional", () => {
    expect(addProgramSetSchema.safeParse({ ...valid, startDelaySeconds: 61 }).success).toBe(false);
    expect(addProgramSetSchema.safeParse({ ...valid, startDelaySeconds: -1 }).success).toBe(false);
    expect(addProgramSetSchema.safeParse({ ...valid, startDelaySeconds: 2.5 }).success).toBe(false);
  });

  it("treats startDelaySeconds as optional", () => {
    expect(addProgramSetSchema.safeParse(valid).success).toBe(true);
  });

  it("updateProgramSetSchema accepts null to clear it", () => {
    expect(updateProgramSetSchema.safeParse({ id: 1, startDelaySeconds: null }).success).toBe(true);
  });
});

// ─── logWorkoutSetSchema (targetReps field) ───────────────────────────────────

describe("logWorkoutSetSchema targetReps", () => {
  const valid = {
    sessionId: 1,
    exerciseId: 1,
    setNumber: 1,
    actualReps: 10,
    weightKg: 80,
    rpe: 8,
    restTimeSeconds: 90,
  };

  it("accepts optional positive targetReps", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, targetReps: 10 }).success).toBe(true);
  });

  it("rejects non-positive targetReps", () => {
    expect(logWorkoutSetSchema.safeParse({ ...valid, targetReps: 0 }).success).toBe(false);
    expect(logWorkoutSetSchema.safeParse({ ...valid, targetReps: -1 }).success).toBe(false);
  });
});

// ─── importProgramSchema (exercise.type — the per-program role) ────────────────

describe("importProgramSchema exercise.type", () => {
  const slot = (type: unknown) => ({
    program: {
      name: "P",
      exercises: [
        {
          idx: 0,
          incKg: 2.5,
          incReps: 0,
          mode: "manual",
          exercise: { name: "Bench Press", category: "strength", type },
          sets: [{ n: 1, reps: 5, kg: 60, rest: 90, type: "working" }],
        },
      ],
    },
  });

  function parsedType(input: unknown) {
    const r = importProgramSchema.safeParse(slot(input));
    if (!r.success) return undefined;
    const entry = "program" in r.data ? r.data.program : r.data.programs[0];
    return entry.exercises[0].exercise.type;
  }

  it("keeps a valid type", () => {
    expect(parsedType("accessory")).toBe("accessory");
    expect(parsedType("compound")).toBe("compound");
  });

  it("coerces an invalid type to null (lenient AI parsing)", () => {
    expect(parsedType("main")).toBeNull();
  });

  it("allows the type to be omitted", () => {
    const r = importProgramSchema.safeParse({
      program: {
        name: "P",
        exercises: [
          {
            idx: 0, incKg: 2.5, incReps: 0, mode: "manual",
            exercise: { name: "Bench Press", category: "strength" },
            sets: [{ n: 1, reps: 5, kg: 60, rest: 90, type: "working" }],
          },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  it("coerces an out-of-range startDelay to null (lenient AI parsing)", () => {
    const r = importProgramSchema.safeParse({
      program: {
        name: "P",
        exercises: [
          {
            idx: 0, incKg: 2.5, incReps: 0, mode: "manual",
            exercise: { name: "Handstand Hold", category: "strength" },
            sets: [{ n: 1, durSec: 30, rest: 90, type: "working", startDelay: 999 }],
          },
        ],
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      const entry = "program" in r.data ? r.data.program : r.data.programs[0];
      expect(entry.exercises[0].sets[0].startDelay).toBeNull();
    }
  });
});
