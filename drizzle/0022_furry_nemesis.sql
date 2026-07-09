CREATE TABLE "workout_reactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workout_reactions_session_id_user_id_emoji_unique" UNIQUE("session_id","user_id","emoji")
);
--> statement-breakpoint
ALTER TABLE "workout_reactions" ADD CONSTRAINT "workout_reactions_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_reactions" ADD CONSTRAINT "workout_reactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;