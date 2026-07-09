/**
 * Database Schema Barrel Export
 *
 * Central export point for all database schemas and relations.
 * Import from this file to access any table or relation definition.
 *
 * Usage:
 * ```typescript
 * import { users, workoutSessions, exercises } from "@/db/schema";
 * ```
 */

// Table schemas
export * from "./ai-generations";
export * from "./ai-model-configs";
export * from "./auth";
export * from "./dismissed-makeups";
export * from "./exercise-prs";
export * from "./feedback";
export * from "./friendships";
export * from "./nudges";
export * from "./program-shares";
export * from "./invite-tokens";
export * from "./exercises";
export * from "./programs";
export * from "./training-cycles";
export * from "./users";
export * from "./weight-history";
export * from "./workout-reactions";
export * from "./workout-sessions";
export * from "./workout-sets";

// Relations for Drizzle relational queries
export * from "./relations";
