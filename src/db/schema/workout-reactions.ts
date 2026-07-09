import { integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { users } from "./users";
import { workoutSessions } from "./workout-sessions";

export const workoutReactions = pgTable(
  "workout_reactions",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => workoutSessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(), // "🔥" | "💪" | "👏"
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique().on(t.sessionId, t.userId, t.emoji)],
);
