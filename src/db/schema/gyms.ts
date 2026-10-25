import { pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Gyms from OpenStreetMap: every gym in the imported countries
 * (src/lib/gym-import.ts), plus any other gym a user picked as their primary
 * gym, copied when first picked. Public place data, not personal data: who
 * trains where lives on user.primaryGymId.
 */
export const gyms = pgTable("gyms", {
  id: serial("id").primaryKey(),
  // OpenStreetMap element, e.g. "node/123" or "way/456".
  osmRef: text("osm_ref").notNull().unique(),
  name: text("name").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  address: text("address"),
  // Last import that found this gym. Null for a gym only copied when picked.
  importedAt: timestamp("imported_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
