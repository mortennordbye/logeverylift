/**
 * Web push for ride alerts (docs/plans/bike-ride-logger.md, 4.7, and
 * docs/plans/web-push-and-reminders.md, 3a).
 *
 * A push subscription is one device that turned step alerts on. A ride push
 * is one alert of a running ride, rewritten from the ride's timeline after
 * every ride event and deleted when it is sent (src/lib/push.ts).
 */

import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { rides } from "./rides";
import { users } from "./users";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // The push service's address for this device (Apple, Google or Mozilla).
    endpoint: text("endpoint").notNull(),
    // The device's keys that encrypt each payload.
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // The last push the push service took.
    lastUsedAt: timestamp("last_used_at"),
  },
  (t) => [uniqueIndex("uniq_push_subscriptions_endpoint").on(t.endpoint), index("idx_push_subscriptions_user").on(t.userId)],
);

export const RIDE_PUSH_KINDS = ["step", "minute_left", "done"] as const;
export type RidePushKind = (typeof RIDE_PUSH_KINDS)[number];

export const ridePushes = pgTable(
  "ride_pushes",
  {
    id: serial("id").primaryKey(),
    rideId: integer("ride_id")
      .references(() => rides.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    sendAt: timestamp("send_at").notNull(),
    kind: text("kind", { enum: RIDE_PUSH_KINDS }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // The plan step the alert is about: the step that starts, or the one with a minute left.
    stepIndex: integer("step_index").notNull(),
  },
  (t) => [index("idx_ride_pushes_send_at").on(t.sendAt), index("idx_ride_pushes_ride").on(t.rideId)],
);
