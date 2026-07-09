/**
 * Programs Schema
 *
 * A "program" is a named workout template that lists exercises and their
 * planned sets (reps, weight, rest). Users can select a program when
 * starting a workout.
 *
 * Tables:
 *  programs            – the named collection (e.g. "Push 1", "Legs 1")
 *  program_exercises   – ordered exercise slots inside a program
 *  program_sets        – individual set blueprints for each exercise slot
 */

import {
    decimal,
    integer,
    pgTable,
    serial,
    text,
    timestamp,
} from "drizzle-orm/pg-core";
import { exerciseTypeEnum, exercises } from "./exercises";
import { trainingCycles } from "./training-cycles";
import { users } from "./users";

// -------------------------------------------------------------------
// programs
// -------------------------------------------------------------------
export const programs = pgTable("programs", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  // Set when a cycle generator (e.g. the triathlon plan) creates this program
  // for a specific cycle. Cascades on cycle delete so generated programs are
  // cleaned up instead of cluttering the Programs list. Null for standalone
  // programs the user built themselves — those are never auto-deleted.
  createdByCycleId: integer("created_by_cycle_id").references(
    () => trainingCycles.id,
    { onDelete: "cascade" },
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// -------------------------------------------------------------------
// program_exercises  (ordered exercise slots within a program)
// -------------------------------------------------------------------
export const programExercises = pgTable("program_exercises", {
  id: serial("id").primaryKey(),
  programId: integer("program_id")
    .references(() => programs.id, { onDelete: "cascade" })
    .notNull(),
  exerciseId: integer("exercise_id")
    .references(() => exercises.id, { onDelete: "cascade" })
    .notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  notes: text("notes"),
  overloadIncrementKg: decimal("overload_increment_kg", { precision: 4, scale: 2 }),
  overloadIncrementReps: integer("overload_increment_reps").default(0),
  // "none" | "manual" | "weight" | "smart" | "reps" | "time" | "distance"
  progressionMode: text("progression_mode").default("manual"),
  // Per-program override of the exercise's intrinsic type — e.g. a compound
  // bench press used as accessory work in this program. Null = inherit the
  // exercise's default (resolved type = this ?? exercise.exerciseType).
  exerciseType: text("exercise_type", { enum: exerciseTypeEnum }),
});

// -------------------------------------------------------------------
// program_sets  (planned set blueprint for an exercise slot)
// -------------------------------------------------------------------
export const programSets = pgTable("program_sets", {
  id: serial("id").primaryKey(),
  programExerciseId: integer("program_exercise_id")
    .references(() => programExercises.id, { onDelete: "cascade" })
    .notNull(),
  setNumber: integer("set_number").notNull(),
  // For rep-based sets
  targetReps: integer("target_reps"),
  weightKg: decimal("weight_kg", { precision: 6, scale: 2 }),
  // For time-based sets (seconds)
  durationSeconds: integer("duration_seconds"),
  // Opt-in prep time (seconds) before a timed set's countdown starts (e.g. getting
  // into a handstand). Null = no delay. Never included in the logged work duration.
  startDelaySeconds: integer("start_delay_seconds"),
  // For running/cardio sets (meters)
  distanceMeters: integer("distance_meters"),
  // Periodized endurance: the peak (race-prep) distance this set ramps toward.
  // Null = not periodized. The active cycle scales distanceMeters from this each week.
  peakDistanceMeters: integer("peak_distance_meters"),
  // Periodized endurance (time mode): the peak (race-prep) duration this set ramps
  // toward, in seconds. Null = duration not periodized. Set when a periodized set is
  // switched to Time mode; the active cycle scales durationSeconds from this each week.
  peakDurationSeconds: integer("peak_duration_seconds"),
  // For running: treadmill incline (whole percent, 0-30)
  inclinePercent: integer("incline_percent"),
  // For running: target heart rate zone (1-5)
  targetHeartRateZone: integer("target_heart_rate_zone"),
  // Rest after this set (seconds)
  restTimeSeconds: integer("rest_time_seconds").notNull().default(0),
  // "working" | "warmup" — non-working sets are excluded from progression suggestions.
  setType: text("set_type").notNull().default("working"),
  // Prescribed Reps In Reserve for this set (the intensity cap, e.g. 2 = "stop with
  // ~2 reps left"). Guidance shown when logging; the athlete logs actual RIR separately.
  // For a range like "2–3 RIR" we store the stricter floor (2). Null = no prescription.
  targetRir: integer("target_rir"),
  // Structural role for phase-aware periodization. "work" = a hard interval rep
  // whose zone/rest the active cycle swaps by phase (base→tempo, build→threshold,
  // peak→VO₂). Null = a steady/warmup/cooldown set that only volume-scales.
  sessionRole: text("session_role"),
});
