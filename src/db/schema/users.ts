import { boolean, integer, pgTable, real, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { gyms } from "./gyms";

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
  // Last time the home screen asked this user to share the app (answered
  // either way). Null until first asked. See src/lib/utils/share-prompt.ts.
  sharePromptAt: timestamp("share_prompt_at"),
  // GDPR consent records (src/lib/constants/legal.ts). termsVersion is the
  // LEGAL_VERSION last accepted; the home screen asks again when it is older
  // than CONSENT_VERSION. policySeenVersion is the LEGAL_VERSION the user was
  // last told about; the home screen says the policy changed when it differs.
  // healthConsentAt is explicit consent to body and training data (Art. 9),
  // given together with the terms. aiConsentAt is the separate opt-in to
  // sending the AI request to an outside model; null until given.
  termsVersion: text("terms_version"),
  policySeenVersion: text("policy_seen_version"),
  termsAcceptedAt: timestamp("terms_accepted_at"),
  healthConsentAt: timestamp("health_consent_at"),
  aiConsentAt: timestamp("ai_consent_at"),
  // Optional user profile fields — used for AI prompt personalisation and future smart progression
  gender: text("gender").$type<"male" | "female" | "other" | "prefer_not_to_say">(),
  birthYear: integer("birth_year"),
  heightCm: integer("height_cm"),
  weightKg: real("weight_kg"),
  goals: text("goals").$type<string>(), // JSON array of Goal values, e.g. '["strength","muscle_gain"]'
  experienceLevel: text("experience_level").$type<"beginner" | "intermediate" | "advanced">(),
  showActivityToFriends: boolean("show_activity_to_friends").notNull().default(true),
  // Last time the user opened the Friends page. Nudges and reactions newer
  // than this count towards the badge on the More tab.
  friendsSeenAt: timestamp("friends_seen_at"),
  // When false, the home screen stops surfacing missed-workout / overdue prompts
  // (the "Missed this week" make-up card and the rotation "X days overdue" badge).
  missedWorkoutsEnabled: boolean("missed_workouts_enabled").notNull().default(true),
  // The code in this user's share link (/welcome?ref=...). Whoever signs up
  // through it sends them a friend request. Made on first share.
  friendCode: text("friend_code").unique(),
  // Where the user usually trains. Setting it is the opt-in to being listed
  // under that gym on the gym map, which every user can see.
  primaryGymId: integer("primary_gym_id").references(() => gyms.id, { onDelete: "set null" }),
  // The admin whose invite (token or direct account creation) let this user in.
  // Null for open self-signups. Drives the "Invited by founder" badge.
  invitedById: text("invited_by_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
});
