CREATE TABLE "ai_setup_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"cycle_id" integer,
	"picks" jsonb NOT NULL,
	"edit" jsonb,
	"revision_of" integer,
	"checkin_status" text DEFAULT 'pending' NOT NULL,
	"checkin_issues" jsonb,
	"checkin_note" text,
	"checkin_answered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_setup_plans" ADD CONSTRAINT "ai_setup_plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_setup_plans" ADD CONSTRAINT "ai_setup_plans_cycle_id_training_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."training_cycles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_setup_plans" ADD CONSTRAINT "ai_setup_plans_revision_of_ai_setup_plans_id_fk" FOREIGN KEY ("revision_of") REFERENCES "public"."ai_setup_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_setup_plans_user" ON "ai_setup_plans" USING btree ("user_id");