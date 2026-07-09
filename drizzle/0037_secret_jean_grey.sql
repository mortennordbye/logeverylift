ALTER TABLE "program_sets" ADD COLUMN "session_role" text;--> statement-breakpoint
ALTER TABLE "training_cycles" ADD COLUMN "adaptation_pct" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "training_cycles" ADD COLUMN "adaptation_note" text;