/**
 * The athlete profile (docs/plans/athlete-profile.md, 2.1; decisions D10,
 * D12, D15, D18, T5, T10): facts about the athlete that plans are built from,
 * each with a home of its own instead of coach memory.
 *
 * - athlete_profiles: one row per user. Availability, endurance experience,
 *   the strength goal and when the intake interview was finished.
 * - athlete_thresholds: one row per value, so the rows are the history.
 *   Stored metric: watts, bpm, and m/s for paces (pace ranges invert).
 * - athlete_injuries: injuries and limits, with their history.
 *
 * Every write goes through the revision layer (object types athlete,
 * threshold, injury), so each row carries a version and a soft delete like
 * coach_memory. Health data: never shown to friends, never sent to the in-app
 * AI; only the user and their own connected assistant read it.
 */

import { date, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

export const ENDURANCE_LEVELS = ["novice", "intermediate", "advanced"] as const;
export type EnduranceLevel = (typeof ENDURANCE_LEVELS)[number];

export const STRENGTH_GOALS = ["keep_muscle", "stronger", "minimal"] as const;
export type StrengthGoal = (typeof STRENGTH_GOALS)[number];

export const THRESHOLD_KINDS = ["ftp", "lthr_bike", "lthr_run", "run_threshold_pace", "swim_css", "max_hr"] as const;
export type ThresholdKind = (typeof THRESHOLD_KINDS)[number];

export const THRESHOLD_SOURCES = ["manual", "test", "garmin"] as const;
export type ThresholdSource = (typeof THRESHOLD_SOURCES)[number];

export const THRESHOLD_PROTOCOLS = ["run_30min", "bike_30min", "ftp_20min", "css_400_200", "swim_t1000"] as const;
export type ThresholdProtocol = (typeof THRESHOLD_PROTOCOLS)[number];

export const INJURY_AREAS = [
  "foot",
  "ankle",
  "achilles",
  "calf",
  "shin",
  "knee",
  "hamstring",
  "quad",
  "hip",
  "groin",
  "lower_back",
  "upper_back",
  "neck",
  "shoulder",
  "elbow",
  "wrist",
  "other",
] as const;
export type InjuryArea = (typeof INJURY_AREAS)[number];

export const INJURY_SIDES = ["left", "right", "both"] as const;
export type InjurySide = (typeof INJURY_SIDES)[number];

export const INJURY_STATUSES = ["active", "managed", "past"] as const;
export type InjuryStatus = (typeof INJURY_STATUSES)[number];

export const athleteProfiles = pgTable(
  "athlete_profiles",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // On the cycle's scale, so a plan can use it as the cycle's athlete level.
    enduranceLevel: text("endurance_level", { enum: ENDURANCE_LEVELS }),
    // 1 = Monday ... 7 = Sunday.
    availableDays: integer("available_days").array(),
    hoursPerWeek: real("hours_per_week"),
    longestDayMinutes: integer("longest_day_minutes"),
    longDay: integer("long_day"),
    strengthGoal: text("strength_goal", { enum: STRENGTH_GOALS }),
    interviewCompletedAt: timestamp("interview_completed_at"),
    // Never set: the profile is not deleted. Here so the revision layer can treat it like other objects.
    deletedAt: timestamp("deleted_at"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uniq_athlete_profile_user").on(t.userId)],
);

export const athleteThresholds = pgTable(
  "athlete_thresholds",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    kind: text("kind", { enum: THRESHOLD_KINDS }).notNull(),
    // Watts (ftp), bpm (heart rates), m/s (run pace, swim CSS).
    value: real("value").notNull(),
    // The day of the test or estimate, in the user's time zone.
    measuredOn: date("measured_on").notNull(),
    source: text("source", { enum: THRESHOLD_SOURCES }).notNull(),
    protocol: text("protocol", { enum: THRESHOLD_PROTOCOLS }),
    // The test's inputs, so the value can be checked.
    testData: jsonb("test_data"),
    notes: text("notes"),
    deletedAt: timestamp("deleted_at"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("idx_athlete_thresholds_user").on(t.userId, t.kind, t.measuredOn)],
);

export const athleteInjuries = pgTable(
  "athlete_injuries",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    area: text("area", { enum: INJURY_AREAS }).notNull(),
    side: text("side", { enum: INJURY_SIDES }),
    description: text("description").notNull(),
    // What training to avoid, in the user's words.
    avoid: text("avoid"),
    status: text("status", { enum: INJURY_STATUSES }).notNull(),
    startedOn: date("started_on"),
    endedOn: date("ended_on"),
    deletedAt: timestamp("deleted_at"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("idx_athlete_injuries_user").on(t.userId, t.status)],
);
