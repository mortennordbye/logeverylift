import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const nudges = pgTable(
  "nudges",
  {
    id: serial("id").primaryKey(),
    fromUserId: text("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: text("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("nudges_to_user_idx").on(t.toUserId)],
);
