CREATE TABLE "garmin_fuel_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"garmin_activity_id" bigint NOT NULL,
	"carbs_g" integer,
	"fluid_ml" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_garmin_fuel_log" UNIQUE("user_id","garmin_activity_id")
);
--> statement-breakpoint
ALTER TABLE "garmin_fuel_logs" ADD CONSTRAINT "garmin_fuel_logs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;