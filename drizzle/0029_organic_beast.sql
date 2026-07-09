ALTER TABLE "program_sets" ADD COLUMN "peak_distance_meters" integer;--> statement-breakpoint
ALTER TABLE "training_cycles" ADD COLUMN "goal" text DEFAULT 'build' NOT NULL;--> statement-breakpoint
ALTER TABLE "training_cycles" ADD COLUMN "last_synced_week" integer;