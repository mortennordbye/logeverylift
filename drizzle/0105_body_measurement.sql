CREATE TABLE "body_measurement" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"site" text NOT NULL,
	"side" text NOT NULL,
	"value_cm" real NOT NULL,
	"measured_on" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "body_measurement" ADD CONSTRAINT "body_measurement_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_body_measurement_day" ON "body_measurement" USING btree ("user_id","site","side","measured_on");