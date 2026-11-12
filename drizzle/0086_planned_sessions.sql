CREATE TABLE "planned_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"cycle_id" integer NOT NULL,
	"slot_id" integer,
	"template_date" date,
	"rotation_position" integer,
	"date" date,
	"position" integer DEFAULT 1 NOT NULL,
	"program_id" integer,
	"label" text,
	"notes" text,
	"auto_complete" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"skip_reason" text,
	"touched_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_cycle_slots" DROP CONSTRAINT "uniq_cycle_day";--> statement-breakpoint
DROP INDEX "uniq_ws_auto_day";--> statement-breakpoint
ALTER TABLE "training_cycle_slots" ADD COLUMN "day_slot" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "training_cycles" ADD COLUMN "sessions_generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD COLUMN "planned_session_id" integer;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_cycle_id_training_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."training_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_sessions" ADD CONSTRAINT "planned_sessions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ps_user_date" ON "planned_sessions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "idx_ps_cycle_date" ON "planned_sessions" USING btree ("cycle_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_ps_template" ON "planned_sessions" USING btree ("cycle_id","slot_id","template_date") WHERE "planned_sessions"."deleted_at" IS NULL AND "planned_sessions"."template_date" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_ps_rotation" ON "planned_sessions" USING btree ("cycle_id","rotation_position") WHERE "planned_sessions"."deleted_at" IS NULL AND "planned_sessions"."rotation_position" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_planned_session_id_planned_sessions_id_fk" FOREIGN KEY ("planned_session_id") REFERENCES "public"."planned_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ws_planned" ON "workout_sessions" USING btree ("planned_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_ws_auto_planned" ON "workout_sessions" USING btree ("user_id","planned_session_id") WHERE "workout_sessions"."source" = 'auto' AND "workout_sessions"."planned_session_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_ws_auto_day" ON "workout_sessions" USING btree ("user_id","program_id","date") WHERE "workout_sessions"."source" = 'auto' AND "workout_sessions"."planned_session_id" IS NULL;--> statement-breakpoint
ALTER TABLE "training_cycle_slots" ADD CONSTRAINT "uniq_cycle_day" UNIQUE("training_cycle_id","day_of_week","day_slot");