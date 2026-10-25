import { pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Gyms users have picked as their primary gym, copied from OpenStreetMap when
 * first picked. Public place data, not personal data: who trains where lives
 * on user.primaryGymId.
 */
export const gyms = pgTable("gyms", {
  id: serial("id").primaryKey(),
  // OpenStreetMap element, e.g. "node/123" or "way/456".
  osmRef: text("osm_ref").notNull().unique(),
  name: text("name").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  address: text("address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
