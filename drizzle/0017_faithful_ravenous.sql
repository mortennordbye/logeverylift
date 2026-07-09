ALTER TABLE "program_exercises" ALTER COLUMN "overload_increment_kg" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "program_sets" ALTER COLUMN "rest_time_seconds" SET DEFAULT 0;--> statement-breakpoint
-- Reset rows that still carry the old schema default (2.50) back to NULL so they
-- continue receiving adaptive increment logic. Rows where the user explicitly
-- saved a non-default value are unaffected because they differ from '2.50'.
UPDATE "program_exercises" SET "overload_increment_kg" = NULL WHERE "overload_increment_kg" = '2.50';