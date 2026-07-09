CREATE TABLE "ai_model_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean NOT NULL DEFAULT true,
	"priority" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_configs_model_id_unique" UNIQUE("model_id")
);
--> statement-breakpoint
INSERT INTO "ai_model_configs" ("model_id", "label", "enabled", "priority") VALUES
  ('openrouter/free', 'Free Models Router (auto)', true, 1),
  ('qwen/qwen3-coder:free', 'Qwen3 Coder 480B (free)', true, 2),
  ('nousresearch/hermes-3-llama-3.1-405b:free', 'Hermes 3 405B (free)', true, 3),
  ('meta-llama/llama-3.3-70b-instruct:free', 'Llama 3.3 70B (free)', true, 4)
ON CONFLICT (model_id) DO NOTHING;
