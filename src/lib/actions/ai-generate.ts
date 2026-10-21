"use server";

import { db } from "@/db";
import { aiGenerations } from "@/db/schema/ai-generations";
import { aiModelConfigs } from "@/db/schema/ai-model-configs";
import { aiPlanCache } from "@/db/schema/ai-plan-cache";
import { exercisePrs } from "@/db/schema/exercise-prs";
import { exercises } from "@/db/schema/exercises";
import { programs } from "@/db/schema/programs";
import { users } from "@/db/schema/users";
import { getAllExercises } from "@/lib/actions/exercises";
import { env } from "@/lib/env";
import { callModel, capabilitiesFor, type LlmMessage, type LlmModel, type OutputSpec } from "@/lib/llm";
import { checkEdit, editCacheMaterial, genericProfile, normalizeEditRequest } from "@/lib/utils/ai-edit";
import {
  aiPlanJsonSchema,
  matchLibraryNames,
  parsePlanText,
  uniqueProgramNames,
  validatePlan,
  type AiPlan,
  type AiPlanConstraints,
} from "@/lib/utils/ai-plan";
import { buildEditInput, buildEditMessages, PLAN_TOOL_NAME } from "@/lib/utils/ai-prompt";
import { isFreeModel } from "@/lib/utils/llm-response";
import { parseUserGoals } from "@/lib/utils/goals";
import {
  buildTemplatePlan,
  fillStartingWeights,
  stripWeights,
  TEMPLATE_VERSION,
  type TemplateAthlete,
} from "@/lib/utils/plan-templates";
import { requireSession } from "@/lib/utils/session";
import { aiEditSchema } from "@/lib/validators/ai-setup";
import { createHash } from "crypto";
import { and, asc, count, eq, gte, isNull, sql } from "drizzle-orm";

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
// Valid edits on free models take about a minute; past two, move to the next model.
const CALL_TIMEOUT_MS = 120_000;
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

export type AiEditResult = {
  /** The edited plan, with this athlete's starting weights and unique program names. */
  plan: AiPlan;
  /** True when a saved result was reused and no model was called. */
  fromCache: boolean;
  generationsToday: number;
  dailyLimit: number;
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
  extraChecks: (plan: AiPlan) => string[],
  deadline: number,
): Promise<Attempt> {
  const check = (text: string) => {
    const result = validatePlan(parsePlanText(text), constraints);
    if (!result.ok) return result;
    const issues = extraChecks(result.plan);
    return issues.length === 0 ? result : { ok: false as const, issues };
  };
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

    const checked = check(first.text);
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
    const repaired = check(second.text);
    if (repaired.ok) {
      console.log(`[AI] ${model.label} (${mode}) repaired successfully`);
      return { plan: repaired.plan };
    }
    console.warn(`[AI] ${model.label} (${mode}) repair still invalid: ${repaired.issues.slice(0, 3).join(" | ")}`);
    return { failure: "invalid" };
  }
  return { failure: "unavailable" };
}

/** Enabled models in priority order, free ones only (isFreeModel). */
async function getEnabledModels(): Promise<LlmModel[]> {
  let models = DEFAULT_MODELS;
  try {
    const rows = await db
      .select({ modelId: aiModelConfigs.modelId, label: aiModelConfigs.label, provider: aiModelConfigs.provider })
      .from(aiModelConfigs)
      .where(eq(aiModelConfigs.enabled, true))
      .orderBy(asc(aiModelConfigs.priority));
    if (rows.length > 0) models = rows;
  } catch (err) {
    console.error("[getEnabledModels] failed, using defaults", err);
  }
  const free = models.filter(isFreeModel);
  for (const model of models) {
    if (!isFreeModel(model)) console.warn(`[AI] ${model.modelId} skipped: not a free model`);
  }
  return free;
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

async function generationsToday(userId: string): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(aiGenerations)
    .where(and(eq(aiGenerations.userId, userId), gte(aiGenerations.createdAt, startOfToday())));
  return Number(value);
}

/**
 * Edits the plan built from `picks` as the request asks, on free models only.
 * A request with the same picks, generic profile and normalized wording
 * reuses the saved result without calling a model and without counting
 * toward the daily limit; a model call counts only when it returns a valid plan.
 */
export async function editPlanWithAi(data: unknown): Promise<ActionResult<AiEditResult>> {
  const auth = await requireSession();
  const userId = auth.user.id;
  const parsed = aiEditSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { picks } = parsed.data;
  const request = normalizeEditRequest(parsed.data.request);
  const isAdmin = auth.user.role === "admin";

  try {
    const [user, rawPrs, userPrograms, exerciseResult, usedToday] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, userId) }),
      db
        .select({ exerciseName: exercises.name, prType: exercisePrs.prType, value: exercisePrs.value })
        .from(exercisePrs)
        .innerJoin(exercises, eq(exercisePrs.exerciseId, exercises.id))
        .where(and(eq(exercisePrs.userId, userId), isNull(exercisePrs.supersededAt))),
      db.select({ name: programs.name }).from(programs).where(eq(programs.userId, userId)),
      getAllExercises(),
      generationsToday(userId),
    ]);
    const dailyLimit = isAdmin ? Infinity : DAILY_LIMIT;

    // Estimated 1RM per exercise, else the best weight: the template builder's input.
    const lifts: Record<string, number> = {};
    for (const pr of rawPrs) {
      if (pr.prType === "estimated_1rm") lifts[pr.exerciseName] = Math.round(Number(pr.value));
      else if (pr.prType === "weight" && !(pr.exerciseName in lifts)) lifts[pr.exerciseName] = Math.round(Number(pr.value));
    }
    const athlete: TemplateAthlete = { bodyWeightKg: user?.weightKg ?? null, sex: user?.gender ?? null, lifts };
    const profile = genericProfile(
      {
        birthYear: user?.birthYear ?? null,
        gender: user?.gender ?? null,
        goals: parseUserGoals(user?.goals),
        experienceLevel: user?.experienceLevel ?? null,
      },
      new Date().getFullYear(),
    );
    const key = createHash("sha256").update(editCacheMaterial(profile, picks, request)).digest("hex");
    const constraints: AiPlanConstraints = { daysPerWeek: picks.daysPerWeek, cycleDurationWeeks: picks.weeks };

    let edited: AiPlan | null = null;
    let fromCache = false;
    let used = usedToday;

    const [cached] = await db.select({ plan: aiPlanCache.plan }).from(aiPlanCache).where(eq(aiPlanCache.key, key));
    if (cached) {
      const check = validatePlan(cached.plan, constraints);
      if (check.ok) {
        edited = check.plan;
        fromCache = true;
        await db
          .update(aiPlanCache)
          .set({ hits: sql`${aiPlanCache.hits} + 1`, lastHitAt: new Date() })
          .where(eq(aiPlanCache.key, key));
      } else {
        console.error("[editPlanWithAi] cached_plan_invalid", { key: key.slice(0, 12) });
      }
    }

    if (!edited) {
      if (!isAdmin && usedToday >= DAILY_LIMIT) {
        return {
          success: false,
          error: `You've used all ${DAILY_LIMIT} AI edits for today. Saved edits still work, and the plan builder is always free.`,
        };
      }
      if (!env.OPENROUTER_API_KEY && !env.GOOGLE_API_KEY) {
        return { success: false, error: "AI editing is not configured on this server." };
      }
      const models = await getEnabledModels();
      if (models.length === 0) {
        return { success: false, error: "No free AI models are enabled. Ask an admin to enable one." };
      }

      const base = stripWeights(buildTemplatePlan(picks, athlete));
      const library = exerciseResult.success ? exerciseResult.data : [];
      const input = buildEditInput(profile, picks, request, library, base);
      const schema = aiPlanJsonSchema();
      const buildMessages = (delivery: "json" | "tool") => buildEditMessages(input, schema, delivery);
      const deadline = Date.now() + GENERATION_DEADLINE_MS;
      const failures: string[] = [];
      let modelUsed = "";

      for (const model of models) {
        if (deadline - Date.now() < MIN_CALL_MS) break;
        const attempt = await generateWithModel(
          model,
          buildMessages,
          constraints,
          (plan) => checkEdit(plan, picks.equipment),
          deadline,
        );
        if ("plan" in attempt) {
          edited = stripWeights(attempt.plan);
          modelUsed = model.modelId;
          break;
        }
        failures.push(attempt.failure);
      }

      if (!edited) {
        // Only blame the request when a model answered and the answer didn't hold up.
        return {
          success: false,
          error: failures.includes("invalid")
            ? "The AI couldn't make that change in a way that fits your picks. Try again, or rephrase the request."
            : "The free AI models are busy or unavailable right now. Please try again in a few minutes.",
        };
      }

      await db
        .insert(aiPlanCache)
        .values({ key, templateVersion: TEMPLATE_VERSION, picks: { ...picks, profile }, edit: request, plan: edited, modelUsed })
        .onConflictDoNothing();
      await db.insert(aiGenerations).values({ userId });
      used += 1;
      console.log(`[AI] edit via ${modelUsed}`);
    }

    const libraryNames = exerciseResult.success ? exerciseResult.data.map((e) => e.name) : [];
    const plan = uniqueProgramNames(
      fillStartingWeights(matchLibraryNames(edited, libraryNames), picks.level, athlete),
      userPrograms.map((p) => p.name),
    );
    return { success: true, data: { plan, fromCache, generationsToday: used, dailyLimit } };
  } catch (err) {
    console.error("[editPlanWithAi] failed", err);
    return { success: false, error: "Something went wrong while editing the plan. Please try again." };
  }
}
