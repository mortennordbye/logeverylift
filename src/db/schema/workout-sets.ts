/**
 * Workout Sets Table Schema
 *
 * Represents individual sets within a workout session. This is the core data
 * structure for tracking workout performance.
 *
 * Fields:
 * - set_number: Order within the exercise (1, 2, 3, etc.)
 * - target_reps: The planned number of reps (optional, for following programs)
 * - actual_reps: The reps actually completed
 * - weight_kg: Load lifted (use decimal for fractional plates like 2.5kg)
 * - rir: Reps In Reserve — the primary effort input the user logs (0 = to failure,
 *        5 = 5+ reps left). When set, rpe is derived as clamp(10 - rir, 1, 10).
 * - rpe: Rate of Perceived Exertion (1-10 scale, where 10 = absolute max effort).
 *        Derived from rir when rir is provided; kept for legacy rows and downstream logic.
 * - rest_time_seconds: Rest period after this set
 * - is_completed: Whether the set was finished or skipped
 *
 * RIR ↔ RPE mapping (rpe = 10 - rir):
 * - RIR 0 → RPE 10: Maximum effort, no reps left in reserve
 * - RIR 1 → RPE 9: Could do 1 more rep
 * - RIR 2 → RPE 8: Could do 2 more reps
 * - RIR 3 → RPE 7: Moderate effort, a few reps left
 * - RIR 5+ → RPE ≤5: Comfortable, many reps in reserve
 *
 * Future enhancements for Auto-Deload & PR Detection:
 * - Track RPE trends: If RPE consistently > 9 for same weight, trigger deload
 * - Compare weight × reps to historical maxes for PR detection
 * - Add tempo column (e.g., "3-1-1" for 3s eccentric, 1s pause, 1s concentric)
 * - Add failure_point (sticking point in the rep)
 * - Add estimated_1rm (calculated using Epley or Brzycki formulas)
 */

import {
    boolean,
    decimal,
    index,
    integer,
    pgTable,
    serial,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { exercises } from "./exercises";
import { workoutSessions } from "./workout-sessions";

export const workoutSets = pgTable("workout_sets", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .references(() => workoutSessions.id, { onDelete: "cascade" })
    .notNull(),
  exerciseId: integer("exercise_id")
    .references(() => exercises.id, { onDelete: "cascade" })
    .notNull(),
  setNumber: integer("set_number").notNull(),
  targetReps: integer("target_reps"),
  actualReps: integer("actual_reps").notNull(),
  weightKg: decimal("weight_kg", { precision: 6, scale: 2 }).notNull(),
  durationSeconds: integer("duration_seconds"),
  distanceMeters: integer("distance_meters"),
  inclinePercent: integer("incline_percent"),
  heartRateZone: integer("heart_rate_zone"), // 1-5
  // Reps In Reserve (0 = to failure, 5 = 5+). Primary user-logged effort signal;
  // rpe is derived from it. Nullable for legacy rows logged before RIR existed.
  rir: integer("rir"),
  rpe: integer("rpe").notNull(), // 1-10 scale (derived from rir when present)
  restTimeSeconds: integer("rest_time_seconds").notNull(),
  // Free-text per-set note: "left shoulder twinged", "added belt", "felt easy"
  notes: text("notes"),
  isCompleted: boolean("is_completed").default(true).notNull(),
  // Set was attempted but the target reps weren't reached (an explicit failure,
  // distinct from actualReps < targetReps which can also mean a planned back-off).
  isFailed: boolean("is_failed").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_wsets_session").on(t.sessionId),
  // Prevents double-logging the same set (e.g., rapid double-tap on the
  // "complete" button). One row per (session, exercise, setNumber).
  uniqueIndex("uniq_wsets_session_exercise_set").on(t.sessionId, t.exerciseId, t.setNumber),
]);
