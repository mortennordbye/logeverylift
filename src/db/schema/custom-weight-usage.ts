/**
 * Custom Weight Usage Table Schema
 *
 * One row per saved set whose weight was typed in manually instead of picked
 * from the weight presets (0 kg plus 2.5 kg steps). The point is to find where
 * the presets are wrong: an exercise that keeps getting 18 kg typed in is an
 * exercise whose preset ladder should offer 18 kg.
 *
 * Read from the admin Insights page.
 */

import { integer, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";
import { exercises } from "./exercises";
import { users } from "./users";

export const customWeightUsage = pgTable("custom_weight_usage", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id")
    .notNull()
    .references(() => exercises.id, { onDelete: "cascade" }),
  weightKg: real("weight_kg").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
