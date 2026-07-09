import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const aiModelConfigs = pgTable("ai_model_configs", {
  id: serial("id").primaryKey(),
  modelId: text("model_id").notNull().unique(),
  label: text("label").notNull(),
  provider: text("provider").notNull().default("openrouter"),
  enabled: boolean("enabled").notNull().default(true),
  priority: integer("priority").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AiModelConfig = typeof aiModelConfigs.$inferSelect;
