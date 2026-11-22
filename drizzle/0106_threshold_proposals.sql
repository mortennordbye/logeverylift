CREATE TABLE "threshold_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" real NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"threshold_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "threshold_proposals" ADD CONSTRAINT "threshold_proposals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threshold_proposals" ADD CONSTRAINT "threshold_proposals_threshold_id_athlete_thresholds_id_fk" FOREIGN KEY ("threshold_id") REFERENCES "public"."athlete_thresholds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_threshold_proposal_open" ON "threshold_proposals" USING btree ("user_id","kind") WHERE "threshold_proposals"."status" = 'open';--> statement-breakpoint
CREATE INDEX "idx_threshold_proposals_user" ON "threshold_proposals" USING btree ("user_id","status");