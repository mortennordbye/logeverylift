/**
 * AI Setup Plans Schema
 *
 * One row per plan imported from AI Setup's picks: what it was built from,
 * which cycle it became, and the one-week check-in ("does it fit?") the home
 * page asks once that cycle has run for seven days. A revised plan made from
 * a check-in points back at the row it revises and gets its own check-in.
 */

import { index, integer, jsonb, pgTable, serial, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { trainingCycles } from "./training-cycles";
import { users } from "./users";

export const aiSetupPlans = pgTable(
  "ai_setup_plans",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    cycleId: integer("cycle_id").references(() => trainingCycles.id, { onDelete: "set null" }),
    // The TemplateParams the plan was built from.
    picks: jsonb("picks").notNull(),
    // The AI edit request ({ chips, text }) applied before import, if any.
    edit: jsonb("edit"),
    revisionOf: integer("revision_of").references((): AnyPgColumn => aiSetupPlans.id, { onDelete: "set null" }),
    checkinStatus: text("checkin_status", { enum: ["pending", "fits", "does_not_fit", "dismissed"] })
      .default("pending")
      .notNull(),
    checkinIssues: jsonb("checkin_issues"),
    checkinNote: text("checkin_note"),
    checkinAnsweredAt: timestamp("checkin_answered_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_ai_setup_plans_user").on(t.userId)],
);

export type AiSetupPlan = typeof aiSetupPlans.$inferSelect;
