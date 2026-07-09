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
import { buildAiSystemPrompt, type PrData, type PromptOptions } from "@/lib/utils/ai-prompt";
import { parseUserGoals } from "@/lib/utils/goals";
import { requireSession } from "@/lib/utils/session";
import { and, asc, count, eq, gte, isNull } from "drizzle-orm";

const DAILY_LIMIT = 5;

const DEFAULT_MODELS = [
  { modelId: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Google AI)", provider: "google" },
  { modelId: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (free)", provider: "openrouter" },
  { modelId: "deepseek/deepseek-chat-v3-0324:free", label: "DeepSeek V3 (free)", provider: "openrouter" },
  { modelId: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)", provider: "openrouter" },
];

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

function extractJson(raw: string): string {
  const text = raw.trim();
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1);
  return text;
}

function tryParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type Model = { modelId: string; label: string; provider: string };
type Message = { role: string; content: string };

// Calls a model and returns the text response, or null on any failure.
async function callModel(model: Model, messages: Message[], temperature: number, maxTokens: number): Promise<string | null> {
  try {
    if (model.provider === "google") {
      // Native Gemini API — the AQ. key format requires ?key= param, not Bearer token
      const apiKey = env.GOOGLE_API_KEY;
      if (!apiKey) return null;

      const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
      const chatMessages = messages.filter((m) => m.role !== "system");

      const geminiBody: Record<string, unknown> = {
        contents: chatMessages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      };
      if (systemMsg) geminiBody.systemInstruction = { parts: [{ text: systemMsg }] };

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model.modelId}:generateContent?key=${apiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiBody) },
      );
      if (!response.ok) {
        const err = await response.text();
        console.warn(`[AI] ${model.label} failed (HTTP ${response.status}):`, err.slice(0, 200));
        return null;
      }
      const data = await response.json();
      const parts: { text?: string; thought?: boolean }[] = data?.candidates?.[0]?.content?.parts ?? [];
      const finishReason = data?.candidates?.[0]?.finishReason;
      // Find the actual response part (skip thought parts from thinking models)
      const text = parts.find((p) => !p.thought)?.text ?? null;
      if (!text) console.warn(`[AI] ${model.label} empty response — parts: ${parts.length}, finish: ${finishReason}, error: ${JSON.stringify(data?.error)}`);
      return text ?? null;
    }

    // OpenRouter (OpenAI-compatible)
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) return null;
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.BETTER_AUTH_URL,
        "X-Title": "LogEveryLift AI Setup",
      },
      body: JSON.stringify({ model: model.modelId, messages, temperature, max_tokens: maxTokens }),
    });
    if (!response.ok) {
      const err = await response.text();
      console.warn(`[AI] ${model.label} failed (HTTP ${response.status}):`, err.slice(0, 200));
      return null;
    }
    const data = await response.json();
    return (data?.choices?.[0]?.message?.content as string) ?? null;
  } catch (err) {
    console.warn(`[AI] ${model.label} threw:`, err);
    return null;
  }
}

async function tryRepair(
  model: Model,
  brokenText: string,
  originalUserMessage: string,
  systemPrompt: string,
): Promise<unknown | null> {
  const text = await callModel(
    model,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: originalUserMessage },
      { role: "assistant", content: brokenText },
      { role: "user", content: "Your response was not valid JSON. Return only the corrected JSON, nothing else. No markdown, no explanation." },
    ],
    0.1,
    16384,
  );
  if (!text) return null;
  return tryParse(extractJson(text));
}

async function getEnabledModels(): Promise<{ modelId: string; label: string; provider: string }[]> {
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

  const systemPrompt = `${buildAiSystemPrompt(userProfile, exerciseList, prs, existingProgramNames, options)}

Generate the full plan based on the training goals the user describes. Output only the raw JSON — no explanation, no markdown, no code block.`;

  if (!env.OPENROUTER_API_KEY && !env.GOOGLE_API_KEY) {
    return { success: false, error: "AI generation is not configured on this server." };
  }

  // Try each model in priority order, falling through on failure or invalid JSON
  let parsed: unknown | null = null;
  let modelUsed = "";

  for (const model of models) {
    if (model.provider === "google" && !env.GOOGLE_API_KEY) continue;
    if (model.provider !== "google" && !env.OPENROUTER_API_KEY) continue;

    const text = await callModel(
      model,
      [{ role: "system", content: systemPrompt }, { role: "user", content: trimmed }],
      0.4,
      16384,
    );

    if (!text) {
      console.warn(`[AI] ${model.label} returned no text`);
      continue;
    }

    const attempt = tryParse(extractJson(text));
    if (attempt !== null) {
      parsed = attempt;
      modelUsed = model.modelId;
      break;
    }

    console.warn(`[AI] ${model.label} returned unparseable JSON, attempting repair`);
    const repaired = await tryRepair(model, text, trimmed, systemPrompt);
    if (repaired !== null) {
      console.log(`[AI] ${model.label} repaired successfully`);
      parsed = repaired;
      modelUsed = model.modelId;
      break;
    }

    console.warn(`[AI] ${model.label} repair failed, trying next model`);
  }

  if (parsed === null) {
    return {
      success: false,
      error: "All AI models are currently unavailable. Please try again in a moment.",
    };
  }

  // Record usage only after a successful parse
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
