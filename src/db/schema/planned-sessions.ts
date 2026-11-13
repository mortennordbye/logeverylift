/**
 * Planned (dated) sessions (docs/plans/sessions.md, 3.2).
 *
 * A weekday cycle's template makes one row per planned session for the whole
 * block. A row can then be moved, skipped or changed on its own; a template
 * edit rewrites only untouched future rows (T7). "Done" and "missed" are never
 * stored: they are matched from completed workout sessions on read.
 *
 * Rotation cycles store no rows from the template: their dates follow the
 * walk. Only an override on a walk position (a skip or a changed program) is
 * stored, with `rotationPosition` set and `date` null.
 */

import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, date, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { garminActivities } from "./garmin";
import { programs } from "./programs";
import { SESSION_PRIORITIES, workouts } from "./workouts";
import { trainingCycles } from "./training-cycles";
import { users } from "./users";

// "missed": the user or the assistant confirmed a miss (docs/plans/workouts-and-compliance.md, 6.5).
export const PLANNED_SESSION_STATUSES = ["planned", "skipped", "missed"] as const;
export type PlannedSessionStatus = (typeof PLANNED_SESSION_STATUSES)[number];

export const plannedSessions = pgTable(
  "planned_sessions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    cycleId: integer("cycle_id")
      .references(() => trainingCycles.id, { onDelete: "cascade" })
      .notNull(),
    // The template slot it came from. No FK: a cycle restore deletes the slots
    // and inserts them again with their old ids, which a FK would cascade or
    // null. Null for a session added by hand.
    slotId: integer("slot_id"),
    // The date the template gave it; with slotId, the key regeneration matches on.
    templateDate: date("template_date"),
    // Rotation overrides only: the walk position (0-based) this row overrides.
    rotationPosition: integer("rotation_position"),
    // The planned date now. Null only on a rotation override.
    date: date("date"),
    // Order inside the day, 1 first.
    position: integer("position").notNull().default(1),
    programId: integer("program_id").references(() => programs.id, { onDelete: "set null" }),
    label: text("label"),
    notes: text("notes"),
    autoComplete: boolean("auto_complete").notNull().default(false),
    status: text("status", { enum: PLANNED_SESSION_STATUSES }).notNull().default("planned"),
    skipReason: text("skip_reason"),
    // Set by any user or assistant change. Null = untouched: a template edit may rewrite it.
    touchedAt: timestamp("touched_at"),
    // Structured endurance workouts (docs/plans/workouts-and-compliance.md, 4.2).
    // This session's own copy of a workout; null for a program session. A
    // session runs a program or a workout, never both.
    workout: jsonb("workout"),
    // The library workout it was copied from; not read for content.
    workoutId: integer("workout_id").references(() => workouts.id, { onDelete: "set null" }),
    // key, support or optional; null = derived.
    priority: text("priority", { enum: SESSION_PRIORITIES }),
    // The session this one follows in a brick (the ride before the run).
    brickParentId: integer("brick_parent_id").references((): AnyPgColumn => plannedSessions.id, { onDelete: "set null" }),
    // A Garmin activity the user or the assistant picked as this session (admins).
    garminActivityId: integer("garmin_activity_id").references(() => garminActivities.id, { onDelete: "set null" }),
    // Free text with a confirmed miss.
    missedReason: text("missed_reason"),
    // The user's date when the status last became skipped or missed: a skip
    // before the session's day is a plan change, not a miss.
    statusOn: date("status_on"),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_ps_user_date").on(t.userId, t.date),
    index("idx_ps_cycle_date").on(t.cycleId, t.date),
    uniqueIndex("uniq_ps_template")
      .on(t.cycleId, t.slotId, t.templateDate)
      .where(sql`${t.deletedAt} IS NULL AND ${t.templateDate} IS NOT NULL`),
    check("ps_program_or_workout", sql`${t.programId} IS NULL OR ${t.workout} IS NULL`),
    uniqueIndex("uniq_ps_rotation")
      .on(t.cycleId, t.rotationPosition)
      .where(sql`${t.deletedAt} IS NULL AND ${t.rotationPosition} IS NOT NULL`),
  ],
);
