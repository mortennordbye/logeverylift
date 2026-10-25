ALTER TABLE "user" ADD COLUMN "policy_seen_version" text;--> statement-breakpoint
-- Everyone has already been shown the version they accepted.
UPDATE "user" SET "policy_seen_version" = "terms_version" WHERE "policy_seen_version" IS NULL;
