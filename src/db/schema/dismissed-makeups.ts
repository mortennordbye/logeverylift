/**
 * Dismissed Make-ups Schema
 *
 * Records missed-workout days the user explicitly declined ("Decline" next to
 * "Make up" on the home screen). A dismissed day is filtered out of the
 * "Missed this week" list so it stops nagging. Keyed by the original scheduled
 * date of the missed slot.
 */

import { date, index, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { users } from "./users";

export const dismissedMakeups = pgTable(
  "dismissed_makeups",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // The original scheduled date of the missed slot the user declined.
    date: date("date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    unique("uniq_dismissed_makeup").on(t.userId, t.date),
    index("idx_dismissed_makeup_user").on(t.userId),
  ],
);
