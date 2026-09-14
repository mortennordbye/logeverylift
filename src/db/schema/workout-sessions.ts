/**
 * Workout Sessions Table Schema
 *
 * Represents a complete workout session. Each session can contain multiple sets
 * across different exercises.
 *
 * The is_completed flag helps distinguish:
 * - Active/ongoing workouts (false)
 * - Completed workouts (true)
 *
 * Timestamps:
 * - date: The calendar day of the workout
 * - start_time: When the user began the workout
 * - end_time: When the user finished (null if still in progress)
 *
 * Future enhancements:
 * - Add workout_template_id (for following pre-built programs)
 * - Add total_volume_kg (calculated: sum of all set weight × reps)
 * - Add duration_minutes (calculated: end_time - start_time)
 * - Add location (home, gym, outdoor)
 * - Add mood/energy_level (pre and post workout)
 */

import {
    boolean,
    date,
    index,
    integer,
    pgEnum,
    pgTable,
    serial,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { programs } from "./programs";
import { users } from "./users";

export const workoutFeelingEnum = pgEnum("workout_feeling", [
  "Tired",
  "OK",
  "Good",
  "Awesome",
]);

export const workoutSessions = pgTable("workout_sessions", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  programId: integer("program_id").references(() => programs.id, { onDelete: "set null" }),
  date: date("date").notNull(),
  startTime: timestamp("start_time").defaultNow().notNull(),
  endTime: timestamp("end_time"),
  notes: text("notes"),
  feeling: workoutFeelingEnum("feeling"),
  isCompleted: boolean("is_completed").default(false).notNull(),
  // Pre-workout readiness score (1=Drained → 5=Excellent), captured at session start.
  // Null for sessions created before this feature was added.
  readiness: integer("readiness"),
  // The cycle day this session is making up for, when started via a "Make up"
  // prompt. Null for normal sessions. Lets the missed-workout logic treat a
  // make-up logged today as satisfying the original missed day.
  intendedDate: date("intended_date"),
  // "auto" = written by the app for a cycle day marked autoComplete (tracked
  // outside the app). Such a session has no sets and zero duration.
  source: text("source", { enum: ["app", "auto"] }).default("app").notNull(),
}, (t) => [
  index("idx_ws_user_completed_start").on(t.userId, t.isCompleted, t.startTime),
  // At most one auto session per program per day, so concurrent renders of
  // getActiveCycleForUser can't double-insert.
  uniqueIndex("uniq_ws_auto_day")
    .on(t.userId, t.programId, t.date)
    .where(sql`${t.source} = 'auto'`),
]);
