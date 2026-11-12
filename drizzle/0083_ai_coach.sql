CREATE TABLE "coach_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"entry_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercises" DROP CONSTRAINT "exercises_name_unique";--> statement-breakpoint
ALTER TABLE "plan_revisions" ADD COLUMN "limit_check" jsonb;--> statement-breakpoint
ALTER TABLE "training_cycles" ADD COLUMN "scheduled_start_date" date;--> statement-breakpoint
ALTER TABLE "coach_memory" ADD CONSTRAINT "coach_memory_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_coach_memory_user" ON "coach_memory" USING btree ("user_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_exercise_system_name" ON "exercises" USING btree ("name") WHERE "exercises"."user_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_exercise_custom_name" ON "exercises" USING btree ("user_id","name") WHERE "exercises"."user_id" IS NOT NULL;