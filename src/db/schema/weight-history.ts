import { pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const userWeightEntries = pgTable("user_weight_entry", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  weightKg: real("weight_kg").notNull(),
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});
