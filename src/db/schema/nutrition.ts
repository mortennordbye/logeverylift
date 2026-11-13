/**
 * Nutrition and race-day plans (docs/plans/nutrition-and-race-day.md, 3).
 *
 * - fuel_products: the user's own gels, drinks and bars with their numbers.
 * - fuel_logs: what the user took in during one session, logged in the app or
 *   found in Garmin, with a GI score for gut training. Replaces
 *   garmin_fuel_logs (kept one release for rollback, unread).
 * - sweat_tests: weighed sweat-rate tests.
 * - race_plans: the inputs of one race's plan (object type `race_plan` in the
 *   revision layer). Everything else in the plan is worked out on read.
 *
 * Fuel logs, products and tests are logged data: no revisions. GI scores,
 * sweat loss and body weight are health data (Art. 9): never shown to friends.
 */

import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { seasonRaces } from "./seasons";
import { users } from "./users";
import { workoutSessions } from "./workout-sessions";

export const fuelProducts = pgTable(
  "fuel_products",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    carbsG: real("carbs_g"),
    sodiumMg: integer("sodium_mg"),
    caffeineMg: integer("caffeine_mg"),
    // A drink's volume per serving.
    fluidMl: integer("fluid_ml"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("idx_fuel_products_user").on(t.userId)],
);

export const fuelLogs = pgTable(
  "fuel_logs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    workoutSessionId: integer("workout_session_id").references(() => workoutSessions.id, { onDelete: "cascade" }),
    garminActivityId: bigint("garmin_activity_id", { mode: "number" }),
    // The session's moving time at save, so per-hour numbers stay stable.
    durationS: integer("duration_s"),
    carbsG: integer("carbs_g"),
    fluidMl: integer("fluid_ml"),
    sodiumMg: integer("sodium_mg"),
    caffeineMg: integer("caffeine_mg"),
    // 0 = no gut symptoms, 10 = worst.
    giScore: integer("gi_score"),
    // [{ productId, name, count, carbsG, sodiumMg, caffeineMg, fluidMl }]: the product numbers as saved.
    items: jsonb("items"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    check("fuel_logs_one_link", sql`(${t.workoutSessionId} IS NULL) <> (${t.garminActivityId} IS NULL)`),
    check("fuel_logs_gi_range", sql`${t.giScore} IS NULL OR (${t.giScore} >= 0 AND ${t.giScore} <= 10)`),
    uniqueIndex("uniq_fuel_log_session").on(t.userId, t.workoutSessionId),
    uniqueIndex("uniq_fuel_log_garmin").on(t.userId, t.garminActivityId),
  ],
);

export const SWEAT_TEST_SPORTS = ["bike", "run", "other"] as const;

export const sweatTests = pgTable(
  "sweat_tests",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    testedOn: date("tested_on").notNull(),
    durationS: integer("duration_s").notNull(),
    preKg: real("pre_kg").notNull(),
    postKg: real("post_kg").notNull(),
    fluidMl: integer("fluid_ml").notNull(),
    urineMl: integer("urine_ml"),
    temperatureC: real("temperature_c"),
    sport: text("sport", { enum: SWEAT_TEST_SPORTS }),
    // A lab sweat sodium value, mg per litre.
    sweatSodiumMgL: integer("sweat_sodium_mg_l"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("idx_sweat_tests_user").on(t.userId, t.testedOn)],
);

export const racePlans = pgTable(
  "race_plans",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    seasonRaceId: integer("season_race_id")
      .references(() => seasonRaces.id, { onDelete: "cascade" })
      .notNull(),
    // racePlanInput in src/lib/validators/nutrition.ts.
    plan: jsonb("plan").notNull(),
    version: integer("version").notNull().default(1),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uniq_race_plan_race").on(t.seasonRaceId)],
);
