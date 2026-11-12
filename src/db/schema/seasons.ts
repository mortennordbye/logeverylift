/**
 * Seasons and races (docs/plans/seasons.md, 2.1; decisions D8, D17, D22, T5).
 *
 * A season is a long goal above training cycles, for every user: a name, a
 * goal in the user's words, a start and an end, and the goal after it. Its
 * phases are training cycles with `season_id` set (training-cycles.ts). Its
 * races are endurance fields, shown only with the endurance switch (D18).
 *
 * Plan objects: every write goes through the revision layer (object type
 * `season`), with soft delete and a version, like programs and cycles. Races
 * are not soft deleted on their own, like slots: a season snapshot holds them
 * and a restore writes them back with their old ids.
 */

import { date, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const RACE_DISCIPLINES = ["triathlon", "run", "ride", "swim", "other"] as const;
export type RaceDiscipline = (typeof RACE_DISCIPLINES)[number];
/** Triathlon distances. Full = 3.8/180/42.2 km, half = 1.9/90/21.1 km. */
export const TRI_DISTANCES = ["full", "half", "olympic", "sprint"] as const;
export type TriDistance = (typeof TRI_DISTANCES)[number];
export const RACE_PRIORITIES = ["A", "B", "C"] as const;
export type RacePriority = (typeof RACE_PRIORITIES)[number];

export const seasons = pgTable(
  "seasons",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    goal: text("goal"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    nextGoal: text("next_goal"),
    // Set when a race change needs the plan looked at again (D17). The app
    // never reshapes the phases itself; the user or the assistant clears it.
    replanFlaggedAt: timestamp("replan_flagged_at"),
    replanReason: text("replan_reason"),
    // Soft delete and version, as on programs (docs/plans/revisions.md, 2.1).
    deletedAt: timestamp("deleted_at"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("idx_seasons_user").on(t.userId, t.startDate)],
);

export const seasonRaces = pgTable(
  "season_races",
  {
    id: serial("id").primaryKey(),
    seasonId: integer("season_id")
      .references(() => seasons.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    raceDate: date("race_date").notNull(),
    discipline: text("discipline", { enum: RACE_DISCIPLINES }).notNull(),
    // Triathlon only.
    distance: text("distance", { enum: TRI_DISTANCES }),
    // Run, ride, swim or other: the race length.
    distanceMeters: integer("distance_meters"),
    priority: text("priority", { enum: RACE_PRIORITIES }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_season_races_season").on(t.seasonId, t.raceDate)],
);
