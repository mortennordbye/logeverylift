CREATE TABLE "fuel_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workout_session_id" integer,
	"garmin_activity_id" bigint,
	"duration_s" integer,
	"carbs_g" integer,
	"fluid_ml" integer,
	"sodium_mg" integer,
	"caffeine_mg" integer,
	"gi_score" integer,
	"items" jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_logs_one_link" CHECK (("fuel_logs"."workout_session_id" IS NULL) <> ("fuel_logs"."garmin_activity_id" IS NULL)),
	CONSTRAINT "fuel_logs_gi_range" CHECK ("fuel_logs"."gi_score" IS NULL OR ("fuel_logs"."gi_score" >= 0 AND "fuel_logs"."gi_score" <= 10))
);
--> statement-breakpoint
CREATE TABLE "fuel_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"carbs_g" real,
	"sodium_mg" integer,
	"caffeine_mg" integer,
	"fluid_ml" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"season_race_id" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sweat_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tested_on" date NOT NULL,
	"duration_s" integer NOT NULL,
	"pre_kg" real NOT NULL,
	"post_kg" real NOT NULL,
	"fluid_ml" integer NOT NULL,
	"urine_ml" integer,
	"temperature_c" real,
	"sport" text,
	"sweat_sodium_mg_l" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_workout_session_id_workout_sessions_id_fk" FOREIGN KEY ("workout_session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_products" ADD CONSTRAINT "fuel_products_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_plans" ADD CONSTRAINT "race_plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_plans" ADD CONSTRAINT "race_plans_season_race_id_season_races_id_fk" FOREIGN KEY ("season_race_id") REFERENCES "public"."season_races"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sweat_tests" ADD CONSTRAINT "sweat_tests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_fuel_log_session" ON "fuel_logs" USING btree ("user_id","workout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_fuel_log_garmin" ON "fuel_logs" USING btree ("user_id","garmin_activity_id");--> statement-breakpoint
CREATE INDEX "idx_fuel_products_user" ON "fuel_products" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_race_plan_race" ON "race_plans" USING btree ("season_race_id");--> statement-breakpoint
CREATE INDEX "idx_sweat_tests_user" ON "sweat_tests" USING btree ("user_id","tested_on");--> statement-breakpoint
-- Copy the Garmin-only fuel logs into fuel_logs (docs/plans/nutrition-and-race-day.md, 9).
-- garmin_fuel_logs stays one release, unread, for rollback.
INSERT INTO "fuel_logs" ("user_id", "garmin_activity_id", "duration_s", "carbs_g", "fluid_ml", "created_at", "updated_at")
SELECT g."user_id", g."garmin_activity_id", CASE WHEN jsonb_typeof(a."data"->'duration') = 'number' THEN round((a."data"->>'duration')::float8)::integer END, g."carbs_g", g."fluid_ml", g."updated_at", g."updated_at"
FROM "garmin_fuel_logs" g
LEFT JOIN "garmin_activities" a ON a."user_id" = g."user_id" AND a."garmin_activity_id" = g."garmin_activity_id"
ON CONFLICT DO NOTHING;
