-- Which sets have to clear for a session to count toward the progression gate.
--
-- No backfill statement: the NOT NULL default is the migration. Every existing
-- exercise lands on 'all', which is decision D-3 in docs/progression-revamp-plan.md
-- and a deliberate, visible behaviour change — an exercise whose set 4 kept
-- falling short was previously banking a count on sets 1-3 and bumping anyway.
-- Plans that already drifted apart (62.5 / 62.5 / 60 / 60) are left alone;
-- the rule changes going forward and the first advance levels them up.
ALTER TABLE "program_exercises" ADD COLUMN "progression_scope" text DEFAULT 'all' NOT NULL;
