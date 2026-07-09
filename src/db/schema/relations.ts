/**
 * Drizzle ORM Relations
 *
 * This file defines relationships between tables for Drizzle's relational query API.
 * These relations enable intuitive querying with automatic joins:
 *
 * Example usage:
 * ```typescript
 * // Fetch user with all their workout sessions
 * const userWithSessions = await db.query.users.findFirst({
 *   where: eq(users.id, 1),
 *   with: {
 *     workoutSessions: true,
 *   },
 * });
 *
 * // Fetch session with all sets and exercise details
 * const sessionWithSets = await db.query.workoutSessions.findFirst({
 *   where: eq(workoutSessions.id, sessionId),
 *   with: {
 *     workoutSets: {
 *       with: {
 *         exercise: true,
 *       },
 *     },
 *   },
 * });
 * ```
 *
 * Relationship structure:
 * - User → has many WorkoutSessions
 * - WorkoutSession → belongs to User, has many WorkoutSets
 * - WorkoutSet → belongs to WorkoutSession, belongs to Exercise
 * - Exercise → has many WorkoutSets
 */

import { relations } from "drizzle-orm";
import { aiGenerations } from "./ai-generations";
import { exercisePrs } from "./exercise-prs";
import { exercises } from "./exercises";
import { friendships } from "./friendships";
import { programShares } from "./program-shares";
import { programExercises, programSets, programs } from "./programs";
import { trainingCycleSlots, trainingCycles } from "./training-cycles";
import { users } from "./users";
import { userWeightEntries } from "./weight-history";
import { workoutSessions } from "./workout-sessions";
import { workoutSets } from "./workout-sets";

// User relations
export const usersRelations = relations(users, ({ many }) => ({
  workoutSessions: many(workoutSessions),
  programs: many(programs),
  trainingCycles: many(trainingCycles),
  weightEntries: many(userWeightEntries),
  exercisePrs: many(exercisePrs),
  sentFriendRequests: many(friendships, { relationName: "requester" }),
  receivedFriendRequests: many(friendships, { relationName: "addressee" }),
  programSharesSent: many(programShares, { relationName: "sharedBy" }),
  programSharesReceived: many(programShares, { relationName: "sharedWith" }),
  aiGenerations: many(aiGenerations),
}));

export const aiGenerationsRelations = relations(aiGenerations, ({ one }) => ({
  user: one(users, {
    fields: [aiGenerations.userId],
    references: [users.id],
  }),
}));

// Exercise PR relations
export const exercisePrsRelations = relations(exercisePrs, ({ one }) => ({
  user: one(users, {
    fields: [exercisePrs.userId],
    references: [users.id],
  }),
  exercise: one(exercises, {
    fields: [exercisePrs.exerciseId],
    references: [exercises.id],
  }),
  workoutSession: one(workoutSessions, {
    fields: [exercisePrs.sessionId],
    references: [workoutSessions.id],
  }),
  workoutSet: one(workoutSets, {
    fields: [exercisePrs.setId],
    references: [workoutSets.id],
  }),
}));

// Weight entry relations
export const userWeightEntriesRelations = relations(userWeightEntries, ({ one }) => ({
  user: one(users, {
    fields: [userWeightEntries.userId],
    references: [users.id],
  }),
}));

// Exercise relations
export const exercisesRelations = relations(exercises, ({ many }) => ({
  workoutSets: many(workoutSets),
  programExercises: many(programExercises),
}));

// Program relations
export const programsRelations = relations(programs, ({ one, many }) => ({
  user: one(users, {
    fields: [programs.userId],
    references: [users.id],
  }),
  programExercises: many(programExercises),
  trainingCycleSlots: many(trainingCycleSlots),
  shares: many(programShares),
}));

// ProgramExercise relations
export const programExercisesRelations = relations(
  programExercises,
  ({ one, many }) => ({
    program: one(programs, {
      fields: [programExercises.programId],
      references: [programs.id],
    }),
    exercise: one(exercises, {
      fields: [programExercises.exerciseId],
      references: [exercises.id],
    }),
    programSets: many(programSets),
  }),
);

// ProgramSet relations
export const programSetsRelations = relations(programSets, ({ one }) => ({
  programExercise: one(programExercises, {
    fields: [programSets.programExerciseId],
    references: [programExercises.id],
  }),
}));

// Workout Session relations
export const workoutSessionsRelations = relations(
  workoutSessions,
  ({ one, many }) => ({
    user: one(users, {
      fields: [workoutSessions.userId],
      references: [users.id],
    }),
    program: one(programs, {
      fields: [workoutSessions.programId],
      references: [programs.id],
    }),
    workoutSets: many(workoutSets),
  }),
);

// Workout Set relations
export const workoutSetsRelations = relations(workoutSets, ({ one }) => ({
  workoutSession: one(workoutSessions, {
    fields: [workoutSets.sessionId],
    references: [workoutSessions.id],
  }),
  exercise: one(exercises, {
    fields: [workoutSets.exerciseId],
    references: [exercises.id],
  }),
}));

// Training Cycle relations
export const trainingCyclesRelations = relations(
  trainingCycles,
  ({ one, many }) => ({
    user: one(users, {
      fields: [trainingCycles.userId],
      references: [users.id],
    }),
    slots: many(trainingCycleSlots),
  }),
);

// Training Cycle Slot relations
export const trainingCycleSlotsRelations = relations(
  trainingCycleSlots,
  ({ one }) => ({
    trainingCycle: one(trainingCycles, {
      fields: [trainingCycleSlots.trainingCycleId],
      references: [trainingCycles.id],
    }),
    program: one(programs, {
      fields: [trainingCycleSlots.programId],
      references: [programs.id],
    }),
  }),
);

// Friendship relations
export const friendshipsRelations = relations(friendships, ({ one }) => ({
  requester: one(users, {
    fields: [friendships.requesterId],
    references: [users.id],
    relationName: "requester",
  }),
  addressee: one(users, {
    fields: [friendships.addresseeId],
    references: [users.id],
    relationName: "addressee",
  }),
}));

// Program Share relations
export const programSharesRelations = relations(programShares, ({ one }) => ({
  program: one(programs, {
    fields: [programShares.programId],
    references: [programs.id],
  }),
  sharedBy: one(users, {
    fields: [programShares.sharedByUserId],
    references: [users.id],
    relationName: "sharedBy",
  }),
  sharedWith: one(users, {
    fields: [programShares.sharedWithUserId],
    references: [users.id],
    relationName: "sharedWith",
  }),
  copiedProgram: one(programs, {
    fields: [programShares.copiedProgramId],
    references: [programs.id],
  }),
}));
