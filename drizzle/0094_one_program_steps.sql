ALTER TABLE "program_exercises" ADD COLUMN "pool_length_m" real;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "step_kind" text;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "ends_on_lap" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "targets" jsonb;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "cadence_low" integer;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "cadence_high" integer;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "block_id" integer;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "block_round" integer;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "stroke" text;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "equipment" text[];--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "send_off_seconds" integer;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "paused_seconds" integer;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "client_key" text;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "step_status" text;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "extended_seconds" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "measured_value" real;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "avg_hr" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "planned_step" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_ws_client_key" ON "workout_sessions" USING btree ("user_id","client_key") WHERE "workout_sessions"."client_key" IS NOT NULL;