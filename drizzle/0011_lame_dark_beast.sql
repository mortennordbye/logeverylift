CREATE INDEX "idx_pr_user_exercise_superseded" ON "exercise_prs" USING btree ("user_id","exercise_id","superseded_at");--> statement-breakpoint
CREATE INDEX "idx_ws_user_completed_start" ON "workout_sessions" USING btree ("user_id","is_completed","start_time");--> statement-breakpoint
CREATE INDEX "idx_wsets_session" ON "workout_sets" USING btree ("session_id");