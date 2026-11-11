/**
 * Garmin Schema
 *
 * A user's own Garmin Connect data, read with the Garmin Personal API key the
 * user pastes in Settings. The Progress page's Garmin tab reads Garmin live
 * and saves each response here, so older days stay visible and each sync can
 * be looked at afterwards.
 *
 * - garmin_connections: the key, encrypted (src/lib/utils/crypto.ts). One per user.
 * - garmin_days: one row per user, calendar date and kind, holding Garmin's
 *   JSON for that day as returned ("hrv", "sleep", "daily" summary).
 * - garmin_activities: one row per Garmin activity, its summary JSON with the
 *   GPS fields removed (stripActivityLocation in src/lib/garmin/metrics.ts).
 * - garmin_sync_runs: one row per sync, for observability. Only the latest
 *   50 per user are kept.
 */

import { bigint, date, index, integer, jsonb, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { users } from "./users";

export const garminConnections = pgTable("garmin_connections", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  encryptedKey: text("encrypted_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSyncedAt: timestamp("last_synced_at"),
});

export const garminDays = pgTable(
  "garmin_days",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    calendarDate: date("calendar_date").notNull(),
    kind: text("kind", { enum: ["hrv", "sleep", "daily"] }).notNull(),
    data: jsonb("data").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (t) => [unique("uniq_garmin_day").on(t.userId, t.calendarDate, t.kind)],
);

export const garminActivities = pgTable(
  "garmin_activities",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    garminActivityId: bigint("garmin_activity_id", { mode: "number" }).notNull(),
    startTimeLocal: timestamp("start_time_local").notNull(),
    activityType: text("activity_type").notNull(),
    data: jsonb("data").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (t) => [
    unique("uniq_garmin_activity").on(t.userId, t.garminActivityId),
    index("idx_garmin_activities_user_start").on(t.userId, t.startTimeLocal),
  ],
);

export const garminSyncRuns = pgTable(
  "garmin_sync_runs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    rangeStart: date("range_start").notNull(),
    rangeEnd: date("range_end").notNull(),
    status: text("status", { enum: ["running", "ok", "error"] }).notNull(),
    // Rows written per kind, e.g. { hrv: 9, sleep: 9, daily: 9, activities: 7 }.
    counts: jsonb("counts"),
    // A short tag ("key_rejected", "http_500:sleep"), never a response body.
    error: text("error"),
    durationMs: integer("duration_ms"),
  },
  (t) => [index("idx_garmin_sync_runs_user").on(t.userId, t.startedAt)],
);
