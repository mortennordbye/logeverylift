-- Step 6b of docs/plans/one-program-model.md: the structured workout path is gone
-- from the code (step 6a, deployed first). This drops its data and tables.
-- Cannot be undone: take a database backup before it runs.

-- A dated session that ran only a structured workout (no program) and was never
-- done has nothing left to run: it is removed, as a removed session is.
UPDATE "planned_sessions" ps SET "deleted_at" = now(), "updated_at" = now()
WHERE ps."workout" IS NOT NULL AND ps."program_id" IS NULL AND ps."deleted_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "workout_sessions" ws WHERE ws."planned_session_id" = ps."id" AND ws."is_completed");--> statement-breakpoint
-- The revisions of library workouts go with the library.
DELETE FROM "plan_revisions" WHERE "object_type" = 'workout';--> statement-breakpoint
ALTER TABLE "planned_sessions" DROP CONSTRAINT IF EXISTS "ps_program_or_workout";--> statement-breakpoint
ALTER TABLE "planned_sessions" DROP CONSTRAINT IF EXISTS "planned_sessions_workout_id_workouts_id_fk";--> statement-breakpoint
ALTER TABLE "training_cycle_slots" DROP CONSTRAINT IF EXISTS "training_cycle_slots_workout_id_workouts_id_fk";--> statement-breakpoint
ALTER TABLE "planned_sessions" DROP COLUMN IF EXISTS "workout";--> statement-breakpoint
ALTER TABLE "planned_sessions" DROP COLUMN IF EXISTS "workout_id";--> statement-breakpoint
ALTER TABLE "training_cycle_slots" DROP COLUMN IF EXISTS "workout_id";--> statement-breakpoint
DROP TABLE IF EXISTS "workout_step_results" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workouts" CASCADE;
