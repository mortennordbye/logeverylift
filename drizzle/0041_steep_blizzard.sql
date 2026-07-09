CREATE TABLE "dismissed_makeups" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_dismissed_makeup" UNIQUE("user_id","date")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "missed_workouts_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "intended_date" date;--> statement-breakpoint
ALTER TABLE "dismissed_makeups" ADD CONSTRAINT "dismissed_makeups_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dismissed_makeup_user" ON "dismissed_makeups" USING btree ("user_id");