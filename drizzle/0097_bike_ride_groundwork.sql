CREATE TABLE "ride_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"ride_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"client_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" integer,
	"at" timestamp NOT NULL,
	"client_at" timestamp,
	"server_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" integer NOT NULL,
	"program_exercise_id" integer,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"plan" jsonb NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"heartbeat_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "ramp" jsonb;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "free" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "outdoor_target" jsonb;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "ended_early" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "ride_mode" text;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "avg_power" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "max_hr" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "avg_cadence" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "avg_speed" real;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "climb_m" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "target_offset_w" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "sources" jsonb;--> statement-breakpoint
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_program_exercise_id_program_exercises_id_fk" FOREIGN KEY ("program_exercise_id") REFERENCES "public"."program_exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_ride_events_seq" ON "ride_events" USING btree ("ride_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_ride_events_client" ON "ride_events" USING btree ("ride_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_rides_active_user" ON "rides" USING btree ("user_id") WHERE "rides"."status" IN ('running', 'paused');--> statement-breakpoint
CREATE INDEX "idx_rides_session" ON "rides" USING btree ("session_id");