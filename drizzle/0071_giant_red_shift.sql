CREATE TABLE "garmin_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"garmin_activity_id" bigint NOT NULL,
	"start_time_local" timestamp NOT NULL,
	"activity_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_garmin_activity" UNIQUE("user_id","garmin_activity_id")
);
--> statement-breakpoint
CREATE TABLE "garmin_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_synced_at" timestamp,
	CONSTRAINT "garmin_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "garmin_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"calendar_date" date NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_garmin_day" UNIQUE("user_id","calendar_date","kind")
);
--> statement-breakpoint
CREATE TABLE "garmin_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"range_start" date NOT NULL,
	"range_end" date NOT NULL,
	"status" text NOT NULL,
	"counts" jsonb,
	"error" text,
	"duration_ms" integer
);
--> statement-breakpoint
ALTER TABLE "garmin_activities" ADD CONSTRAINT "garmin_activities_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garmin_connections" ADD CONSTRAINT "garmin_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garmin_days" ADD CONSTRAINT "garmin_days_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garmin_sync_runs" ADD CONSTRAINT "garmin_sync_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_garmin_activities_user_start" ON "garmin_activities" USING btree ("user_id","start_time_local");--> statement-breakpoint
CREATE INDEX "idx_garmin_sync_runs_user" ON "garmin_sync_runs" USING btree ("user_id","started_at");