/**
 * Workout Validation Schemas (Zod)
 *
 * Type-safe runtime validation for server actions and API endpoints.
 * These schemas ensure data integrity before database operations.
 *
 * Benefits:
 * - Runtime type checking (TypeScript only checks at compile time)
 * - Automatic error messages for invalid data
 * - Easy integration with form libraries (React Hook Form, etc.)
 * - Prevents SQL injection and malformed data
 *
 * Usage in Server Actions:
 * ```typescript
 * const result = logWorkoutSetSchema.safeParse(data);
 * if (!result.success) {
 *   return { success: false, error: result.error.flatten() };
 * }
 * // Proceed with validated result.data
 * ```
 */

import {
  MAX_BACKOFF_AFTER,
  MAX_BACKOFF_PCT,
  MAX_REQUIRED_HITS,
  MIN_BACKOFF_AFTER,
  MIN_BACKOFF_PCT,
  MIN_REQUIRED_HITS,
  PROGRESSION_ADVANCES,
  PROGRESSION_READINESSES,
  PROGRESSION_REGRESSES,
  PROGRESSION_SCOPES,
} from "@/lib/utils/progression";
import { z } from "zod";

export const WORKOUT_FEELINGS = ["Tired", "OK", "Good", "Awesome"] as const;
export type WorkoutFeeling = (typeof WORKOUT_FEELINGS)[number];

const feelingSchema = z.enum(WORKOUT_FEELINGS).optional();

/**
 * Create Workout Session Schema
 *
 * Validates data when starting a new workout session.
 */
export const createWorkoutSessionSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  startTime: z.string().optional(), // ISO timestamp, defaults to now in server action
  notes: z
    .string()
    .max(1000, "Notes must be 1000 characters or less")
    .optional(),
  programId: z.number().int().positive().optional(),
  // Original scheduled date when this session is making up a missed cycle day.
  intendedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional(),
});

/**
 * Log Workout Set Schema
 *
 * Validates individual set data during a workout.
 *
 * RPE (Rate of Perceived Exertion), when supplied, must be 1-10:
 * - 10: Maximum effort, no reps left
 * - 9: 1 rep in reserve (RIR)
 * - 8: 2-3 reps in reserve
 * - 7: Moderate effort
 * - 5-6: Easy, many reps left
 */
export const logWorkoutSetSchema = z.object({
  sessionId: z.number().int().positive("Session ID must be a positive integer"),
  exerciseId: z
    .number()
    .int()
    .positive("Exercise ID must be a positive integer"),
  setNumber: z.number().int().positive("Set number must be a positive integer"),
  // The program_sets row this set was logged against. Optional because a client
  // cached from before this shipped, or a replay queued by one, will not send
  // it; the server falls back to resolving the slot from the exercise. Present,
  // it is the exact identity — the only thing that can tell two slots for the
  // same exercise apart.
  programSetId: z.number().int().positive().optional(),
  targetReps: z
    .number()
    .int()
    .positive("Target reps must be positive")
    .optional(),
  actualReps: z.number().int().min(0, "Actual reps cannot be negative"),
  weightKg: z
    .number()
    .min(0, "Weight cannot be negative")
    .max(1000, "Weight must be under 1000kg"),
  durationSeconds: z.number().int().min(0).optional(),
  distanceMeters: z.number().int().min(0).optional(),
  inclinePercent: z.number().int().min(0).max(30).optional(),
  heartRateZone: z.number().int().min(1).max(5).optional(),
  // Reps In Reserve — the primary effort input (0 = to failure, 5 = 5+ left).
  // When present, the server derives rpe from it (rpe = clamp(10 - rir, 1, 10)).
  rir: z.number().int().min(0).max(5).optional(),
  // Optional, and absent means "the lifter did not say how hard it was". The
  // toggle used to send 7 on every tap, which is a claim nobody made; it now
  // sends nothing. Still accepted because a bundle cached before this shipped —
  // and every payload already sitting in the offline queue — still sends 7, and
  // a legacy 7 is stored as a real 7 rather than rewritten to unknown: the two
  // are indistinguishable on the wire and history is not ours to edit.
  rpe: z
    .number()
    .int()
    .min(1, "RPE must be at least 1")
    .max(10, "RPE must be at most 10")
    .optional(),
  restTimeSeconds: z
    .number()
    .int()
    .min(0, "Rest time cannot be negative")
    .max(3600, "Rest time must be under 1 hour"),
  notes: z
    .string()
    .max(500, "Notes must be 500 characters or less")
    .nullable()
    .optional(),
  isCompleted: z.boolean().default(true),
  isFailed: z.boolean().default(false),
  // Hit the target and it felt easy — an explicit request to progress next
  // session even if the consensus gate hasn't been met.
  wasEasy: z.boolean().default(false),
});

/**
 * Un-log Workout Set Schema
 *
 * Validates the identity of a logged set the user is un-completing. The set is
 * addressed the same way logWorkoutSet writes it: by (session, plan slot,
 * setNumber), which is the table's unique key.
 */
export const unlogWorkoutSetSchema = z.object({
  sessionId: z.number().int().positive("Session ID must be a positive integer"),
  exerciseId: z
    .number()
    .int()
    .positive("Exercise ID must be a positive integer"),
  setNumber: z.number().int().positive("Set number must be a positive integer"),
  // Same optionality and same purpose as on logWorkoutSetSchema: without it,
  // un-logging set 1 of the second slot deletes set 1 of the first.
  programSetId: z.number().int().positive().optional(),
});

/**
 * Workout History Query Schema
 *
 * Validates parameters for fetching workout history.
 * Used to query past performance for a specific exercise.
 */
export const workoutHistoryQuerySchema = z.object({
  exerciseId: z
    .number()
    .int()
    .positive("Exercise ID must be a positive integer")
    .optional(),
  limit: z.number().int().positive().max(100).default(50).optional(),
  offset: z.number().int().min(0).default(0).optional(),
});

/**
 * Complete Workout Session Schema
 *
 * Validates data when marking a session as complete.
 */
export const isSessionResumableSchema = z.object({
  sessionId: z.number().int().positive("Session ID must be a positive integer"),
  programId: z.number().int().positive("Program ID must be a positive integer"),
});

export const completeWorkoutSessionSchema = z.object({
  sessionId: z.number().int().positive("Session ID must be a positive integer"),
  endTime: z.string().optional(), // ISO timestamp, defaults to now
  notes: z
    .string()
    .max(1000, "Notes must be 1000 characters or less")
    .optional(),
  feeling: feelingSchema,
});

/**
 * Create Exercise Schema
 *
 * Validates data when adding a custom exercise.
 */
export const createExerciseSchema = z.object({
  name: z
    .string()
    .min(1, "Exercise name is required")
    .max(100, "Name must be 100 characters or less"),
  category: z.enum(["strength", "cardio", "flexibility"], {
    message: "Category must be strength, cardio, or flexibility",
  }),
  isCustom: z.boolean().default(true),
  bodyArea: z.enum(["upper_body", "lower_body", "core", "full_body", "cardio"]).optional(),
  muscleGroup: z.enum(["chest", "back", "shoulders", "biceps", "triceps", "forearms", "quads", "hamstrings", "glutes", "calves", "abs", "lower_back", "full_body", "cardio"]).optional(),
  equipment: z.enum(["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "bands", "other"]).optional(),
  movementPattern: z.enum(["push", "pull", "hinge", "squat", "carry", "rotation", "isometric", "cardio"]).optional(),
  exerciseType: z.enum(["compound", "accessory", "isolation", "plyometric", "isometric"]).optional(),
});

/**
 * Programs Schemas
 */
export const createProgramSchema = z.object({
  name: z.string().min(1).max(100),
});

export const updateProgramSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(100),
});

export const addExerciseToProgramSchema = z.object({
  programId: z.number().int().positive(),
  exerciseId: z.number().int().positive(),
  orderIndex: z.number().int().min(0).optional(),
  notes: z.string().max(500).optional(),
});

// Per-program override of an exercise's type. null clears the override (inherit
// the exercise's intrinsic type).
export const setProgramExerciseTypeSchema = z.object({
  programExerciseId: z.number().int().positive(),
  exerciseType: z
    .enum(["compound", "accessory", "isolation", "plyometric", "isometric"])
    .nullable(),
});

// How many qualifying sessions this exercise needs before a bump is suggested.
// null restores the shared REQUIRED_HITS default. The ceiling is the consensus
// window — asking for more hits than the window holds is unsatisfiable.
// The progression axes, written together. Every axis is optional so the sheet
// can send one control's change, and the action writes only what it is given —
// but they share a validator because they share a config stamp: any of them
// changes how history is judged, and the stamp is what stops the dot count
// moving under the lifter when they touch a setting (E-13).
export const setProgramExerciseProgressionSchema = z
  .object({
    programExerciseId: z.number().int().positive(),
    advance: z.enum(PROGRESSION_ADVANCES).optional(),
    scope: z.enum(PROGRESSION_SCOPES).optional(),
    requiredHits: z
      .number()
      .int()
      .min(MIN_REQUIRED_HITS)
      .max(MAX_REQUIRED_HITS)
      .nullable()
      .optional(),
    regress: z.enum(PROGRESSION_REGRESSES).optional(),
    backoffPct: z.number().int().min(MIN_BACKOFF_PCT).max(MAX_BACKOFF_PCT).optional(),
    backoffAfter: z
      .number()
      .int()
      .min(MIN_BACKOFF_AFTER)
      .max(MAX_BACKOFF_AFTER)
      .optional(),
    readiness: z.enum(PROGRESSION_READINESSES).optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 1,
    "At least one axis must be given",
  );

// Opt-in: accepted suggestions also rewrite the planned sets.
export const setProgramExerciseApplyToPlanSchema = z.object({
  programExerciseId: z.number().int().positive(),
  applyToPlan: z.boolean(),
});

// Batch-apply accepted suggestions to a slot's planned sets. Every entry must
// carry at least one value, otherwise it is a no-op row that would only widen
// the write surface.
export const applyProgressionToPlanSchema = z.object({
  programExerciseId: z.number().int().positive(),
  updates: z
    .array(
      z
        .object({
          programSetId: z.number().int().positive(),
          weightKg: z.number().min(0).max(1000).optional(),
          targetReps: z.number().int().min(0).max(1000).optional(),
          durationSeconds: z.number().int().min(0).max(86400).optional(),
          distanceMeters: z.number().int().min(0).max(1000000).optional(),
        })
        .refine(
          (u) =>
            u.weightKg !== undefined ||
            u.targetReps !== undefined ||
            u.durationSeconds !== undefined ||
            u.distanceMeters !== undefined,
          { message: "Each update needs at least one value" },
        ),
    )
    .min(1)
    .max(50),
});

export const SET_TYPES = ["working", "warmup"] as const;
export type SetType = (typeof SET_TYPES)[number];

/**
 * A rep range is both bounds or neither, and it has to contain the target.
 *
 * Half a range is not a weaker range, it is a set the engine cannot read: the
 * reset step needs a bottom to drop to and a top to climb to, and with one of
 * them missing double progression either never resets or never advances.
 * Applied to both the add and update schemas — the update path is the one a
 * preset picker will use, and it can arrive with one bound already stored.
 */
const repRangeIsWellFormed = <T extends {
  repRangeMin?: number | null;
  repRangeMax?: number | null;
  targetReps?: number | null;
}>(v: T) => {
  const { repRangeMin: min, repRangeMax: max } = v;
  if (min == null && max == null) return true;
  if (min == null || max == null) return false;
  if (min > max) return false;
  // The target is the prescription for today and lives inside the range, when
  // the same write carries it. A write that moves only the target against a
  // stored range is not checked here — the engine clamps to the range on every
  // advance, so an out-of-range target corrects itself on the next session.
  return v.targetReps == null || (v.targetReps >= min && v.targetReps <= max);
};

const REP_RANGE_MESSAGE =
  "A rep range needs both a minimum and a maximum, with min ≤ target ≤ max";

// The two per-set progression values the exercise sheet sets uniformly across
// a slot: the rep range double progression works inside, and the effort cap
// axis 3 gates on. Both live on program_sets because a top set and its
// back-offs can legitimately differ — SetEditView still edits them one set at
// a time — but picking a preset means one thing for the whole exercise, so the
// sheet writes every working set at once.
export const setProgramExerciseSetDefaultsSchema = z
  .object({
    programExerciseId: z.number().int().positive(),
    // Both null clears the range back to a fixed target. Half a range is not a
    // weaker range: the reset needs a bottom to drop to and a top to climb to.
    repRangeMin: z.number().int().positive().max(1000).nullable().optional(),
    repRangeMax: z.number().int().positive().max(1000).nullable().optional(),
    // Null clears the cap, which puts the exercise back on target-only clearing.
    targetRir: z.number().int().min(0).max(5).nullable().optional(),
  })
  .refine(
    (v) => (v.repRangeMin == null) === (v.repRangeMax == null),
    { message: REP_RANGE_MESSAGE, path: ["repRangeMin"] },
  )
  .refine(
    (v) => v.repRangeMin == null || v.repRangeMax == null || v.repRangeMin <= v.repRangeMax,
    { message: REP_RANGE_MESSAGE, path: ["repRangeMin"] },
  );

// The fields, unrefined. Both schemas below add the rep-range check
// themselves: zod refuses to `.omit()` from a schema that carries one, so the
// update schema has to derive from the plain object and re-apply it.
const programSetFields = z.object({
  programExerciseId: z.number().int().positive(),
  setNumber: z.number().int().positive(),
  targetReps: z.number().int().positive().optional(),
  // Double progression's range. Both null = a fixed target (E-5: reps only).
  repRangeMin: z.number().int().positive().max(1000).optional(),
  repRangeMax: z.number().int().positive().max(1000).optional(),
  weightKg: z.number().min(0).max(1000).optional(),
  durationSeconds: z.number().int().min(0).optional(),
  distanceMeters: z.number().int().min(0).optional(),
  inclinePercent: z.number().int().min(0).max(30).optional(),
  targetHeartRateZone: z.number().int().min(1).max(5).optional(),
  restTimeSeconds: z.number().int().min(0).max(3600).default(0),
  setType: z.enum(SET_TYPES).default("working"),
  // Prescribed reps-in-reserve cap (0–5). Guidance for the athlete when logging.
  targetRir: z.number().int().min(0).max(5).optional(),
  // Opt-in prep time before a timed set's countdown (UI presets cap at 30s;
  // anything longer is a rest period, not a start delay).
  startDelaySeconds: z.number().int().min(0).max(60).optional(),
});

export const addProgramSetSchema = programSetFields.refine(repRangeIsWellFormed, {
  message: REP_RANGE_MESSAGE,
  path: ["repRangeMin"],
});

export const updateProgramSetSchema = programSetFields
  .omit({ programExerciseId: true, setNumber: true })
  .extend({
    id: z.number().int().positive(),
    // No default — partial updates must not overwrite fields that weren't provided
    restTimeSeconds: z.number().int().min(0).max(3600).optional(),
    setType: z.enum(SET_TYPES).optional(),
    // Null clears the prescription (inherit nothing).
    targetRir: z.number().int().min(0).max(5).nullable().optional(),
    // Null clears the start delay.
    startDelaySeconds: z.number().int().min(0).max(60).nullable().optional(),
    // Allow explicit null to clear these fields (e.g., switching run mode from distance to time)
    distanceMeters: z.number().int().min(0).nullable().optional(),
    durationSeconds: z.number().int().min(0).nullable().optional(),
    // Periodization anchors — converted between distance/time when a periodized
    // endurance set's mode is switched. Null clears the anchor.
    peakDistanceMeters: z.number().int().min(0).nullable().optional(),
    peakDurationSeconds: z.number().int().min(0).nullable().optional(),
    // Null on either clears the range back to a fixed target.
    repRangeMin: z.number().int().positive().max(1000).nullable().optional(),
    repRangeMax: z.number().int().positive().max(1000).nullable().optional(),
  })
  .refine(repRangeIsWellFormed, { message: REP_RANGE_MESSAGE, path: ["repRangeMin"] });

export const removeExerciseFromProgramSchema = z.object({
  programExerciseId: z.number().int().positive(),
  programId: z.number().int().positive(),
});

export const reorderProgramExercisesSchema = z.object({
  programId: z.number().int().positive(),
  orderedIds: z.array(z.number().int().positive()).min(1),
});

export const reorderProgramSetsSchema = z.object({
  programExerciseId: z.number().int().positive(),
  orderedIds: z.array(z.number().int().positive()).min(1),
});

export const deleteProgramSetSchema = z.object({
  programSetId: z.number().int().positive(),
});

export type CreateProgramInput = z.infer<typeof createProgramSchema>;
export type AddExerciseToProgramInput = z.infer<
  typeof addExerciseToProgramSchema
>;
export type AddProgramSetInput = z.infer<typeof addProgramSetSchema>;

export type CreateExerciseInput = z.infer<typeof createExerciseSchema>;

/**
 * Program Import/Export Schemas
 */
const importProgramEntrySchema = z.object({
  name: z.string().min(1).max(100),
  exercises: z
      .array(
        z.object({
          idx: z.number().int().min(0),
          notes: z.string().max(500).nullable().optional(),
          incKg: z.number().min(0).max(100).catch(2.5),
          incReps: z.number().int().min(0).max(100).catch(0),
          mode: z
            .enum(["none", "manual", "weight", "smart", "reps", "time", "distance"])
            .catch("manual"),
          // Added after v1 payloads existed — absent means "use the defaults".
          hits: z
            .number()
            .int()
            .min(MIN_REQUIRED_HITS)
            .max(MAX_REQUIRED_HITS)
            .nullable()
            .optional()
            .catch(null),
          applyToPlan: z.boolean().optional().catch(false),
          exercise: z.object({
            name: z.string().min(1).max(100),
            category: z.enum(["strength", "cardio", "flexibility"]).catch("strength"),
            area: z
              .enum(["upper_body", "lower_body", "core", "full_body", "cardio"])
              .nullable()
              .optional()
              .catch(null),
            muscle: z
              .enum([
                "chest",
                "back",
                "shoulders",
                "biceps",
                "triceps",
                "forearms",
                "quads",
                "hamstrings",
                "glutes",
                "calves",
                "abs",
                "lower_back",
                "full_body",
                "cardio",
              ])
              .nullable()
              .optional()
              .catch(null),
            equipment: z
              .enum([
                "barbell",
                "dumbbell",
                "machine",
                "cable",
                "bodyweight",
                "kettlebell",
                "bands",
                "other",
              ])
              .nullable()
              .optional()
              .catch(null),
            pattern: z
              .enum([
                "push",
                "pull",
                "hinge",
                "squat",
                "carry",
                "rotation",
                "isometric",
                "cardio",
              ])
              .nullable()
              .optional()
              .catch(null),
            type: z
              .enum(["compound", "accessory", "isolation", "plyometric", "isometric"])
              .nullable()
              .optional()
              .catch(null),
          }),
          sets: z.array(
            z.object({
              n: z.number().int().min(0),
              reps: z.number().int().min(0).nullable().optional(),
              kg: z.number().min(0).max(1000).nullable().optional(),
              durSec: z.number().int().min(0).nullable().optional(),
              distM: z.number().int().min(0).nullable().optional(),
              rest: z.number().int().min(0).max(3600).catch(0),
              type: z.enum(SET_TYPES).catch("working"),
              rir: z.number().int().min(0).max(5).nullable().optional().catch(null),
              startDelay: z.number().int().min(0).max(60).nullable().optional().catch(null),
              // Optional, so an export made before rep ranges existed still
              // imports — the same both-shapes rule the logging payload follows.
              repMin: z.number().int().positive().max(1000).nullable().optional().catch(null),
              repMax: z.number().int().positive().max(1000).nullable().optional().catch(null),
            }),
          ),
        }),
      )
      .max(50),
});

// Accepts either a single program or an array of programs.
// version is optional to accommodate AI-generated JSON that may omit or vary the field.
export const importProgramSchema = z.object({
  version: z.union([z.number(), z.string()]).optional(),
  exportedAt: z.string().optional(),
}).and(
  z.union([
    z.object({ program: importProgramEntrySchema }),
    z.object({ programs: z.array(importProgramEntrySchema).min(1).max(100) }),
  ])
);

export type ImportProgramInput = z.infer<typeof importProgramSchema>;
