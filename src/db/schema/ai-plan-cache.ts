import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * AI edits of built plans, shared between users. The key is a hash of
 * everything the result depends on (editCacheMaterial in
 * src/lib/utils/ai-edit.ts); plans are stored without loads, which are filled
 * in for each user on read. Not user-owned: no row identifies who asked.
 */
export const aiPlanCache = pgTable("ai_plan_cache", {
  key: text("key").primaryKey(),
  templateVersion: integer("template_version").notNull(),
  picks: jsonb("picks").notNull(),
  edit: jsonb("edit").notNull(),
  plan: jsonb("plan").notNull(),
  modelUsed: text("model_used").notNull(),
  hits: integer("hits").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastHitAt: timestamp("last_hit_at"),
});

export type AiPlanCacheRow = typeof aiPlanCache.$inferSelect;
