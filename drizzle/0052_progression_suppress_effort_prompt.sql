-- Per-exercise opt-out of the post-set effort prompt ("Last set — how much
-- was left?"). Independent of whether a targetRir cap is prescribed: some
-- exercises want the cap for grading but the lifter never wants to be asked
-- about it — pure logging, no progression engagement. Does not stamp
-- progression_config_at: it changes what the lifter is asked, not what
-- counts as a clear, same as progression_apply_to_plan.
ALTER TABLE "program_exercises" ADD COLUMN "progression_suppress_effort_prompt" boolean DEFAULT false NOT NULL;
