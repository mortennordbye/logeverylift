/**
 * Per-step results of a structured endurance session
 * (docs/plans/endurance-app.md, 5.1). One row per logged session that has
 * them: from the guided player, entered by hand, or written by the assistant.
 *
 * Logged data, like workout_sets: no revisions. The planned values are not
 * copied; they come from `workout` and `anchors` on read, so a later edit of
 * the plan or a retest does not change what was planned for this session.
 */

import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { plannedSessions } from "./planned-sessions";
import { users } from "./users";
import { workoutSessions } from "./workout-sessions";

export const STEP_RESULT_SOURCES = ["player", "manual", "assistant"] as const;

export const workoutStepResults = pgTable(
  "workout_step_results",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    workoutSessionId: integer("workout_session_id")
      .references(() => workoutSessions.id, { onDelete: "cascade" })
      .notNull(),
    plannedSessionId: integer("planned_session_id").references(() => plannedSessions.id, { onDelete: "set null" }),
    source: text("source", { enum: STEP_RESULT_SOURCES }).notNull(),
    // Idempotency key of a player save, so a retry never writes twice.
    clientKey: text("client_key"),
    // The workout as run (C4 schema, ids filled).
    workout: jsonb("workout").notNull(),
    // Threshold values (metric) the targets were resolved with.
    anchors: jsonb("anchors").notNull(),
    // StepResult[] (src/lib/utils/step-results.ts).
    steps: jsonb("steps").notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    pausedSeconds: integer("paused_seconds").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uniq_wsr_session").on(t.workoutSessionId),
    uniqueIndex("uniq_wsr_client_key").on(t.userId, t.clientKey).where(sql`${t.clientKey} IS NOT NULL`),
    index("idx_wsr_user_planned").on(t.userId, t.plannedSessionId),
  ],
);
