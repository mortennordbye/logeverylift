/**
 * The workout library (docs/plans/workouts-and-compliance.md, 4.1): reusable
 * structured endurance workouts. The `workout` JSON is valid by the schema in
 * src/lib/utils/workout-steps.ts; `name` and `sport` are copied out of it for
 * lists. A planned session gets its own copy of a workout, never a reference,
 * so editing a library entry never changes a past session.
 */

import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const WORKOUT_SPORT_VALUES = ["swim", "bike", "run"] as const;
export const SESSION_PRIORITIES = ["key", "support", "optional"] as const;
export type SessionPriority = (typeof SESSION_PRIORITIES)[number];

export const workouts = pgTable(
  "workouts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    sport: text("sport", { enum: WORKOUT_SPORT_VALUES }).notNull(),
    workout: jsonb("workout").notNull(),
    // The default priority of sessions made from it; null = derived.
    priority: text("priority", { enum: SESSION_PRIORITIES }),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("idx_workouts_user_sport").on(t.userId, t.sport)],
);
