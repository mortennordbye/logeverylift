CREATE TABLE "athlete_injuries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"area" text NOT NULL,
	"side" text,
	"description" text NOT NULL,
	"avoid" text,
	"status" text NOT NULL,
	"started_on" date,
	"ended_on" date,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athlete_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endurance_level" text,
	"available_days" integer[],
	"hours_per_week" real,
	"longest_day_minutes" integer,
	"long_day" integer,
	"strength_goal" text,
	"interview_completed_at" timestamp,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athlete_thresholds" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" real NOT NULL,
	"measured_on" date NOT NULL,
	"source" text NOT NULL,
	"protocol" text,
	"test_data" jsonb,
	"notes" text,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "athlete_injuries" ADD CONSTRAINT "athlete_injuries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_profiles" ADD CONSTRAINT "athlete_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_thresholds" ADD CONSTRAINT "athlete_thresholds_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_athlete_injuries_user" ON "athlete_injuries" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_athlete_profile_user" ON "athlete_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_athlete_thresholds_user" ON "athlete_thresholds" USING btree ("user_id","kind","measured_on");