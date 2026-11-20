ALTER TABLE "program_sets" ALTER COLUMN "incline_percent" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "workout_sets" ALTER COLUMN "incline_percent" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN IF NOT EXISTS "belt_kmh" real;--> statement-breakpoint
ALTER TABLE "ride_events" ADD COLUMN IF NOT EXISTS "step_key" text;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "sport" text DEFAULT 'bike' NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "brick_ride_id" integer;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "surface" text;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "end_reason" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "rides" ADD CONSTRAINT "rides_brick_ride_id_rides_id_fk" FOREIGN KEY ("brick_ride_id") REFERENCES "public"."rides"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
