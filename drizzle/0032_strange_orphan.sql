-- Preserve goal data before dropping the legacy single-value column: backfill the
-- goals JSON array from `goal` for any user that doesn't have a goals array yet.
UPDATE "user"
SET "goals" = '["' || "goal" || '"]'
WHERE "goal" IS NOT NULL
  AND ("goals" IS NULL OR "goals" = '' OR "goals" = '[]')
  AND "goal" IN ('strength','muscle_gain','weight_loss','endurance','general_fitness');
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "goal";
