import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const aiGenerations = pgTable(
  "ai_generations",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_ai_generations_user_created").on(t.userId, t.createdAt)],
);

export type AiGeneration = typeof aiGenerations.$inferSelect;
