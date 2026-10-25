-- 0022 created workout_reactions, but its journal timestamp is older than
-- 0021's, so the migrator skipped it on any database that had already run
-- 0021 (production). Fresh databases got it. Create it where it is missing.
CREATE TABLE IF NOT EXISTS "workout_reactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workout_reactions_session_id_user_id_emoji_unique" UNIQUE("session_id","user_id","emoji")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workout_reactions" ADD CONSTRAINT "workout_reactions_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workout_reactions" ADD CONSTRAINT "workout_reactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
