ALTER TABLE "user" ADD COLUMN "friend_code" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_friend_code_unique" UNIQUE("friend_code");