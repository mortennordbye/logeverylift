CREATE TABLE "gyms" (
	"id" serial PRIMARY KEY NOT NULL,
	"osm_ref" text NOT NULL,
	"name" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gyms_osm_ref_unique" UNIQUE("osm_ref")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "primary_gym_id" integer;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_primary_gym_id_gyms_id_fk" FOREIGN KEY ("primary_gym_id") REFERENCES "public"."gyms"("id") ON DELETE set null ON UPDATE no action;