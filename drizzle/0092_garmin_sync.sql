ALTER TABLE "garmin_connections" RENAME COLUMN "sync_weight" TO "sync_from_garmin";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "field_sources" jsonb DEFAULT '{}'::jsonb NOT NULL;