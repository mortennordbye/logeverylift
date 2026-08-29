-- The remaining progression axes, on the exercise.
--
-- progression_mode conflated two questions: which dimension moves, and what
-- scheme is running. These columns separate them, and the engine reads them
-- instead. The mode column is deliberately left in place and left populated
-- (E-12 in docs/progression-revamp-plan.md): a cached client, a share written
-- last month or an export a user is still holding all carry it, and dropping
-- it in the same release as the code that stopped reading it gives those no
-- landing ground. It goes a release later.
ALTER TABLE "program_exercises" ADD COLUMN "progression_advance" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD COLUMN "progression_regress" text DEFAULT 'backoff' NOT NULL;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD COLUMN "progression_backoff_pct" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD COLUMN "progression_backoff_after" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD COLUMN "progression_readiness" text DEFAULT 'hold' NOT NULL;--> statement-breakpoint
ALTER TABLE "program_exercises" ADD COLUMN "progression_config_at" timestamp;--> statement-breakpoint
-- Backfill the advance axis from the mode, per section 10's table. "smart"
-- lands on plain load per D-4: its Epley rep-cut only ever lowered the target,
-- only fired on a near-max set, and is a rough approximation of the rep drop
-- double progression does properly. No exercise becomes double progression
-- here — none of them has a rep range, and inventing one would change the
-- prescription — except the ones already on the mode, which phase 4 seeded.
UPDATE "program_exercises" SET "progression_advance" = CASE "progression_mode"
  WHEN 'none'     THEN 'none'
  WHEN 'weight'   THEN 'load'
  WHEN 'smart'    THEN 'load'
  WHEN 'reps'     THEN 'reps'
  WHEN 'double'   THEN 'double'
  WHEN 'time'     THEN 'duration'
  WHEN 'distance' THEN 'distance'
  ELSE 'manual'
END;--> statement-breakpoint
-- Backfill the regress axis. Load schemes back off, which is what they do
-- today. The rest hold: "time" and "distance" already could not deload, and a
-- rep ladder that cuts the *weight* when the reps stall is progressing one
-- dimension and regressing another, which is not the scheme. That last one is
-- a behaviour change for a weighted rep-ladder exercise and is the only place
-- this migration moves rather than records; section 10 called it "no change",
-- which was wrong about the regress axis.
UPDATE "program_exercises" SET "progression_regress" = CASE
  WHEN "progression_advance" IN ('load', 'double') THEN 'backoff'
  ELSE 'hold'
END;
