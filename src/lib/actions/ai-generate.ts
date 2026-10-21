"use server";

import { db } from "@/db";
import { aiGenerations } from "@/db/schema/ai-generations";
import { aiModelConfigs } from "@/db/schema/ai-model-configs";
import { exercisePrs } from "@/db/schema/exercise-prs";
import { exercises } from "@/db/schema/exercises";
import { programs } from "@/db/schema/programs";
import { users } from "@/db/schema/users";
import { getAllExercises } from "@/lib/actions/exercises";
import { env } from "@/lib/env";
import { callModel, capabilitiesFor, type LlmMessage, type LlmModel, type OutputSpec } from "@/lib/llm";
import {
  aiPlanJsonSchema,
  matchLibraryNames,
  parsePlanText,
  toImportPayload,
  validatePlan,
  type AiPlan,
  type AiPlanConstraints,
} from "@/lib/utils/ai-plan";
import {
  buildGenerationInput,
  buildGenerationMessages,
  PLAN_TOOL_NAME,
  type PrData,
  type PromptOptions,
} from "@/lib/utils/ai-prompt";
import { parseUserGoals } from "@/lib/utils/goals";
import { requireSession } from "@/lib/utils/session";
import { and, asc, count, eq, gte, isNull } from "drizzle-orm";

const DAILY_LIMIT = 5;

// Used only when the ai_model_configs table is empty. Free OpenRouter models
// come and go; ones no longer listed are skipped at call time.
const DEFAULT_MODELS: LlmModel[] = [
  { modelId: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Google AI)", provider: "google" },
  { modelId: "openrouter/free", label: "Free Models Router (auto)", provider: "openrouter" },
  { modelId: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super 120B (free)", provider: "openrouter" },
  { modelId: "google/gemma-4-31b-it:free", label: "Gemma 4 31B (free)", provider: "openrouter" },
];

// Whole-request budget across models and retries; the client tells the user
// generation can take a few minutes.
const GENERATION_DEADLINE_MS = 300_000;
const CALL_TIMEOUT_MS = 180_000;
// Not worth starting a call with less than this left.
const MIN_CALL_MS = 20_000;
const MAX_OUTPUT_TOKENS = 24_000;

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

export type RateLimitInfo = {
  generationsToday: number;
  dailyLimit: number;
};

export type AiGenerateResult = {
  json: unknown;
  generationsToday: number;
  dailyLimit: number;
  modelUsed: string;
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const PLAN_SPEC = (): OutputSpec => ({
  name: PLAN_TOOL_NAME,
  description: "Submit the athlete's complete training setup: programs and the cycle that schedules them.",
  schema: aiPlanJsonSchema(),
});

function repairRequest(issues: string[], truncated: boolean, delivery: "json" | "tool"): string {
  const lines = truncated
    ? ["Your reply was cut off before the JSON ended. Return a more compact plan (fewer exercises or sets) so it fits.", ...issues]
    : issues;
  return `That plan can't be imported yet. Fix these problems and return the complete corrected plan:\n${lines
    .map((l) => `- ${l}`)
    .join("\n")}\n${delivery === "tool" ? `Call the "${PLAN_TOOL_NAME}" tool again with the full plan.` : "Reply with only the corrected JSON object."}`;
}

type Attempt = { plan: AiPlan } | { failure: "rate_limited" | "unavailable" | "invalid" };

/**
 * One model: best supported output mode first, downgrading when the provider
 * rejects a mode. A response that fails validation gets one repair turn with
 * the exact problems; after that the caller moves on to the next model.
 */
async function generateWithModel(
  model: LlmModel,
  buildMessages: (delivery: "json" | "tool") => LlmMessage[],
  constraints: AiPlanConstraints,
  deadline: number,
): Promise<Attempt> {
  const capabilities = await capabilitiesFor(model);
  if (!capabilities) {
    console.warn(`[AI] ${model.label} skipped: not available (no API key, or no longer listed by the provider)`);
    return { failure: "unavailable" };
  }
  const spec = PLAN_SPEC();

  for (const mode of capabilities.modes) {
    if (deadline - Date.now() < MIN_CALL_MS) return { failure: "unavailable" };
    const delivery = mode === "tool" ? "tool" : "json";
    const messages = buildMessages(delivery);
    const call = (msgs: LlmMessage[], temperature: number) =>
      callModel(model, msgs, {
        mode,
        spec,
        capabilities,
        temperature,
        maxTokens: MAX_OUTPUT_TOKENS,
        timeoutMs: Math.min(CALL_TIMEOUT_MS, deadline - Date.now()),
      });

    const first = await call(messages, 0.4);
    if (!first.ok) {
      console.warn(`[AI] ${model.label} (${mode}) ${first.reason}: ${first.detail}`);
      if (first.reason === "unsupported") continue;
      return { failure: first.reason };
    }

    const checked = validatePlan(parsePlanText(first.text), constraints);
    if (checked.ok) {
      console.log(`[AI] ${model.label} (${mode}) produced a valid plan`);
      return { plan: checked.plan };
    }
    console.warn(`[AI] ${model.label} (${mode}) invalid plan, repairing: ${checked.issues.slice(0, 3).join(" | ")}`);
    if (deadline - Date.now() < MIN_CALL_MS) return { failure: "invalid" };

    const second = await call(
      [
        ...messages,
        { role: "assistant", content: first.text.slice(0, 40_000) },
        { role: "user", content: repairRequest(checked.issues, first.truncated, delivery) },
      ],
      0.1,
    );
    if (!second.ok) {
      console.warn(`[AI] ${model.label} (${mode}) repair ${second.reason}: ${second.detail}`);
      return { failure: second.reason === "rate_limited" ? "rate_limited" : "invalid" };
    }
    const repaired = validatePlan(parsePlanText(second.text), constraints);
    if (repaired.ok) {
      console.log(`[AI] ${model.label} (${mode}) repaired successfully`);
      return { plan: repaired.plan };
    }
    console.warn(`[AI] ${model.label} (${mode}) repair still invalid: ${repaired.issues.slice(0, 3).join(" | ")}`);
    return { failure: "invalid" };
  }
  return { failure: "unavailable" };
}

async function getEnabledModels(): Promise<LlmModel[]> {
  try {
    const rows = await db
      .select({ modelId: aiModelConfigs.modelId, label: aiModelConfigs.label, provider: aiModelConfigs.provider })
      .from(aiModelConfigs)
      .where(eq(aiModelConfigs.enabled, true))
      .orderBy(asc(aiModelConfigs.priority));
    return rows.length > 0 ? rows : DEFAULT_MODELS;
  } catch {
    return DEFAULT_MODELS;
  }
}

export async function getAiRateLimitStatus(): Promise<ActionResult<RateLimitInfo>> {
  const auth = await requireSession();
  if (auth.user.role === "admin") {
    return { success: true, data: { generationsToday: 0, dailyLimit: Infinity } };
  }
  try {
    const [{ value }] = await db
      .select({ value: count() })
      .from(aiGenerations)
      .where(
        and(
          eq(aiGenerations.userId, auth.user.id),
          gte(aiGenerations.createdAt, startOfToday()),
        ),
      );
    return {
      success: true,
      data: { generationsToday: Number(value), dailyLimit: DAILY_LIMIT },
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function generateWorkoutPlan(
  userDescription: string,
  options: PromptOptions = {},
): Promise<ActionResult<AiGenerateResult>> {
  const auth = await requireSession();
  const userId = auth.user.id;

  const trimmed = userDescription.trim();
  if (!trimmed) return { success: false, error: "Please describe your training goals." };
  if (trimmed.length > 2000)
    return { success: false, error: "Description is too long (max 2000 characters)." };

  const isAdmin = auth.user.role === "admin";

  // Rate limit check (admins are exempt)
  const [{ value: usedToday }] = await db
    .select({ value: count() })
    .from(aiGenerations)
    .where(and(eq(aiGenerations.userId, userId), gte(aiGenerations.createdAt, startOfToday())));

  const generationsToday = Number(usedToday);
  if (!isAdmin && generationsToday >= DAILY_LIMIT) {
    return {
      success: false,
      error: `You've used all ${DAILY_LIMIT} automatic generations for today. Try again tomorrow, or use the manual flow below.`,
    };
  }

  // Fetch user profile, exercises, PRs, enabled models in parallel
  const [exerciseResult, user, rawPrs, userPrograms, models] = await Promise.all([
    getAllExercises(),
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db
      .select({ exerciseName: exercises.name, prType: exercisePrs.prType, value: exercisePrs.value })
      .from(exercisePrs)
      .innerJoin(exercises, eq(exercisePrs.exerciseId, exercises.id))
      .where(and(eq(exercisePrs.userId, userId), isNull(exercisePrs.supersededAt))),
    db.select({ name: programs.name }).from(programs).where(eq(programs.userId, userId)),
    getEnabledModels(),
  ]);

  if (models.length === 0) {
    return { success: false, error: "No AI models are enabled. Ask an admin to enable at least one model." };
  }

  // Deduplicate: one entry per exercise, preferring estimated_1rm over weight
  const prMap = new Map<string, PrData>();
  for (const pr of rawPrs) {
    const entry = prMap.get(pr.exerciseName) ?? { exerciseName: pr.exerciseName };
    if (pr.prType === "estimated_1rm") entry.estimated1rm = Math.round(Number(pr.value));
    else if (pr.prType === "weight" && !entry.estimated1rm) entry.maxWeight = Math.round(Number(pr.value));
    prMap.set(pr.exerciseName, entry);
  }
  const prs = Array.from(prMap.values());

  const exerciseList = exerciseResult.success ? exerciseResult.data : [];
  const userProfile = {
    gender: user?.gender ?? null,
    birthYear: user?.birthYear ?? null,
    heightCm: user?.heightCm ?? null,
    weightKg: user?.weightKg ?? null,
    goals: parseUserGoals(user?.goals),
    experienceLevel: user?.experienceLevel ?? null,
  };

  const existingProgramNames = userPrograms.map((p) => p.name);

  if (!env.OPENROUTER_API_KEY && !env.GOOGLE_API_KEY) {
    return { success: false, error: "AI generation is not configured on this server." };
  }

  const input = buildGenerationInput(trimmed, userProfile, exerciseList, prs, existingProgramNames, options);
  const constraints: AiPlanConstraints = {
    daysPerWeek: options.daysPerWeek,
    cycleDurationWeeks: options.cycleDurationWeeks,
  };
  const schema = aiPlanJsonSchema();
  const buildMessages = (delivery: "json" | "tool") => buildGenerationMessages(input, options, schema, delivery);
  const deadline = Date.now() + GENERATION_DEADLINE_MS;

  let plan: AiPlan | null = null;
  let modelUsed = "";
  const failures: string[] = [];

  for (const model of models) {
    if (deadline - Date.now() < MIN_CALL_MS) break;
    const attempt = await generateWithModel(model, buildMessages, constraints, deadline);
    if ("plan" in attempt) {
      plan = attempt.plan;
      modelUsed = model.modelId;
      break;
    }
    failures.push(attempt.failure);
  }

  if (plan === null) {
    const allBusy = failures.length > 0 && failures.every((f) => f === "rate_limited");
    return {
      success: false,
      error: allBusy
        ? "The AI models are busy right now. Please try again in a minute."
        : "The AI couldn't produce a usable plan right now. Please try again, or use the manual flow below.",
    };
  }

  const parsed = toImportPayload(matchLibraryNames(plan, exerciseList.map((e) => e.name)));

  // Record usage only after a plan that passed validation
  try {
    await db.insert(aiGenerations).values({ userId });
  } catch (err) {
    console.error("[generateWorkoutPlan] record_failed", err);
  }

  console.log(`[AI] Generation successful via ${modelUsed}`);

  return {
    success: true,
    data: { json: parsed, generationsToday: generationsToday + 1, dailyLimit: DAILY_LIMIT, modelUsed },
  };
}
