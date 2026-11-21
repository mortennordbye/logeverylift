/**
 * Body measurements in cm (docs/plans/body-measurements.md). One row per
 * value: a site, a side and a date. A second log on the same date replaces
 * that date's value. Health data (Art. 9): never shown to friends.
 */

import { date, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users";

export const BODY_SITES = [
  "neck",
  "shoulders",
  "chest",
  "waist",
  "hips",
  "upper-arm",
  "forearm",
  "thigh",
  "calf",
  "arm-length",
  "leg-length",
  "inseam",
] as const;
export type BodySite = (typeof BODY_SITES)[number];

export const BODY_SIDES = ["none", "left", "right"] as const;
export type BodySide = (typeof BODY_SIDES)[number];

export const bodyMeasurements = pgTable(
  "body_measurement",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    site: text("site", { enum: BODY_SITES }).notNull(),
    side: text("side", { enum: BODY_SIDES }).notNull(),
    valueCm: real("value_cm").notNull(),
    measuredOn: date("measured_on").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_body_measurement_day").on(t.userId, t.site, t.side, t.measuredOn)],
);
