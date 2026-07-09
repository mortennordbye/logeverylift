-- Defensive dedupe before the unique index — older databases may have
-- duplicate (session_id, exercise_id, set_number) rows from the
-- double-tap bug that this index is meant to prevent. Keep the
-- newest row per tuple (highest id = most recent insert), drop the
-- rest. Idempotent: a no-op once the constraint is in place.
DELETE FROM "workout_sets" ws
WHERE ws.id < (
  SELECT MAX(id) FROM "workout_sets" ws2
  WHERE ws2.session_id = ws.session_id
    AND ws2.exercise_id = ws.exercise_id
    AND ws2.set_number = ws.set_number
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_wsets_session_exercise_set" ON "workout_sets" USING btree ("session_id","exercise_id","set_number");
