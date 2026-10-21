"use server";

import { db } from "@/db";
import { aiModelConfigs } from "@/db/schema/ai-model-configs";
import { env } from "@/lib/env";
import { callModel, capabilitiesFor, type LlmMessage } from "@/lib/llm";
import { parsePlanText } from "@/lib/utils/ai-plan";
import type { OutputMode } from "@/lib/utils/llm-response";
import { ForbiddenError, requireAdmin, requireSession } from "@/lib/utils/session";
import { asc, eq } from "drizzle-orm";

type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function listAiModelConfigs(): Promise<ActionResult<typeof aiModelConfigs.$inferSelect[]>> {
  await requireSession();
  try {
    const rows = await db.select().from(aiModelConfigs).orderBy(asc(aiModelConfigs.priority));
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function setAiModelEnabled(id: number, enabled: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.update(aiModelConfigs).set({ enabled }).where(eq(aiModelConfigs.id, id));
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof ForbiddenError) return { success: false, error: err.message };
    console.error("[setAiModelEnabled] failed", err);
    return { success: false, error: "Failed to update model." };
  }
}

export async function moveAiModel(id: number, direction: "up" | "down"): Promise<ActionResult> {
  try {
    await requireAdmin();
    const rows = await db.select().from(aiModelConfigs).orderBy(asc(aiModelConfigs.priority));
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return { success: false, error: "Model not found." };
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) return { success: true, data: undefined };

    const a = rows[idx];
    const b = rows[swapIdx];
    await db.update(aiModelConfigs).set({ priority: b.priority }).where(eq(aiModelConfigs.id, a.id));
    await db.update(aiModelConfigs).set({ priority: a.priority }).where(eq(aiModelConfigs.id, b.id));
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof ForbiddenError) return { success: false, error: err.message };
    console.error("[moveAiModel] failed", err);
    return { success: false, error: "Failed to reorder models." };
  }
}

/**
 * Asks the model for a tiny structured reply through the same client AI Setup
 * uses, and reports which output mode worked. A model OpenRouter no longer
 * lists fails here instead of silently costing a slot in every generation.
 */
export async function testAiModel(modelId: string): Promise<ActionResult<{ latencyMs: number; mode: OutputMode }>> {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof ForbiddenError) return { success: false, error: err.message };
    throw err;
  }

  const row = await db
    .select({ label: aiModelConfigs.label, provider: aiModelConfigs.provider })
    .from(aiModelConfigs)
    .where(eq(aiModelConfigs.modelId, modelId))
    .then((rows) => rows[0]);
  const model = { modelId, label: row?.label ?? modelId, provider: row?.provider ?? "openrouter" };

  const capabilities = await capabilitiesFor(model);
  if (!capabilities) {
    const keyMissing = model.provider === "google" ? !env.GOOGLE_API_KEY : !env.OPENROUTER_API_KEY;
    return {
      success: false,
      error: keyMissing
        ? `${model.provider === "google" ? "GOOGLE_API_KEY" : "OPENROUTER_API_KEY"} is not configured.`
        : "Not listed by OpenRouter any more. Remove it or pick a current model.",
    };
  }

  const spec = {
    name: "report_status",
    description: "Report that you are working.",
    schema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    },
  };
  const start = Date.now();
  let lastError = "No output mode worked.";
  for (const mode of capabilities.modes) {
    const messages: LlmMessage[] = [
      {
        role: "user",
        content: mode === "tool"
          ? 'Call the "report_status" tool with {"ok": true}.'
          : 'Reply with only this JSON and nothing else: {"ok": true}',
      },
    ];
    const result = await callModel(model, messages, { mode, spec, capabilities, temperature: 0, maxTokens: 256 });
    if (!result.ok) {
      lastError = result.detail;
      if (result.reason === "unsupported") continue;
      return { success: false, error: lastError };
    }
    const value = parsePlanText(result.text) as { ok?: unknown } | null;
    if (value?.ok === true) return { success: true, data: { latencyMs: Date.now() - start, mode } };
    lastError = `Unexpected reply (${mode}): ${result.text.slice(0, 80)}`;
  }
  return { success: false, error: lastError };
}

// Provider model ids, e.g. "gemini-2.5-flash" or "google/gemma-4-31b-it:free".
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,200}$/;

export async function addAiModel(modelId: string, label: string, provider = "openrouter"): Promise<ActionResult> {
  if (!modelId.trim() || !label.trim()) return { success: false, error: "Model ID and label are required." };
  if (!MODEL_ID_PATTERN.test(modelId.trim())) return { success: false, error: "Model ID can only contain letters, digits and . _ : / -" };
  try {
    await requireAdmin();
    const rows = await db.select({ priority: aiModelConfigs.priority }).from(aiModelConfigs).orderBy(asc(aiModelConfigs.priority));
    const maxPriority = rows.length > 0 ? Math.max(...rows.map((r) => r.priority)) : 0;
    await db.insert(aiModelConfigs).values({ modelId: modelId.trim(), label: label.trim(), provider, priority: maxPriority + 1 });
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof ForbiddenError) return { success: false, error: err.message };
    console.error("[addAiModel] failed", err);
    return { success: false, error: "Failed to add model." };
  }
}

export async function deleteAiModel(id: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.delete(aiModelConfigs).where(eq(aiModelConfigs.id, id));
    return { success: true, data: undefined };
  } catch (err) {
    if (err instanceof ForbiddenError) return { success: false, error: err.message };
    console.error("[deleteAiModel] failed", err);
    return { success: false, error: "Failed to delete model." };
  }
}
