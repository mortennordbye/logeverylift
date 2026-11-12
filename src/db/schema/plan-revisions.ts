/**
 * Plan revisions (docs/plans/revisions.md, 2.1; decisions D2, T2, T3, T5).
 *
 * One row per change to a plan object, by any writer, with the whole object as
 * it stood after the change. A restore reads a snapshot back; the history and
 * the AI changes feed diff consecutive snapshots.
 */

import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const PLAN_OBJECT_TYPES = ["program", "cycle", "memory", "athlete", "threshold", "injury", "season"] as const;
export const PLAN_REVISION_ACTIONS = ["create", "update", "delete", "restore", "baseline", "conflict"] as const;
export const PLAN_WRITERS = ["user", "assistant", "progression", "sync", "apply"] as const;

export type PlanObjectType = (typeof PLAN_OBJECT_TYPES)[number];
export type PlanRevisionAction = (typeof PLAN_REVISION_ACTIONS)[number];
export type PlanWriter = (typeof PLAN_WRITERS)[number];

export const planRevisions = pgTable(
  "plan_revisions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // Text with a Drizzle enum, not a Postgres type, so a later package adds a
    // type (season, workout, threshold, memory) without ALTER TYPE.
    objectType: text("object_type", { enum: PLAN_OBJECT_TYPES }).notNull(),
    // No foreign key: a revision outlives its object until retention removes it.
    objectId: integer("object_id").notNull(),
    // The object's version after this revision.
    version: integer("version").notNull(),
    action: text("action", { enum: PLAN_REVISION_ACTIONS }).notNull(),
    writer: text("writer", { enum: PLAN_WRITERS }).notNull(),
    // Required for assistant writes; set by the app for automatic writers.
    reason: text("reason"),
    changeSetId: text("change_set_id"),
    // The OAuth client of an assistant revision.
    clientId: text("client_id"),
    restoredFromId: integer("restored_from_id").references((): AnyPgColumn => planRevisions.id, {
      onDelete: "set null",
    }),
    // The object after the change; for a delete, just before it; for a
    // conflict, as it stayed.
    snapshot: jsonb("snapshot").notNull(),
    // A conflict only: the write that was not applied.
    rejected: jsonb("rejected"),
    // An assistant write the training limits checked: what ran, what passed,
    // what the assistant went past on purpose and why (docs/plans/ai-coach.md, 2.4).
    limitCheck: jsonb("limit_check"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_plan_rev_object").on(t.userId, t.objectType, t.objectId, t.id),
    // Reads by object alone (the purge's newer-row check, restore lookups).
    index("idx_plan_rev_object_only").on(t.objectType, t.objectId, t.id),
    index("idx_plan_rev_writer").on(t.userId, t.writer, t.createdAt),
    index("idx_plan_rev_change_set").on(t.userId, t.changeSetId),
  ],
);
