import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const inviteTokens = pgTable("invite_token", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  label: text("label"),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  maxUses: integer("max_uses"),       // null = unlimited
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at"), // null = no expiry
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
