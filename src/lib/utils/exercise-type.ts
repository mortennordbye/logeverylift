/**
 * Exercise type — the compound/accessory/isolation/plyometric/isometric role.
 *
 * `compound`, `isolation`, `plyometric`, `isometric` are intrinsic to the
 * movement and live on the exercise. `accessory` is a per-program role and is
 * primarily set as an override on a program_exercise. The effective type for a
 * given exercise-in-a-program is `programExercise.exerciseType ?? exercise.exerciseType`.
 */

export const EXERCISE_TYPES = [
  "compound",
  "accessory",
  "isolation",
  "plyometric",
  "isometric",
] as const;

export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  compound: "Compound",
  accessory: "Accessory",
  isolation: "Isolation",
  plyometric: "Plyometric",
  isometric: "Isometric",
};

/**
 * Resolve the effective type: the per-program override wins, else the
 * exercise's intrinsic default. Null when neither is set.
 */
export function resolveExerciseType(
  override: ExerciseType | null | undefined,
  exerciseDefault: ExerciseType | null | undefined,
): ExerciseType | null {
  return override ?? exerciseDefault ?? null;
}

/**
 * Default intrinsic type derived from a movement pattern. Used to backfill the
 * library and seed new exercises. Coarse — multi-joint patterns map to compound,
 * holds to isometric, rotation to isolation — so cable curls/raises tagged "push"/
 * "pull" land on compound; refine per-exercise in the editor. Cardio/unpatterned → null.
 */
export function exerciseTypeFromPattern(
  movementPattern: string | null | undefined,
): ExerciseType | null {
  switch (movementPattern) {
    case "squat":
    case "hinge":
    case "push":
    case "pull":
    case "carry":
      return "compound";
    case "isometric":
      return "isometric";
    case "rotation":
      return "isolation";
    default:
      return null; // cardio, null, anything unrecognised
  }
}

/** True for types that progression should treat with compound-sized load jumps. */
export function isCompoundType(type: ExerciseType | null | undefined): boolean {
  return type === "compound";
}

/**
 * The value to persist as a program_exercise's type override, given the role an
 * importer/generator assigned to the exercise in this program and the exercise's
 * intrinsic default. Stores an override only when the role differs from the
 * default — otherwise null (inherit). This keeps round-trips clean: an exercise
 * playing its natural role carries no override.
 */
export function programOverrideForRole(
  role: ExerciseType | null | undefined,
  exerciseDefault: string | null | undefined,
): ExerciseType | null {
  if (!role) return null;
  return role === exerciseDefault ? null : role;
}
