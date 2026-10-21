ALTER TABLE "exercise_prs" ADD COLUMN IF NOT EXISTS "superseded_by_id" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "exercise_prs" ADD CONSTRAINT "exercise_prs_superseded_by_id_exercise_prs_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."exercise_prs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
-- Link existing superseded records to the PR that beat them. Detection has
-- always superseded the current record and inserted its successor in the same
-- request, so the successor is the next row of the same user, exercise and
-- type (same ±0.5 kg load for reps_at_weight, same bracket for pace) inserted
-- after it, achieved around the moment it was superseded. The seconds of slack
-- cover clock skew between the app, which stamps superseded_at, and the
-- database, which stamps achieved_at.
UPDATE "exercise_prs" AS old
SET "superseded_by_id" = (
  SELECT n."id"
  FROM "exercise_prs" AS n
  WHERE n."user_id" = old."user_id"
    AND n."exercise_id" = old."exercise_id"
    AND n."pr_type" = old."pr_type"
    AND n."id" > old."id"
    AND n."achieved_at" >= old."superseded_at" - interval '5 seconds'
    AND (old."pr_type" <> 'reps_at_weight'
         OR ABS(CAST(n."weight_kg" AS numeric) - CAST(old."weight_kg" AS numeric)) <= 0.5)
    AND (old."pr_type" <> 'pace' OR n."bracket" = old."bracket")
  ORDER BY n."id"
  LIMIT 1
)
WHERE old."superseded_at" IS NOT NULL
  AND old."superseded_by_id" IS NULL;
