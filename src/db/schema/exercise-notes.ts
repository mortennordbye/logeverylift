/**
 * Exercise Notes Schema
 *
 * A lifter's own note on an exercise ("left knee: no deeper than parallel"),
 * shown on the exercise page. One per user and exercise, for built-in
 * exercises too. Separate from program_exercises.notes, which is per program
 * slot and holds setup cues for that program.
 */

import { integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { exercises } from "./exercises";
import { users } from "./users";

export const exerciseNotes = pgTable(
  "exercise_notes",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    exerciseId: integer("exercise_id")
      .references(() => exercises.id, { onDelete: "cascade" })
      .notNull(),
    note: text("note").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("uniq_exercise_note_user_exercise").on(t.userId, t.exerciseId)],
);
