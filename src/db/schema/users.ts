import { boolean, integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Set by Better Auth admin plugin
  role: text("role").$type<"user" | "admin">().default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  tutorialDismissedAt: timestamp("tutorial_dismissed_at"),
  // Optional user profile fields — used for AI prompt personalisation and future smart progression
  gender: text("gender").$type<"male" | "female" | "other" | "prefer_not_to_say">(),
  birthYear: integer("birth_year"),
  heightCm: integer("height_cm"),
  weightKg: real("weight_kg"),
  goals: text("goals").$type<string>(), // JSON array of Goal values, e.g. '["strength","muscle_gain"]'
  experienceLevel: text("experience_level").$type<"beginner" | "intermediate" | "advanced">(),
  showActivityToFriends: boolean("show_activity_to_friends").notNull().default(true),
  // When false, the home screen stops surfacing missed-workout / overdue prompts
  // (the "Missed this week" make-up card and the rotation "X days overdue" badge).
  missedWorkoutsEnabled: boolean("missed_workouts_enabled").notNull().default(true),
});
