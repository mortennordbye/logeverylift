/**
 * Garmin Schema
 *
 * A user's own Garmin Connect data, read with the Garmin Personal API key the
 * user pastes in Settings. Opening the Garmin page reads recent data
 * live, and a background worker imports history and activity files; every
 * response is saved here, so older days stay visible and each sync can be
 * looked at afterwards.
 *
 * - garmin_connections: the key, encrypted (src/lib/utils/crypto.ts). One per user.
 * - garmin_days: one row per user, calendar date and kind, holding Garmin's
 *   JSON for that day as returned. Kinds are the endpoints in
 *   src/lib/garmin/endpoints.ts (GARMIN_DAY_KINDS).
 * - garmin_activities: one row per Garmin activity: the list summary (GPS
 *   fields removed by stripActivityLocation in src/lib/garmin/location.ts),
 *   the detail and the planned workout.
 * - garmin_activity_files: the activity's original FIT file, as Garmin's ZIP.
 * - garmin_activity_streams: that FIT file parsed (src/lib/garmin/fit.ts):
 *   per-second streams including GPS, laps, strength sets, time in zones.
 * - garmin_activity_metrics, garmin_daily_metrics: what src/lib/garmin/analytics
 *   derives from the rows above, filled by the worker. Safe to drop and rebuild.
 * - garmin_sync_runs: one row per sync or worker run, for observability.
 *   Only the latest 200 per user are kept.
 * - garmin_fuel_logs: carbohydrate and fluid the user logged for a session.
 */

import { bigint, boolean, customType, date, index, integer, jsonb, pgTable, real, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { GARMIN_DAY_KINDS } from "../../lib/garmin/endpoints";
import { users } from "./users";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const garminConnections = pgTable("garmin_connections", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  encryptedKey: text("encrypted_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSyncedAt: timestamp("last_synced_at"),
  // Background import (src/lib/garmin/worker.ts). historyCursor is the oldest
  // date whose per-day data is imported; null until the first day is done.
  historyCursor: date("history_cursor"),
  historyDone: boolean("history_done").default(false).notNull(),
  // History chunks in a row that had no data; an admin's import stops after a run of these.
  historyEmptyChunks: integer("history_empty_chunks").default(0).notNull(),
  // Last time today's and yesterday's per-day data was fetched again.
  recentDetailAt: timestamp("recent_detail_at"),
  // A worker holds the connection until this time, so two app replicas never import the same user at once.
  leaseUntil: timestamp("lease_until"),
  // Garmin said "slow down" (429): no calls for this user before this time.
  pausedUntil: timestamp("paused_until"),
  // Derived metrics (src/lib/garmin/analytics): when the daily series was last
  // built, and its model version. Cleared to null to force a rebuild.
  metricsComputedAt: timestamp("metrics_computed_at"),
  metricsVersion: integer("metrics_version"),
  // Opt-in: copy Garmin weigh-ins into the profile's weight history (src/lib/garmin/weight-sync.ts).
  syncWeight: boolean("sync_weight").default(false).notNull(),
});

export const garminDays = pgTable(
  "garmin_days",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    calendarDate: date("calendar_date").notNull(),
    kind: text("kind", { enum: GARMIN_DAY_KINDS }).notNull(),
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
    // From /activity-service/activity/{id} and .../workouts; null until fetched.
    detail: jsonb("detail"),
    workouts: jsonb("workouts"),
    // When detail, workouts and the FIT file were fetched. Null = still to do.
    filesFetchedAt: timestamp("files_fetched_at"),
    // Short tag when that failed ("http_404:fit"); the worker skips it after that.
    filesError: text("files_error"),
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
    // What started it: the tab or connect (recent data), or the background worker (history, files).
    trigger: text("trigger", { enum: ["sync", "worker"] }).default("sync").notNull(),
    // Rows written per kind, e.g. { hrv: 9, sleep: 9, daily: 9, activities: 7 }.
    counts: jsonb("counts"),
    // A short tag ("key_rejected", "http_500:sleep"), never a response body.
    error: text("error"),
    durationMs: integer("duration_ms"),
  },
  (t) => [index("idx_garmin_sync_runs_user").on(t.userId, t.startedAt)],
);

export const garminActivityFiles = pgTable(
  "garmin_activity_files",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    garminActivityId: bigint("garmin_activity_id", { mode: "number" }).notNull(),
    // Garmin's download as is: a ZIP holding the .fit file.
    zip: bytea("zip").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (t) => [unique("uniq_garmin_activity_file").on(t.userId, t.garminActivityId)],
);

export const garminActivityStreams = pgTable(
  "garmin_activity_streams",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    garminActivityId: bigint("garmin_activity_id", { mode: "number" }).notNull(),
    parserVersion: integer("parser_version").notNull(),
    sport: text("sport"),
    subSport: text("sub_sport"),
    // { t: seconds from start, hr, power, cadence, speed, altitude, distance, lat, lng, ... }, aligned by index.
    streams: jsonb("streams").notNull(),
    laps: jsonb("laps").notNull(),
    sets: jsonb("sets").notNull(),
    timeInZone: jsonb("time_in_zone").notNull(),
    session: jsonb("session"),
    // Parser v2: pool lengths (swim) and timer events (pauses). Null for rows parsed by v1.
    lengths: jsonb("lengths"),
    events: jsonb("events"),
    parsedAt: timestamp("parsed_at").defaultNow().notNull(),
  },
  (t) => [unique("uniq_garmin_activity_stream").on(t.userId, t.garminActivityId)],
);

/** Derived metrics per activity (src/lib/garmin/analytics/activity.ts), recomputed when the model version changes. */
export const garminActivityMetrics = pgTable(
  "garmin_activity_metrics",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    garminActivityId: bigint("garmin_activity_id", { mode: "number" }).notNull(),
    modelVersion: integer("model_version").notNull(),
    // Also kept as columns so the daily build reads them without parsing JSON.
    sport: text("sport").notNull(),
    day: date("day").notNull(),
    load: real("load"),
    loadMethod: text("load_method").notNull(),
    // ActivityMetrics: thresholds, bands, NP, IF, start and end.
    metrics: jsonb("metrics").notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (t) => [
    unique("uniq_garmin_activity_metrics").on(t.userId, t.garminActivityId),
    index("idx_garmin_activity_metrics_user_day").on(t.userId, t.day),
  ],
);

/** The daily series (src/lib/garmin/analytics/daily.ts): load, fitness and form, HRV, resting HR, sleep. */
export const garminDailyMetrics = pgTable(
  "garmin_daily_metrics",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    day: date("day").notNull(),
    modelVersion: integer("model_version").notNull(),
    metrics: jsonb("metrics").notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (t) => [unique("uniq_garmin_daily_metrics").on(t.userId, t.day)],
);

/**
 * What the user took in during a long session: carbohydrate and fluid, typed
 * on the activity page. With Garmin's sweat estimate it gives the race page's
 * fluid plan. Health data (nutrition); deleted with the Garmin data.
 */
export const garminFuelLogs = pgTable(
  "garmin_fuel_logs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    garminActivityId: bigint("garmin_activity_id", { mode: "number" }).notNull(),
    carbsG: integer("carbs_g"),
    fluidMl: integer("fluid_ml"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("uniq_garmin_fuel_log").on(t.userId, t.garminActivityId)],
);
