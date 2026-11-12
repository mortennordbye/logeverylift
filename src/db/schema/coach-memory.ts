/**
 * Coach memory (docs/plans/ai-coach.md, 2.5; decision T10).
 *
 * Free-text context the user's connected assistant needs between
 * conversations: preferences, life limits, observations and decisions. Facts
 * with a home of their own (race, thresholds, injuries, availability, strength
 * goal) belong there once those tables exist (package C3). Written by the user
 * in the app and by the assistant over MCP, both through the revision layer
 * (object type `memory`), so every change can be seen and undone.
 *
 * Health-adjacent free text: covered like workout notes in
 * docs/privacy/data-inventory.md. Never shown to friends, never sent to the
 * in-app AI.
 */

import { boolean, date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const COACH_MEMORY_KINDS = ["preference", "limit", "observation", "decision"] as const;
export type CoachMemoryKind = (typeof COACH_MEMORY_KINDS)[number];

export const coachMemory = pgTable(
  "coach_memory",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // `limit` is a life limit (time, travel, equipment), not a training limit.
    kind: text("kind", { enum: COACH_MEMORY_KINDS }).notNull(),
    text: text("text").notNull(),
    // The day the entry is about or was made, in the user's time zone.
    entryDate: date("entry_date").notNull(),
    // Inactive entries are kept, but the assistant does not see them by default.
    active: boolean("active").default(true).notNull(),
    // Soft delete and version, as on programs (docs/plans/revisions.md, 2.1).
    deletedAt: timestamp("deleted_at"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("idx_coach_memory_user").on(t.userId, t.active)],
);
