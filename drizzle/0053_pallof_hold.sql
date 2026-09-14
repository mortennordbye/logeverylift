-- Pallof Hold: the timed variant of Pallof Press.
--
-- is_timed lives on the shared exercise row, and Pallof Press is pressed for
-- reps in existing programs, so a timed hold needs its own row rather than a
-- flip of that one. Prod never runs the seed, so the row is added here.
-- Idempotent: a database seeded after scripts/seed.ts gained the row already
-- has it, and the name is unique.
INSERT INTO "exercises" ("name", "category", "is_custom", "is_timed", "body_area", "muscle_group", "equipment", "movement_pattern", "exercise_type")
VALUES ('Pallof Hold', 'strength', false, true, 'core', 'abs', 'cable', 'isometric', 'isometric')
ON CONFLICT ("name") DO NOTHING;
