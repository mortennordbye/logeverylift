CREATE TABLE "exercise_prs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exercise_id" integer NOT NULL,
	"pr_type" text NOT NULL,
	"value" numeric(8, 2) NOT NULL,
	"weight_kg" numeric(6, 2),
	"session_id" integer,
	"set_id" integer,
	"achieved_at" timestamp DEFAULT now() NOT NULL,
	"superseded_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "readiness" integer;--> statement-breakpoint
ALTER TABLE "exercise_prs" ADD CONSTRAINT "exercise_prs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_prs" ADD CONSTRAINT "exercise_prs_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_prs" ADD CONSTRAINT "exercise_prs_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_prs" ADD CONSTRAINT "exercise_prs_set_id_workout_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."workout_sets"("id") ON DELETE set null ON UPDATE no action;