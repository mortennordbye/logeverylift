CREATE TABLE "invite_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"created_by" text NOT NULL,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invite_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "invite_token" ADD CONSTRAINT "invite_token_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;