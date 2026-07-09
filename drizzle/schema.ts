import { pgTable, foreignKey, text, timestamp, index, serial, integer, date, boolean, numeric, unique, real, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const friendshipStatus = pgEnum("friendship_status", ['pending', 'accepted', 'declined'])
export const workoutFeeling = pgEnum("workout_feeling", ['Tired', 'OK', 'Good', 'Awesome'])


export const account = pgTable("account", {
	id: text().primaryKey().notNull(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id").notNull(),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: 'string' }),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { mode: 'string' }),
	scope: text(),
	password: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "account_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const workoutSessions = pgTable("workout_sessions", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	programId: integer("program_id"),
	date: date().notNull(),
	startTime: timestamp("start_time", { mode: 'string' }).defaultNow().notNull(),
	endTime: timestamp("end_time", { mode: 'string' }),
	notes: text(),
	feeling: workoutFeeling(),
	isCompleted: boolean("is_completed").default(false).notNull(),
	readiness: integer(),
}, (table) => [
	index("idx_ws_user_completed_start").using("btree", table.userId.asc().nullsLast().op("bool_ops"), table.isCompleted.asc().nullsLast().op("text_ops"), table.startTime.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "workout_sessions_user_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.programId],
			foreignColumns: [programs.id],
			name: "workout_sessions_program_id_programs_id_fk"
		}).onDelete("set null"),
]);

export const workoutSets = pgTable("workout_sets", {
	id: serial().primaryKey().notNull(),
	sessionId: integer("session_id").notNull(),
	exerciseId: integer("exercise_id").notNull(),
	setNumber: integer("set_number").notNull(),
	targetReps: integer("target_reps"),
	actualReps: integer("actual_reps").notNull(),
	weightKg: numeric("weight_kg", { precision: 6, scale:  2 }).notNull(),
	rpe: integer().notNull(),
	restTimeSeconds: integer("rest_time_seconds").notNull(),
	isCompleted: boolean("is_completed").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	durationSeconds: integer("duration_seconds"),
	distanceMeters: integer("distance_meters"),
	inclinePercent: integer("incline_percent"),
	heartRateZone: integer("heart_rate_zone"),
}, (table) => [
	index("idx_wsets_session").using("btree", table.sessionId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [workoutSessions.id],
			name: "workout_sets_session_id_workout_sessions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.exerciseId],
			foreignColumns: [exercises.id],
			name: "workout_sets_exercise_id_exercises_id_fk"
		}).onDelete("cascade"),
]);

export const inviteToken = pgTable("invite_token", {
	id: text().primaryKey().notNull(),
	token: text().notNull(),
	label: text(),
	createdBy: text("created_by").notNull(),
	maxUses: integer("max_uses"),
	usedCount: integer("used_count").default(0).notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [user.id],
			name: "invite_token_created_by_user_id_fk"
		}).onDelete("cascade"),
	unique("invite_token_token_unique").on(table.token),
]);

export const feedback = pgTable("feedback", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	type: text().default('bug').notNull(),
	message: text().notNull(),
	status: text().default('new').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "feedback_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const userWeightEntry = pgTable("user_weight_entry", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	weightKg: real("weight_kg").notNull(),
	recordedAt: timestamp("recorded_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "user_weight_entry_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const programShares = pgTable("program_shares", {
	id: serial().primaryKey().notNull(),
	programId: integer("program_id").notNull(),
	sharedByUserId: text("shared_by_user_id").notNull(),
	sharedWithUserId: text("shared_with_user_id").notNull(),
	copiedProgramId: integer("copied_program_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_program_shares_program").using("btree", table.programId.asc().nullsLast().op("int4_ops")),
	index("idx_program_shares_recipient").using("btree", table.sharedWithUserId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.programId],
			foreignColumns: [programs.id],
			name: "program_shares_program_id_programs_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sharedByUserId],
			foreignColumns: [user.id],
			name: "program_shares_shared_by_user_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sharedWithUserId],
			foreignColumns: [user.id],
			name: "program_shares_shared_with_user_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.copiedProgramId],
			foreignColumns: [programs.id],
			name: "program_shares_copied_program_id_programs_id_fk"
		}).onDelete("set null"),
]);

export const exercisePrs = pgTable("exercise_prs", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	exerciseId: integer("exercise_id").notNull(),
	prType: text("pr_type").notNull(),
	value: numeric({ precision: 8, scale:  2 }).notNull(),
	weightKg: numeric("weight_kg", { precision: 6, scale:  2 }),
	sessionId: integer("session_id"),
	setId: integer("set_id"),
	achievedAt: timestamp("achieved_at", { mode: 'string' }).defaultNow().notNull(),
	supersededAt: timestamp("superseded_at", { mode: 'string' }),
}, (table) => [
	index("idx_pr_user_exercise_superseded").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.exerciseId.asc().nullsLast().op("text_ops"), table.supersededAt.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "exercise_prs_user_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.exerciseId],
			foreignColumns: [exercises.id],
			name: "exercise_prs_exercise_id_exercises_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [workoutSessions.id],
			name: "exercise_prs_session_id_workout_sessions_id_fk"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.setId],
			foreignColumns: [workoutSets.id],
			name: "exercise_prs_set_id_workout_sets_id_fk"
		}).onDelete("set null"),
]);

export const friendships = pgTable("friendships", {
	id: serial().primaryKey().notNull(),
	requesterId: text("requester_id").notNull(),
	addresseeId: text("addressee_id").notNull(),
	status: friendshipStatus().default('pending').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_friendships_addressee").using("btree", table.addresseeId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("enum_ops")),
	index("idx_friendships_requester").using("btree", table.requesterId.asc().nullsLast().op("enum_ops"), table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.requesterId],
			foreignColumns: [user.id],
			name: "friendships_requester_id_user_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.addresseeId],
			foreignColumns: [user.id],
			name: "friendships_addressee_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const session = pgTable("session", {
	id: text().primaryKey().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	token: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id").notNull(),
	impersonatedBy: text("impersonated_by"),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "session_user_id_user_id_fk"
		}).onDelete("cascade"),
	unique("session_token_unique").on(table.token),
]);

export const programs = pgTable("programs", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	name: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "programs_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const user = pgTable("user", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	email: text().notNull(),
	emailVerified: boolean("email_verified").default(false).notNull(),
	image: text(),
	role: text().default('user'),
	banned: boolean().default(false),
	banReason: text("ban_reason"),
	banExpires: timestamp("ban_expires", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).notNull(),
	tutorialDismissedAt: timestamp("tutorial_dismissed_at", { mode: 'string' }),
	gender: text(),
	birthYear: integer("birth_year"),
	heightCm: integer("height_cm"),
	weightKg: real("weight_kg"),
	goal: text(),
	experienceLevel: text("experience_level"),
	goals: text(),
	showActivityToFriends: boolean("show_activity_to_friends").default(true).notNull(),
}, (table) => [
	unique("user_email_unique").on(table.email),
]);

export const verification = pgTable("verification", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }),
	updatedAt: timestamp("updated_at", { mode: 'string' }),
});

export const exercises = pgTable("exercises", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	category: text().notNull(),
	isCustom: boolean("is_custom").default(false).notNull(),
	bodyArea: text("body_area"),
	muscleGroup: text("muscle_group"),
	equipment: text(),
	movementPattern: text("movement_pattern"),
	userId: text("user_id"),
	isTimed: boolean("is_timed").default(false).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "exercises_user_id_user_id_fk"
		}).onDelete("cascade"),
	unique("exercises_name_unique").on(table.name),
]);

export const trainingCycleSlots = pgTable("training_cycle_slots", {
	id: serial().primaryKey().notNull(),
	trainingCycleId: integer("training_cycle_id").notNull(),
	dayOfWeek: integer("day_of_week"),
	orderIndex: integer("order_index"),
	label: text(),
	programId: integer("program_id"),
	notes: text(),
}, (table) => [
	foreignKey({
			columns: [table.trainingCycleId],
			foreignColumns: [trainingCycles.id],
			name: "training_cycle_slots_training_cycle_id_training_cycles_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.programId],
			foreignColumns: [programs.id],
			name: "training_cycle_slots_program_id_programs_id_fk"
		}).onDelete("set null"),
	unique("uniq_cycle_day").on(table.trainingCycleId, table.dayOfWeek),
	unique("uniq_cycle_order").on(table.trainingCycleId, table.orderIndex),
]);

export const programSets = pgTable("program_sets", {
	id: serial().primaryKey().notNull(),
	programExerciseId: integer("program_exercise_id").notNull(),
	setNumber: integer("set_number").notNull(),
	targetReps: integer("target_reps"),
	weightKg: numeric("weight_kg", { precision: 6, scale:  2 }),
	durationSeconds: integer("duration_seconds"),
	restTimeSeconds: integer("rest_time_seconds").default(0).notNull(),
	distanceMeters: integer("distance_meters"),
	inclinePercent: integer("incline_percent"),
	targetHeartRateZone: integer("target_heart_rate_zone"),
}, (table) => [
	foreignKey({
			columns: [table.programExerciseId],
			foreignColumns: [programExercises.id],
			name: "program_sets_program_exercise_id_program_exercises_id_fk"
		}).onDelete("cascade"),
]);

export const programExercises = pgTable("program_exercises", {
	id: serial().primaryKey().notNull(),
	programId: integer("program_id").notNull(),
	exerciseId: integer("exercise_id").notNull(),
	orderIndex: integer("order_index").default(0).notNull(),
	notes: text(),
	overloadIncrementKg: numeric("overload_increment_kg", { precision: 4, scale:  2 }),
	overloadIncrementReps: integer("overload_increment_reps").default(0),
	progressionMode: text("progression_mode").default('weight'),
}, (table) => [
	foreignKey({
			columns: [table.programId],
			foreignColumns: [programs.id],
			name: "program_exercises_program_id_programs_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.exerciseId],
			foreignColumns: [exercises.id],
			name: "program_exercises_exercise_id_exercises_id_fk"
		}).onDelete("cascade"),
]);

export const trainingCycles = pgTable("training_cycles", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	name: text().notNull(),
	durationWeeks: integer("duration_weeks").notNull(),
	scheduleType: text("schedule_type").default('day_of_week').notNull(),
	startDate: date("start_date"),
	status: text().default('draft').notNull(),
	endAction: text("end_action").default('none').notNull(),
	endMessage: text("end_message"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_tc_user_status").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "training_cycles_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const aiGenerations = pgTable("ai_generations", {
	id: serial().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_ai_generations_user_created").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.createdAt.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "ai_generations_user_id_user_id_fk"
		}).onDelete("cascade"),
]);

export const aiModelConfigs = pgTable("ai_model_configs", {
	id: serial().primaryKey().notNull(),
	modelId: text("model_id").notNull(),
	label: text().notNull(),
	enabled: boolean().default(true).notNull(),
	priority: integer().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	provider: text().default('openrouter').notNull(),
}, (table) => [
	unique("ai_model_configs_model_id_unique").on(table.modelId),
]);

export const workoutReactions = pgTable("workout_reactions", {
	id: serial().primaryKey().notNull(),
	sessionId: integer("session_id").notNull(),
	userId: text("user_id").notNull(),
	emoji: text().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [workoutSessions.id],
			name: "workout_reactions_session_id_workout_sessions_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "workout_reactions_user_id_user_id_fk"
		}).onDelete("cascade"),
	unique("workout_reactions_session_id_user_id_emoji_unique").on(table.sessionId, table.userId, table.emoji),
]);
