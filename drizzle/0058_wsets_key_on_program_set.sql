-- A logged set is identified by its program set, no longer by its position.
--
-- Under the old key, un-logging a set after it was dragged to a new position
-- missed its row, and logging it again inserted a second row for the same
-- program set in the same session. Keep the most recent of any such pair (the
-- last write is the state the lifter left it in) so the new unique index can
-- be built. A PR that pointed at a removed duplicate keeps its record with
-- set_id nulled by the existing ON DELETE SET NULL.
DELETE FROM "workout_sets" AS w
USING "workout_sets" AS newer
WHERE w."program_set_id" IS NOT NULL
  AND newer."session_id" = w."session_id"
  AND newer."program_set_id" = w."program_set_id"
  AND newer."id" > w."id";--> statement-breakpoint
DROP INDEX IF EXISTS "uniq_wsets_session_slot_set";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_wsets_session_program_set" ON "workout_sets" USING btree ("session_id","program_set_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_wsets_session_slot_set_unslotted" ON "workout_sets" USING btree ("session_id","program_exercise_id","set_number") WHERE "workout_sets"."program_set_id" IS NULL;
