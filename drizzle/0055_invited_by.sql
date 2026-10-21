ALTER TABLE "user" ADD COLUMN "invited_by_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Until this release sign-up was invite-only (invite token or an admin creating
-- the account), so every existing non-admin account was let in by an admin.
-- Credit them to the earliest admin. Admins and the shared demo account are
-- left out. No admin: the subquery is NULL and nothing changes.
UPDATE "user"
SET "invited_by_id" = (
  SELECT "id" FROM "user" WHERE "role" = 'admin' ORDER BY "created_at" ASC LIMIT 1
)
WHERE "invited_by_id" IS NULL
  AND "role" IS DISTINCT FROM 'admin'
  AND "email" <> 'demo@logeverylift.app';
