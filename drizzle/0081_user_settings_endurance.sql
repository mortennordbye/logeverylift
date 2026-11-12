ALTER TABLE "user" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "distance_unit" text DEFAULT 'km' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "swim_unit" text DEFAULT 'm' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "endurance_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The endurance switch starts on for admins and for every user who already has a
-- cycle from the triathlon generator (the only writer of athlete_level), so no
-- one loses a feature they use (owner decision, docs/plans/foundations.md).
UPDATE "user" SET "endurance_enabled" = true
WHERE "role" = 'admin'
   OR "id" IN (SELECT "user_id" FROM "training_cycles" WHERE "athlete_level" IS NOT NULL);
