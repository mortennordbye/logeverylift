CREATE TABLE "season_races" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"race_date" date NOT NULL,
	"discipline" text NOT NULL,
	"distance" text,
	"distance_meters" integer,
	"priority" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"next_goal" text,
	"replan_flagged_at" timestamp,
	"replan_reason" text,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_cycles" ADD COLUMN "season_id" integer;--> statement-breakpoint
ALTER TABLE "training_cycles" ADD COLUMN "phase_order" integer;--> statement-breakpoint
ALTER TABLE "training_cycles" ADD COLUMN "phase_type" text;--> statement-breakpoint
ALTER TABLE "training_cycles" ADD COLUMN "duration_days" integer;--> statement-breakpoint
ALTER TABLE "season_races" ADD CONSTRAINT "season_races_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_races" ADD CONSTRAINT "season_races_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_season_races_season" ON "season_races" USING btree ("season_id","race_date");--> statement-breakpoint
CREATE INDEX "idx_seasons_user" ON "seasons" USING btree ("user_id","start_date");--> statement-breakpoint
ALTER TABLE "training_cycles" ADD CONSTRAINT "training_cycles_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tc_season" ON "training_cycles" USING btree ("season_id","phase_order");--> statement-breakpoint
-- Data step (docs/plans/seasons.md, section 3; owner decision 4): every live
-- cycle with a race or from the triathlon generator becomes phase 1 of its own
-- season, and its race becomes the season's A race. The cycle keeps its whole
-- curve (phase_type null), its race fields are cleared (one home, D8), and its
-- version bumps so an assistant that read it before the move reads it again.
-- A race distance with no date becomes an A race on the season's last day,
-- with the season flagged so the user or the assistant sets the real date.
-- Each new season, and each moved cycle that already has history, gets a
-- baseline revision of the moved state (writer sync), so the history shows
-- the move as the app's and not as the next writer's change.
DO $$
DECLARE
  c RECORD;
  s_id integer;
  s_start date;
  s_end date;
BEGIN
  FOR c IN
    SELECT * FROM "training_cycles"
    WHERE "deleted_at" IS NULL AND "season_id" IS NULL
      AND ("race_date" IS NOT NULL OR "athlete_level" IS NOT NULL)
    ORDER BY "id"
  LOOP
    s_start := COALESCE(c."start_date", c."created_at"::date);
    s_end := GREATEST(s_start, COALESCE(c."race_date", s_start + (c."duration_weeks" * 7 - 1)));
    INSERT INTO "seasons" ("user_id", "name", "start_date", "end_date", "replan_flagged_at", "replan_reason")
    VALUES (
      c."user_id",
      c."name",
      s_start,
      s_end,
      CASE WHEN c."race_date" IS NULL AND c."race_distance" IS NOT NULL THEN now() END,
      CASE WHEN c."race_date" IS NULL AND c."race_distance" IS NOT NULL
        THEN 'The race had no date when this season was made, so it is set to the season''s last day: check the A race date' END
    )
    RETURNING "id" INTO s_id;
    IF c."race_date" IS NOT NULL OR c."race_distance" IS NOT NULL THEN
      INSERT INTO "season_races" ("season_id", "user_id", "name", "race_date", "discipline", "distance", "priority")
      VALUES (
        s_id,
        c."user_id",
        CASE WHEN c."race_date" IS NULL THEN 'Race (date not set)' ELSE 'Race' END,
        COALESCE(c."race_date", s_end),
        'triathlon',
        c."race_distance",
        'A'
      );
    END IF;
    UPDATE "training_cycles"
    SET "season_id" = s_id, "phase_order" = 1, "phase_type" = NULL,
        "race_date" = NULL, "race_distance" = NULL, "version" = "version" + 1
    WHERE "id" = c."id";

    -- The season's baseline, in the snapshot shape of snapshotSeason.
    INSERT INTO "plan_revisions" ("user_id", "object_type", "object_id", "version", "action", "writer", "reason", "snapshot")
    SELECT s."user_id", 'season', s."id", s."version", 'baseline', 'sync', 'Moved into a season',
      jsonb_build_object(
        'v', 1,
        'season', jsonb_build_object(
          'id', s."id", 'userId', s."user_id", 'name', s."name", 'goal', s."goal",
          'startDate', s."start_date", 'endDate', s."end_date", 'nextGoal', s."next_goal",
          'replanFlaggedAt', to_char(s."replan_flagged_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'replanReason', s."replan_reason",
          'createdAt', to_char(s."created_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ),
        'races', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', r."id", 'seasonId', r."season_id", 'userId', r."user_id", 'name', r."name",
            'raceDate', r."race_date", 'discipline', r."discipline", 'distance', r."distance",
            'distanceMeters', r."distance_meters", 'priority', r."priority",
            'createdAt', to_char(r."created_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ) ORDER BY r."race_date", r."id")
          FROM "season_races" r WHERE r."season_id" = s."id"
        ), '[]'::jsonb),
        'phases', jsonb_build_array(jsonb_build_object('cycleId', c."id", 'name', c."name", 'phaseOrder', 1, 'phaseType', NULL))
      )
    FROM "seasons" s WHERE s."id" = s_id;

    -- The cycle's baseline, in the snapshot shape of snapshotCycle, when it
    -- already has history (one with none gets a baseline on its next write).
    IF EXISTS (SELECT 1 FROM "plan_revisions" p WHERE p."object_type" = 'cycle' AND p."object_id" = c."id") THEN
      INSERT INTO "plan_revisions" ("user_id", "object_type", "object_id", "version", "action", "writer", "reason", "snapshot")
      SELECT t."user_id", 'cycle', t."id", t."version", 'baseline', 'sync', 'Moved into a season',
        jsonb_build_object(
          'v', 1,
          'cycle', jsonb_build_object(
            'id', t."id", 'userId', t."user_id", 'name', t."name", 'durationWeeks', t."duration_weeks",
            'scheduleType', t."schedule_type", 'goal', t."goal", 'athleteLevel', t."athlete_level",
            'lastSyncedWeek', t."last_synced_week", 'adaptationPct', t."adaptation_pct", 'adaptationNote', t."adaptation_note",
            'startDate', t."start_date", 'raceDate', t."race_date", 'raceDistance', t."race_distance",
            'status', t."status", 'endAction', t."end_action", 'endMessage', t."end_message",
            'createdAt', to_char(t."created_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'scheduledStartDate', t."scheduled_start_date", 'seasonId', t."season_id", 'phaseOrder', t."phase_order",
            'phaseType', t."phase_type", 'durationDays', t."duration_days"
          ),
          'slots', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', sl."id", 'trainingCycleId', sl."training_cycle_id", 'dayOfWeek', sl."day_of_week",
              'orderIndex', sl."order_index", 'label', sl."label", 'programId', sl."program_id",
              'notes', sl."notes", 'autoComplete', sl."auto_complete", 'programName', pr."name"
            ) ORDER BY sl."day_of_week", sl."order_index", sl."id")
            FROM "training_cycle_slots" sl LEFT JOIN "programs" pr ON pr."id" = sl."program_id"
            WHERE sl."training_cycle_id" = t."id"
          ), '[]'::jsonb)
        )
      FROM "training_cycles" t WHERE t."id" = c."id";
    END IF;
  END LOOP;
END $$;
