DROP INDEX IF EXISTS "uniq_ride_garmin_fills_pair";--> statement-breakpoint
ALTER TABLE "ride_garmin_fills" ADD COLUMN IF NOT EXISTS "segment" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_ride_garmin_fills_pair" ON "ride_garmin_fills" USING btree ("ride_id","garmin_activity_id","segment");