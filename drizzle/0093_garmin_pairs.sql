ALTER TABLE "planned_sessions" ADD COLUMN "garmin_unpaired" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "garmin_activity_id" integer;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "rpe" integer;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_garmin_activity_id_garmin_activities_id_fk" FOREIGN KEY ("garmin_activity_id") REFERENCES "public"."garmin_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_ws_garmin_planned" ON "workout_sessions" USING btree ("user_id","planned_session_id") WHERE "workout_sessions"."source" = 'garmin' AND "workout_sessions"."planned_session_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_ws_garmin_activity" ON "workout_sessions" USING btree ("garmin_activity_id") WHERE "workout_sessions"."source" = 'garmin';