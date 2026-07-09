import { relations } from "drizzle-orm/relations";
import { user, account, workoutSessions, programs, workoutSets, exercises, inviteToken, feedback, userWeightEntry, programShares, exercisePrs, friendships, session, trainingCycles, trainingCycleSlots, programExercises, programSets, aiGenerations, workoutReactions } from "./schema";

export const accountRelations = relations(account, ({one}) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id]
	}),
}));

export const userRelations = relations(user, ({many}) => ({
	accounts: many(account),
	workoutSessions: many(workoutSessions),
	inviteTokens: many(inviteToken),
	feedbacks: many(feedback),
	userWeightEntries: many(userWeightEntry),
	programShares_sharedByUserId: many(programShares, {
		relationName: "programShares_sharedByUserId_user_id"
	}),
	programShares_sharedWithUserId: many(programShares, {
		relationName: "programShares_sharedWithUserId_user_id"
	}),
	exercisePrs: many(exercisePrs),
	friendships_requesterId: many(friendships, {
		relationName: "friendships_requesterId_user_id"
	}),
	friendships_addresseeId: many(friendships, {
		relationName: "friendships_addresseeId_user_id"
	}),
	sessions: many(session),
	programs: many(programs),
	exercises: many(exercises),
	trainingCycles: many(trainingCycles),
	aiGenerations: many(aiGenerations),
	workoutReactions: many(workoutReactions),
}));

export const workoutSessionsRelations = relations(workoutSessions, ({one, many}) => ({
	user: one(user, {
		fields: [workoutSessions.userId],
		references: [user.id]
	}),
	program: one(programs, {
		fields: [workoutSessions.programId],
		references: [programs.id]
	}),
	workoutSets: many(workoutSets),
	exercisePrs: many(exercisePrs),
	workoutReactions: many(workoutReactions),
}));

export const programsRelations = relations(programs, ({one, many}) => ({
	workoutSessions: many(workoutSessions),
	programShares_programId: many(programShares, {
		relationName: "programShares_programId_programs_id"
	}),
	programShares_copiedProgramId: many(programShares, {
		relationName: "programShares_copiedProgramId_programs_id"
	}),
	user: one(user, {
		fields: [programs.userId],
		references: [user.id]
	}),
	trainingCycleSlots: many(trainingCycleSlots),
	programExercises: many(programExercises),
}));

export const workoutSetsRelations = relations(workoutSets, ({one, many}) => ({
	workoutSession: one(workoutSessions, {
		fields: [workoutSets.sessionId],
		references: [workoutSessions.id]
	}),
	exercise: one(exercises, {
		fields: [workoutSets.exerciseId],
		references: [exercises.id]
	}),
	exercisePrs: many(exercisePrs),
}));

export const exercisesRelations = relations(exercises, ({one, many}) => ({
	workoutSets: many(workoutSets),
	exercisePrs: many(exercisePrs),
	user: one(user, {
		fields: [exercises.userId],
		references: [user.id]
	}),
	programExercises: many(programExercises),
}));

export const inviteTokenRelations = relations(inviteToken, ({one}) => ({
	user: one(user, {
		fields: [inviteToken.createdBy],
		references: [user.id]
	}),
}));

export const feedbackRelations = relations(feedback, ({one}) => ({
	user: one(user, {
		fields: [feedback.userId],
		references: [user.id]
	}),
}));

export const userWeightEntryRelations = relations(userWeightEntry, ({one}) => ({
	user: one(user, {
		fields: [userWeightEntry.userId],
		references: [user.id]
	}),
}));

export const programSharesRelations = relations(programShares, ({one}) => ({
	program_programId: one(programs, {
		fields: [programShares.programId],
		references: [programs.id],
		relationName: "programShares_programId_programs_id"
	}),
	user_sharedByUserId: one(user, {
		fields: [programShares.sharedByUserId],
		references: [user.id],
		relationName: "programShares_sharedByUserId_user_id"
	}),
	user_sharedWithUserId: one(user, {
		fields: [programShares.sharedWithUserId],
		references: [user.id],
		relationName: "programShares_sharedWithUserId_user_id"
	}),
	program_copiedProgramId: one(programs, {
		fields: [programShares.copiedProgramId],
		references: [programs.id],
		relationName: "programShares_copiedProgramId_programs_id"
	}),
}));

export const exercisePrsRelations = relations(exercisePrs, ({one}) => ({
	user: one(user, {
		fields: [exercisePrs.userId],
		references: [user.id]
	}),
	exercise: one(exercises, {
		fields: [exercisePrs.exerciseId],
		references: [exercises.id]
	}),
	workoutSession: one(workoutSessions, {
		fields: [exercisePrs.sessionId],
		references: [workoutSessions.id]
	}),
	workoutSet: one(workoutSets, {
		fields: [exercisePrs.setId],
		references: [workoutSets.id]
	}),
}));

export const friendshipsRelations = relations(friendships, ({one}) => ({
	user_requesterId: one(user, {
		fields: [friendships.requesterId],
		references: [user.id],
		relationName: "friendships_requesterId_user_id"
	}),
	user_addresseeId: one(user, {
		fields: [friendships.addresseeId],
		references: [user.id],
		relationName: "friendships_addresseeId_user_id"
	}),
}));

export const sessionRelations = relations(session, ({one}) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	}),
}));

export const trainingCycleSlotsRelations = relations(trainingCycleSlots, ({one}) => ({
	trainingCycle: one(trainingCycles, {
		fields: [trainingCycleSlots.trainingCycleId],
		references: [trainingCycles.id]
	}),
	program: one(programs, {
		fields: [trainingCycleSlots.programId],
		references: [programs.id]
	}),
}));

export const trainingCyclesRelations = relations(trainingCycles, ({one, many}) => ({
	trainingCycleSlots: many(trainingCycleSlots),
	user: one(user, {
		fields: [trainingCycles.userId],
		references: [user.id]
	}),
}));

export const programSetsRelations = relations(programSets, ({one}) => ({
	programExercise: one(programExercises, {
		fields: [programSets.programExerciseId],
		references: [programExercises.id]
	}),
}));

export const programExercisesRelations = relations(programExercises, ({one, many}) => ({
	programSets: many(programSets),
	program: one(programs, {
		fields: [programExercises.programId],
		references: [programs.id]
	}),
	exercise: one(exercises, {
		fields: [programExercises.exerciseId],
		references: [exercises.id]
	}),
}));

export const aiGenerationsRelations = relations(aiGenerations, ({one}) => ({
	user: one(user, {
		fields: [aiGenerations.userId],
		references: [user.id]
	}),
}));

export const workoutReactionsRelations = relations(workoutReactions, ({one}) => ({
	workoutSession: one(workoutSessions, {
		fields: [workoutReactions.sessionId],
		references: [workoutSessions.id]
	}),
	user: one(user, {
		fields: [workoutReactions.userId],
		references: [user.id]
	}),
}));