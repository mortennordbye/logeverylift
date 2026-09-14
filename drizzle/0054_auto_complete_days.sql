ALTER TABLE "training_cycle_slots" ADD COLUMN "auto_complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "source" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_ws_auto_day" ON "workout_sessions" USING btree ("user_id","program_id","date") WHERE "workout_sessions"."source" = 'auto';