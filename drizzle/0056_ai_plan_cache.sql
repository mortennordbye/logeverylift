CREATE TABLE "ai_plan_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"template_version" integer NOT NULL,
	"picks" jsonb NOT NULL,
	"edit" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"model_used" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_hit_at" timestamp
);
