CREATE TABLE "exercise_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exercise_id" integer NOT NULL,
	"note" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_exercise_note_user_exercise" UNIQUE("user_id","exercise_id")
);
--> statement-breakpoint
ALTER TABLE "exercise_notes" ADD CONSTRAINT "exercise_notes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_notes" ADD CONSTRAINT "exercise_notes_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;