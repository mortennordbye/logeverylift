ALTER TABLE "user" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "terms_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "health_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ai_consent_at" timestamp;