ALTER TABLE "user" ADD COLUMN "goals" text;--> statement-breakpoint
UPDATE "user" SET "goals" = '["' || "goal" || '"]' WHERE "goal" IS NOT NULL;
