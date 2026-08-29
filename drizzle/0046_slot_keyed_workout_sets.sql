DROP INDEX "uniq_wsets_session_exercise_set";--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "program_exercise_id" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "program_set_id" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_program_exercise_id_program_exercises_id_fk" FOREIGN KEY ("program_exercise_id") REFERENCES "public"."program_exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_program_set_id_program_sets_id_fk" FOREIGN KEY ("program_set_id") REFERENCES "public"."program_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill the plan slot onto existing rows. Best effort: the slot is re-derived
-- from the session's program by exercise, taking the lowest program_exercises id
-- when the program holds that exercise more than once. That is exactly the
-- ambiguity the new columns exist to remove, but it reproduces the behaviour
-- those rows were written under rather than inventing a new one.
--
-- Cannot collide with the unique index created below: the resolved slot is a
-- function of (session.program_id, exercise_id), so two rows would have to share
-- (session_id, exercise_id, set_number) — which "uniq_wsets_session_exercise_set"
-- has forbidden since migration 0026 (which deduped the pre-existing rows first).
UPDATE "workout_sets" AS ws
SET "program_exercise_id" = sub.pe_id,
    "program_set_id" = sub.ps_id
FROM (
  SELECT
    ws2."id" AS ws_id,
    pe."id"  AS pe_id,
    ps."id"  AS ps_id
  FROM "workout_sets" ws2
  JOIN "workout_sessions" s ON s."id" = ws2."session_id"
  JOIN LATERAL (
    SELECT pe2."id"
    FROM "program_exercises" pe2
    WHERE pe2."program_id" = s."program_id"
      AND pe2."exercise_id" = ws2."exercise_id"
    ORDER BY pe2."id"
    LIMIT 1
  ) pe ON true
  LEFT JOIN LATERAL (
    SELECT ps2."id"
    FROM "program_sets" ps2
    WHERE ps2."program_exercise_id" = pe."id"
      AND ps2."set_number" = ws2."set_number"
    ORDER BY ps2."id"
    LIMIT 1
  ) ps ON true
  WHERE s."program_id" IS NOT NULL
) sub
WHERE ws."id" = sub.ws_id;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_wsets_session_slot_set" ON "workout_sets" USING btree ("session_id","program_exercise_id","set_number");--> statement-breakpoint
CREATE INDEX "idx_wsets_session_exercise" ON "workout_sets" USING btree ("session_id","exercise_id");
