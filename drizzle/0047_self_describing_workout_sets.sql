ALTER TABLE "workout_sets" ADD COLUMN "set_type" text DEFAULT 'working' NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "prescribed_working_sets" integer;--> statement-breakpoint
-- Backfill both columns from the plan slot that 0046 resolved onto each row.
-- Best effort by design: it reads the plan as it stands now, not as it stood
-- when the set was logged, so a row whose set was retyped or whose slot gained
-- or lost sets since may be slightly wrong. Accepted — these columns are only
-- ever read across five sessions of history, and rows with no resolved slot
-- keep the "working" default, which is what the overwhelming majority were.
UPDATE "workout_sets" AS ws
SET "set_type" = ps."set_type"
FROM "program_sets" ps
WHERE ps."id" = ws."program_set_id";--> statement-breakpoint
UPDATE "workout_sets" AS ws
SET "prescribed_working_sets" = sub.n
FROM (
  SELECT pe."id" AS pe_id, COUNT(*)::int AS n
  FROM "program_sets" ps
  JOIN "program_exercises" pe ON pe."id" = ps."program_exercise_id"
  WHERE ps."set_type" = 'working'
  GROUP BY pe."id"
) sub
WHERE ws."program_exercise_id" = sub.pe_id;
