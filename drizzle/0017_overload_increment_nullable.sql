-- Remove the default from overload_increment_kg so null means
-- "user has never set a value" (adaptive logic applies) vs any stored
-- value — including 2.5 — meaning the user explicitly chose that increment.
ALTER TABLE "program_exercises" ALTER COLUMN "overload_increment_kg" DROP DEFAULT;
