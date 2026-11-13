CREATE TABLE "workout_step_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workout_session_id" integer NOT NULL,
	"planned_session_id" integer,
	"source" text NOT NULL,
	"client_key" text,
	"workout" jsonb NOT NULL,
	"anchors" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"paused_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workout_step_results" ADD CONSTRAINT "workout_step_results_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_step_results" ADD CONSTRAINT "workout_step_results_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_step_results" ADD CONSTRAINT "workout_step_results_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_wsr_session" ON "workout_step_results" USING btree ("workout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_wsr_client_key" ON "workout_step_results" USING btree ("user_id","client_key") WHERE "workout_step_results"."client_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_wsr_user_planned" ON "workout_step_results" USING btree ("user_id","planned_session_id");