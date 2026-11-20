/**
 * Bike rides in ride mode (docs/plans/bike-ride-logger.md, 4.3).
 *
 * A ride holds a frozen copy of its plan and the list of what the rider did
 * (start, pause, skip and so on). The clock, the step boundaries and the saved
 * steps are all worked out from the two by `rideTimeline`
 * (src/lib/utils/ride-timeline.ts). `status`, `seq` and `endedAt` are kept on
 * the ride so one query finds the user's active ride.
 */

import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { programExercises } from "./programs";
import { users } from "./users";
import { workoutSessions } from "./workout-sessions";

export const RIDE_MODES = ["indoor", "outdoor"] as const;
export type RideMode = (typeof RIDE_MODES)[number];
export const RIDE_STATUSES = ["ready", "running", "paused", "finished", "ended_early"] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];
// belt and incline are run only (docs/plans/run-logger.md, 4.4): absolute values in tenths.
export const RIDE_EVENT_KINDS = ["start", "pause", "resume", "skip", "unskip", "extend", "nudge", "lap", "end", "belt", "incline"] as const;
export type RideEventKind = (typeof RIDE_EVENT_KINDS)[number];
/** The sport of a ride: a bike ride or a run (docs/plans/run-logger.md, R10). */
export const RIDE_SPORTS = ["bike", "run"] as const;
export type RideSport = (typeof RIDE_SPORTS)[number];
/** An outdoor run's surface (R14): on trail or snow, pace targets show as heart rate or effort. */
export const RUN_SURFACES = ["road", "trail"] as const;
export type RunSurface = (typeof RUN_SURFACES)[number];
/** Why a run ended early (R15), when the runner says. */
export const END_REASONS = ["tired", "pain", "time", "other"] as const;
export type EndReason = (typeof END_REASONS)[number];

export const rides = pgTable(
  "rides",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // The workout session the steps are logged to.
    sessionId: integer("session_id")
      .references(() => workoutSessions.id, { onDelete: "cascade" })
      .notNull(),
    programExerciseId: integer("program_exercise_id").references(() => programExercises.id, { onDelete: "set null" }),
    // A run shows "indoor" as Treadmill (docs/plans/run-logger.md, R3).
    mode: text("mode", { enum: RIDE_MODES }).notNull(),
    sport: text("sport", { enum: RIDE_SPORTS }).notNull().default("bike"),
    // The run of a brick: the ride it follows, from the planned brick pair (4.7).
    brickRideId: integer("brick_ride_id").references((): AnyPgColumn => rides.id, { onDelete: "set null" }),
    // An outdoor run's surface; null on a ride and on a treadmill run.
    surface: text("surface", { enum: RUN_SURFACES }),
    // The reason the runner gave for ending early; null when none was given.
    endReason: text("end_reason", { enum: END_REASONS }),
    status: text("status", { enum: RIDE_STATUSES }).notNull(),
    // The plan as it was at start (a RidePlan): later program or FTP changes do not touch it.
    plan: jsonb("plan").notNull(),
    // The sequence number of the last event.
    seq: integer("seq").notNull().default(0),
    startedAt: timestamp("started_at").notNull(),
    endedAt: timestamp("ended_at"),
    // The visible app's last sign of life, sent every 10 s (4.7).
    heartbeatAt: timestamp("heartbeat_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // One active ride per user.
    uniqueIndex("uniq_rides_active_user")
      .on(t.userId)
      .where(sql`${t.status} IN ('running', 'paused')`),
    index("idx_rides_session").on(t.sessionId),
    // The user's rides: the active ride and the start replay lookup.
    index("idx_rides_user").on(t.userId),
  ],
);

export const rideEvents = pgTable(
  "ride_events",
  {
    id: serial("id").primaryKey(),
    rideId: integer("ride_id")
      .references(() => rides.id, { onDelete: "cascade" })
      .notNull(),
    seq: integer("seq").notNull(),
    // The client's id for the event, so a replay writes nothing.
    clientId: text("client_id").notNull(),
    kind: text("kind", { enum: RIDE_EVENT_KINDS }).notNull(),
    // Watts for a nudge (±5), seconds for an extend (±60), 1 for a block
    // skip, tenths of km/h for a belt and tenths of % for an incline.
    value: integer("value"),
    // The step key the client saw (run events): an event the timeline places
    // in another step is ignored (docs/plans/run-logger.md, 4.4).
    stepKey: text("step_key"),
    // When it happened: the client's time for an offline replay inside the
    // ride, else the server's time.
    at: timestamp("at").notNull(),
    clientAt: timestamp("client_at"),
    serverAt: timestamp("server_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uniq_ride_events_seq").on(t.rideId, t.seq),
    uniqueIndex("uniq_ride_events_client").on(t.rideId, t.clientId),
  ],
);

/**
 * A Garmin activity's fill of a ride's steps (docs/plans/bike-ride-logger.md,
 * 4.8): what each filled field held before, so Undo restores it. Undo keeps
 * the row with `declined` true, and a later sync never fills that pair again.
 * `previous` is a RideFillPrevious (src/lib/ride-garmin.ts).
 */
export const rideGarminFills = pgTable(
  "ride_garmin_fills",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    rideId: integer("ride_id")
      .references(() => rides.id, { onDelete: "cascade" })
      .notNull(),
    garminActivityId: bigint("garmin_activity_id", { mode: "number" }).notNull(),
    // The part of a multisport file (its session index, docs/plans/run-logger.md 4.8); 0 for a one-sport activity.
    segment: integer("segment").default(0).notNull(),
    previous: jsonb("previous").notNull(),
    declined: boolean("declined").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uniq_ride_garmin_fills_pair").on(t.rideId, t.garminActivityId, t.segment),
    // One standing (not undone) fill per ride, so a worker fill and a Pick cannot both land.
    uniqueIndex("uniq_ride_garmin_fills_standing")
      .on(t.rideId)
      .where(sql`NOT ${t.declined}`),
    index("idx_ride_garmin_fills_user").on(t.userId),
  ],
);
