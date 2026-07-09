/**
 * Exercise Personal Records Table Schema
 *
 * Tracks personal records per exercise per user. When a new PR supersedes
 * an existing one, the old record is marked with superseded_at rather than
 * deleted — preserving the full PR history for future charts.
 *
 * PR types:
 *   weight       — heaviest single set ever logged for this exercise
 *   reps_at_weight — most reps ever at this exact weight (±0.5kg)
 *   estimated_1rm — highest Epley-estimated 1RM ever
 *   distance     — longest single endurance set (swim/bike/run); value = meters
 *   pace         — best pace within a distance bracket; value = duration seconds,
 *                  distance_meters = the effort's distance, bracket = bracket label.
 *                  Faster = lower (duration / distance); compare via that ratio.
 *
 * Query pattern:
 *   Current PR  → WHERE superseded_at IS NULL
 *   PR history  → ORDER BY achieved_at ASC (for trend curves)
 */

import { decimal, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { exercises } from "./exercises";
import { users } from "./users";
import { workoutSessions } from "./workout-sessions";
import { workoutSets } from "./workout-sets";

export const exercisePrs = pgTable("exercise_prs", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id")
    .notNull()
    .references(() => exercises.id, { onDelete: "cascade" }),
  // 'weight' | 'reps_at_weight' | 'estimated_1rm' | 'distance' | 'pace'
  prType: text("pr_type").notNull(),
  // The PR value: kg for weight/estimated_1rm, rep count for reps_at_weight,
  // meters for distance, duration seconds for pace.
  value: decimal("value", { precision: 8, scale: 2 }).notNull(),
  // Context: the weight used (populated for 'reps_at_weight' type)
  weightKg: decimal("weight_kg", { precision: 6, scale: 2 }),
  // Context for endurance PRs: the effort's distance in meters (populated for 'pace').
  distanceMeters: integer("distance_meters"),
  // Distance bracket label for 'pace' PRs (e.g. "5 km"); NULL for all others.
  bracket: text("bracket"),
  sessionId: integer("session_id").references(() => workoutSessions.id, {
    onDelete: "set null",
  }),
  setId: integer("set_id").references(() => workoutSets.id, {
    onDelete: "set null",
  }),
  achievedAt: timestamp("achieved_at").notNull().defaultNow(),
  // Set when a newer PR beats this one (NULL = current record)
  supersededAt: timestamp("superseded_at"),
}, (t) => [
  index("idx_pr_user_exercise_superseded").on(t.userId, t.exerciseId, t.supersededAt),
]);
