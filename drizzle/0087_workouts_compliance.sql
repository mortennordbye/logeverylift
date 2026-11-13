CREATE TABLE "illness_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"severity" text,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"sport" text NOT NULL,
	"workout" jsonb NOT NULL,
	"priority" text,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD COLUMN "workout" jsonb;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD COLUMN "workout_id" integer;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD COLUMN "brick_parent_id" integer;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD COLUMN "garmin_activity_id" integer;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD COLUMN "missed_reason" text;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD COLUMN "status_on" date;--> statement-breakpoint
ALTER TABLE "training_cycle_slots" ADD COLUMN "workout_id" integer;--> statement-breakpoint
ALTER TABLE "training_cycle_slots" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "training_cycle_slots" ADD COLUMN "brick_with_next" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "illness_periods" ADD CONSTRAINT "illness_periods_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_illness_user_start" ON "illness_periods" USING btree ("user_id","started_on");--> statement-breakpoint
CREATE INDEX "idx_workouts_user_sport" ON "workouts" USING btree ("user_id","sport");--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_brick_parent_id_planned_sessions_id_fk" FOREIGN KEY ("brick_parent_id") REFERENCES "public"."planned_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_garmin_activity_id_garmin_activities_id_fk" FOREIGN KEY ("garmin_activity_id") REFERENCES "public"."garmin_activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_cycle_slots" ADD CONSTRAINT "training_cycle_slots_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "ps_program_or_workout" CHECK ("planned_sessions"."program_id" IS NULL OR "planned_sessions"."workout" IS NULL);