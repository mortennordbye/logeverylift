CREATE TABLE "garmin_activity_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"garmin_activity_id" bigint NOT NULL,
	"model_version" integer NOT NULL,
	"sport" text NOT NULL,
	"day" date NOT NULL,
	"load" real,
	"load_method" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_garmin_activity_metrics" UNIQUE("user_id","garmin_activity_id")
);
--> statement-breakpoint
CREATE TABLE "garmin_daily_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"model_version" integer NOT NULL,
	"metrics" jsonb NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_garmin_daily_metrics" UNIQUE("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "garmin_activity_streams" ADD COLUMN "lengths" jsonb;--> statement-breakpoint
ALTER TABLE "garmin_activity_streams" ADD COLUMN "events" jsonb;--> statement-breakpoint
ALTER TABLE "garmin_connections" ADD COLUMN "metrics_computed_at" timestamp;--> statement-breakpoint
ALTER TABLE "garmin_connections" ADD COLUMN "metrics_version" integer;--> statement-breakpoint
ALTER TABLE "garmin_activity_metrics" ADD CONSTRAINT "garmin_activity_metrics_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garmin_daily_metrics" ADD CONSTRAINT "garmin_daily_metrics_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_garmin_activity_metrics_user_day" ON "garmin_activity_metrics" USING btree ("user_id","day");