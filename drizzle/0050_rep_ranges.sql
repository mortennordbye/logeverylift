-- Rep range for double progression, on the set.
--
-- Both nullable and both left null by the migration: every existing set keeps
-- a fixed target, which is what it has always had. A range only means anything
-- once an exercise is set to double progression, and nothing can set that yet
-- (the preset picker is phase 5 of docs/progression-revamp-plan.md), so this
-- changes no behaviour on its own.
ALTER TABLE "program_sets" ADD COLUMN "rep_range_min" integer;--> statement-breakpoint
ALTER TABLE "program_sets" ADD COLUMN "rep_range_max" integer;