-- Change rest_time_seconds default from 60 to 0.
-- Also reset any existing rows that have the old automatic default of 60
-- (sets that were created before this fix and never had rest intentionally configured).
ALTER TABLE "program_sets" ALTER COLUMN "rest_time_seconds" SET DEFAULT 0;--> statement-breakpoint
UPDATE "program_sets" SET "rest_time_seconds" = 0 WHERE "rest_time_seconds" = 60;
