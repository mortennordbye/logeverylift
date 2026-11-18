CREATE TABLE IF NOT EXISTS "ride_garmin_fills" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"ride_id" integer NOT NULL,
	"garmin_activity_id" bigint NOT NULL,
	"previous" jsonb NOT NULL,
	"declined" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ride_garmin_fills" ADD CONSTRAINT "ride_garmin_fills_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ride_garmin_fills" ADD CONSTRAINT "ride_garmin_fills_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_ride_garmin_fills_pair" ON "ride_garmin_fills" USING btree ("ride_id","garmin_activity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ride_garmin_fills_user" ON "ride_garmin_fills" USING btree ("user_id");
