CREATE TABLE "plan_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" integer NOT NULL,
	"version" integer NOT NULL,
	"action" text NOT NULL,
	"writer" text NOT NULL,
	"reason" text,
	"change_set_id" text,
	"client_id" text,
	"restored_from_id" integer,
	"snapshot" jsonb NOT NULL,
	"rejected" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "program_exercises" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "training_cycles" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "training_cycles" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_revisions" ADD CONSTRAINT "plan_revisions_restored_from_id_plan_revisions_id_fk" FOREIGN KEY ("restored_from_id") REFERENCES "public"."plan_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_plan_rev_object" ON "plan_revisions" USING btree ("user_id","object_type","object_id","id");--> statement-breakpoint
CREATE INDEX "idx_plan_rev_object_only" ON "plan_revisions" USING btree ("object_type","object_id","id");--> statement-breakpoint
CREATE INDEX "idx_plan_rev_writer" ON "plan_revisions" USING btree ("user_id","writer","created_at");--> statement-breakpoint
CREATE INDEX "idx_plan_rev_change_set" ON "plan_revisions" USING btree ("user_id","change_set_id");