ALTER TABLE "workout_sessions" DROP CONSTRAINT "workout_sessions_program_id_programs_id_fk";
--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;