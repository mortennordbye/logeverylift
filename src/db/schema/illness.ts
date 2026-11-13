/**
 * Sick periods (docs/plans/workouts-and-compliance.md, 4.4; decision D20).
 * One row per period: "sick from X to Y", or from X with no end yet. Planned
 * sessions inside a period read as missed by illness; nothing is stored on
 * the sessions. Health data (Art. 9): never shown to friends.
 */

import { date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/** IOC 2022 severity grades (docs/research/endurance-training-reference.md). */
export const ILLNESS_SEVERITIES = ["mild", "moderate", "severe"] as const;

export const illnessPeriods = pgTable(
  "illness_periods",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    startedOn: date("started_on").notNull(),
    // Last sick day; null while still sick.
    endedOn: date("ended_on"),
    severity: text("severity", { enum: ILLNESS_SEVERITIES }),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("idx_illness_user_start").on(t.userId, t.startedOn)],
);
