import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<"bug" | "feature" | "other">().notNull().default("bug"),
  message: text("message").notNull(),
  status: text("status").$type<"new" | "read">().notNull().default("new"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Feedback = typeof feedback.$inferSelect;
