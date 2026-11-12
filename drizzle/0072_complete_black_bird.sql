CREATE TABLE "garmin_activity_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"garmin_activity_id" bigint NOT NULL,
	"zip" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_garmin_activity_file" UNIQUE("user_id","garmin_activity_id")
);
--> statement-breakpoint
CREATE TABLE "garmin_activity_streams" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"garmin_activity_id" bigint NOT NULL,
	"parser_version" integer NOT NULL,
	"sport" text,
	"sub_sport" text,
	"streams" jsonb NOT NULL,
	"laps" jsonb NOT NULL,
	"sets" jsonb NOT NULL,
	"time_in_zone" jsonb NOT NULL,
	"session" jsonb,
	"parsed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_garmin_activity_stream" UNIQUE("user_id","garmin_activity_id")
);
--> statement-breakpoint
ALTER TABLE "garmin_activities" ADD COLUMN "detail" jsonb;--> statement-breakpoint
ALTER TABLE "garmin_activities" ADD COLUMN "workouts" jsonb;--> statement-breakpoint
ALTER TABLE "garmin_activities" ADD COLUMN "files_fetched_at" timestamp;--> statement-breakpoint
ALTER TABLE "garmin_activities" ADD COLUMN "files_error" text;--> statement-breakpoint
ALTER TABLE "garmin_connections" ADD COLUMN "history_cursor" date;--> statement-breakpoint
ALTER TABLE "garmin_connections" ADD COLUMN "history_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "garmin_connections" ADD COLUMN "history_empty_chunks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "garmin_connections" ADD COLUMN "recent_detail_at" timestamp;--> statement-breakpoint
ALTER TABLE "garmin_connections" ADD COLUMN "lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "garmin_connections" ADD COLUMN "paused_until" timestamp;--> statement-breakpoint
ALTER TABLE "garmin_sync_runs" ADD COLUMN "trigger" text DEFAULT 'sync' NOT NULL;--> statement-breakpoint
ALTER TABLE "garmin_activity_files" ADD CONSTRAINT "garmin_activity_files_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garmin_activity_streams" ADD CONSTRAINT "garmin_activity_streams_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;