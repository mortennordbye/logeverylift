ALTER TABLE "exercises" ADD COLUMN "exercise_type" text;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD COLUMN "exercise_type" text;--> statement-breakpoint
-- Backfill the intrinsic exercise type from movement_pattern. Idempotent: only
-- touches rows not yet classified. Cardio / unpatterned rows are left null.
UPDATE "exercises" SET "exercise_type" = CASE
  WHEN "movement_pattern" IN ('squat', 'hinge', 'push', 'pull', 'carry') THEN 'compound'
  WHEN "movement_pattern" = 'isometric' THEN 'isometric'
  WHEN "movement_pattern" = 'rotation' THEN 'isolation'
  ELSE NULL
END
WHERE "exercise_type" IS NULL AND "movement_pattern" IS NOT NULL AND "movement_pattern" <> 'cardio';