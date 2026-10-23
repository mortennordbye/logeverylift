/**
 * Live check of AI Setup's edit path against real (free) models.
 *
 * For each model: one edit in every output mode the model supports, then one
 * repair turn, forced by sending a deliberately invalid plan as the model's
 * previous answer. Prints mode, time and whether the result validated, and
 * saves each raw response under src/__tests__/fixtures/ai-responses/ so the
 * parser and validator stay pinned to what real models return
 * (src/__tests__/ai-responses.test.ts).
 *
 * Only free models are called (isFreeModel); anything else is refused.
 * Needs the app's env (DATABASE_URL, OPENROUTER_API_KEY and/or GOOGLE_API_KEY),
 * so run it in the app container:
 *
 *   docker compose exec app pnpm ai:smoke                      # enabled models
 *   docker compose exec app pnpm ai:smoke openrouter/free      # specific ids
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { CALL_TIMEOUT_MS, MAX_OUTPUT_TOKENS, planSpec, repairRequest } from "../src/lib/ai-generation";
import { callModel, capabilitiesFor, type LlmMessage, type LlmModel } from "../src/lib/llm";
import { checkEdit, type EditRequest, type GenericProfile } from "../src/lib/utils/ai-edit";
import { aiPlanJsonSchema, parsePlanText, validatePlan, type AiPlan } from "../src/lib/utils/ai-plan";
import { buildEditInput, buildEditMessages } from "../src/lib/utils/ai-prompt";
import { isFreeModel, type OutputMode } from "../src/lib/utils/llm-response";
import { buildTemplatePlan, stripWeights, type TemplateParams } from "../src/lib/utils/plan-templates";

const FIXTURES = join(__dirname, "..", "src", "__tests__", "fixtures", "ai-responses");

const SMOKE_PICKS: TemplateParams = {
  goal: "muscle_gain",
  level: "intermediate",
  daysPerWeek: 3,
  equipment: "dumbbells",
  weeks: 8,
  sessionMinutes: 60,
};
const SMOKE_REQUEST: EditRequest = { chips: ["cardio_finisher"], text: "" };
const SMOKE_PROFILE: GenericProfile = { ageBand: "25_34", gender: "unspecified", goals: ["muscle_gain"], experience: "intermediate" };

type Outcome = { model: string; kind: "edit" | "repair"; mode: OutputMode; seconds: number; valid: boolean; issues: string[]; note?: string };

function check(text: string): { valid: boolean; issues: string[] } {
  const result = validatePlan(parsePlanText(text), { daysPerWeek: SMOKE_PICKS.daysPerWeek, cycleDurationWeeks: SMOKE_PICKS.weeks });
  if (!result.ok) return { valid: false, issues: result.issues };
  const issues = checkEdit(result.plan, SMOKE_PICKS);
  return { valid: issues.length === 0, issues };
}

function save(outcome: Outcome, text: string) {
  mkdirSync(FIXTURES, { recursive: true });
  const file = `${outcome.model.replace(/[^a-z0-9]+/gi, "_")}.${outcome.kind}.${outcome.mode}.json`;
  writeFileSync(join(FIXTURES, file), JSON.stringify({ ...outcome, picks: SMOKE_PICKS, text }, null, 2) + "\n");
}

async function enabledModels(): Promise<LlmModel[]> {
  const { db } = await import("../src/db");
  const { aiModelConfigs } = await import("../src/db/schema");
  const { asc, eq } = await import("drizzle-orm");
  return db
    .select({ modelId: aiModelConfigs.modelId, label: aiModelConfigs.label, provider: aiModelConfigs.provider })
    .from(aiModelConfigs)
    .where(eq(aiModelConfigs.enabled, true))
    .orderBy(asc(aiModelConfigs.priority));
}

async function library() {
  const { db } = await import("../src/db");
  const { exercises } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  return db
    .select({ name: exercises.name, muscleGroup: exercises.muscleGroup, equipment: exercises.equipment, movementPattern: exercises.movementPattern, exerciseType: exercises.exerciseType })
    .from(exercises)
    .where(eq(exercises.isCustom, false));
}

async function smokeModel(model: LlmModel, messagesFor: (delivery: "json" | "tool") => LlmMessage[], base: AiPlan): Promise<Outcome[]> {
  const capabilities = await capabilitiesFor(model);
  if (!capabilities) {
    console.log(`  skipped: not available (no API key, or no longer listed)`);
    return [];
  }
  const spec = planSpec();
  const outcomes: Outcome[] = [];
  const run = async (kind: Outcome["kind"], mode: OutputMode, messages: LlmMessage[]) => {
    const t0 = Date.now();
    const result = await callModel(model, messages, {
      mode,
      spec,
      capabilities,
      temperature: kind === "repair" ? 0.1 : 0.4,
      maxTokens: MAX_OUTPUT_TOKENS,
      timeoutMs: CALL_TIMEOUT_MS,
    });
    const seconds = Math.round((Date.now() - t0) / 1000);
    if (!result.ok) {
      const outcome: Outcome = { model: model.modelId, kind, mode, seconds, valid: false, issues: [], note: `${result.reason}: ${result.detail.slice(0, 120)}` };
      console.log(`  ${kind} ${mode}: ${outcome.note} (${seconds} s)`);
      outcomes.push(outcome);
      return;
    }
    const { valid, issues } = check(result.text);
    const outcome: Outcome = { model: model.modelId, kind, mode, seconds, valid, issues: issues.slice(0, 5), note: result.truncated ? "truncated" : undefined };
    console.log(`  ${kind} ${mode}: ${valid ? "valid" : `invalid (${issues[0]})`} (${seconds} s)`);
    outcomes.push(outcome);
    save(outcome, result.text);
  };

  console.log(`  modes: ${capabilities.modes.join(", ")}`);
  for (const mode of capabilities.modes) {
    await run("edit", mode, messagesFor(mode === "tool" ? "tool" : "json"));
  }

  // Forced repair: an answer with a fourth training day, which the picks don't allow.
  const mode = capabilities.modes[0];
  const delivery = mode === "tool" ? "tool" : "json";
  const broken: AiPlan = JSON.parse(JSON.stringify(base));
  broken.cycle!.slots.push({ prog: broken.programs[0].name, day: 7, idx: null, label: null, auto: false });
  const brokenText = JSON.stringify(broken);
  const { issues } = check(brokenText);
  await run("repair", mode, [
    ...messagesFor(delivery),
    { role: "assistant", content: brokenText },
    { role: "user", content: repairRequest(issues, false, delivery) },
  ]);
  return outcomes;
}

async function main() {
  const ids = process.argv.slice(2);
  const configured = await enabledModels();
  const models: LlmModel[] = ids.length > 0
    ? ids.map((id) => configured.find((m) => m.modelId === id) ?? { modelId: id, label: id, provider: id.includes("/") ? "openrouter" : "google" })
    : configured;

  const base = stripWeights(buildTemplatePlan(SMOKE_PICKS, { bodyWeightKg: 80, sex: null, lifts: {} }));
  const input = buildEditInput(SMOKE_PROFILE, SMOKE_PICKS, SMOKE_REQUEST, await library(), base);
  const schema = aiPlanJsonSchema();
  const messagesFor = (delivery: "json" | "tool") => buildEditMessages(input, schema, delivery);

  const all: Outcome[] = [];
  for (const model of models) {
    console.log(`\n${model.label} (${model.modelId})`);
    if (!isFreeModel(model)) {
      console.log("  refused: not a free model");
      continue;
    }
    all.push(...(await smokeModel(model, messagesFor, base)));
  }

  console.log("\nSummary");
  for (const kind of ["edit", "repair"] as const) {
    const ran = all.filter((o) => o.kind === kind);
    const answered = ran.filter((o) => !o.note || o.note === "truncated");
    console.log(`  ${kind}: ${ran.filter((o) => o.valid).length} valid of ${answered.length} answered (${ran.length} attempted)`);
  }
  const modes = [...new Set(all.filter((o) => o.valid).map((o) => `${o.kind}:${o.mode}`))];
  console.log(`  valid by kind and mode: ${modes.join(", ") || "none"}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
