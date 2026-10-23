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
import { GENERATION_DEADLINE_MS, generateWithModel, MIN_CALL_MS } from "@/lib/ai-generation";
import type { LlmModel } from "@/lib/llm";
import { checkEdit, editCacheMaterial, genericProfile, normalizeEditRequest } from "@/lib/utils/ai-edit";
import {
  aiPlanJsonSchema,
  matchLibraryNames,
  uniqueProgramNames,
  validatePlan,
  type AiPlan,
  type AiPlanConstraints,
} from "@/lib/utils/ai-plan";
import { buildEditInput, buildEditMessages } from "@/lib/utils/ai-prompt";
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

/** editPlanWithAi's error when the user hasn't opted in to AI editing. */
const AI_CONSENT_REQUIRED = "Turn on AI editing first.";

// Used only when the ai_model_configs table is empty. Free OpenRouter models
// come and go; ones no longer listed are skipped at call time.
const DEFAULT_MODELS: LlmModel[] = [
  { modelId: "minimax/minimax-m3.1-flash:free", label: "MiniMax M3.1 Flash (free)", provider: "openrouter" },
  { modelId: "openrouter/free", label: "Free Models Router (auto)", provider: "openrouter" },
  { modelId: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra 550B (free)", provider: "openrouter" },
  { modelId: "google/gemma-4-31b-it:free", label: "Gemma 4 31B (free)", provider: "openrouter" },
];


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
  // Google's terms don't allow the free Gemini API tier in apps used from the
  // EEA, which is where our users are. Re-enable only on a paid key, and update
  // the privacy policy's processor list when doing so.
  const usable = models.filter((m) => isFreeModel(m) && m.provider !== "google");
  for (const model of models) {
    if (!usable.includes(model)) console.warn(`[AI] ${model.modelId} skipped: not a usable free model`);
  }
  return usable;
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
    // The request goes to outside model providers: only with the user's opt-in.
    if (!user?.aiConsentAt) return { success: false, error: AI_CONSENT_REQUIRED };

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
