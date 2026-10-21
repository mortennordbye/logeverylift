/**
 * Calls an LLM for structured output, whatever the model can do.
 *
 * Providers: OpenRouter (any model, free ones included) and Google's native
 * Gemini API. A model is asked for structure in the best mode it supports
 * (see OutputMode); OpenRouter's public catalog says which, and the caller
 * downgrades on an "unsupported" failure when the catalog was wrong or
 * unreachable.
 */

import { env } from "@/lib/env";
import {
  capabilitiesFromParameters,
  classifyHttpFailure,
  readChatCompletion,
  readGeminiResponse,
  type FailureReason,
  type ModelCapabilities,
  type OutputMode,
  type ReadResult,
} from "@/lib/utils/llm-response";

export type LlmModel = { modelId: string; label: string; provider: string };
export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

/** The structure asked for: a JSON Schema, and a name/description for tool mode. */
export type OutputSpec = { name: string; description: string; schema: Record<string, unknown> };

export type LlmResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; reason: FailureReason; detail: string };

const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 180_000;
const CATALOG_TTL_MS = 60 * 60_000;
const ALL_MODES: OutputMode[] = ["json_schema", "tool", "json_object", "text"];

type CatalogEntry = { params: string[]; maxCompletionTokens: number | null };
let catalog: { fetchedAt: number; models: Map<string, CatalogEntry> } | null = null;

async function openRouterCatalog(): Promise<Map<string, CatalogEntry> | null> {
  if (catalog && Date.now() - catalog.fetchedAt < CATALOG_TTL_MS) return catalog.models;
  try {
    const response = await fetch(`${OPENROUTER_URL}/models`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return catalog?.models ?? null;
    const data = (await response.json()) as {
      data?: { id: string; supported_parameters?: string[]; top_provider?: { max_completion_tokens?: number | null } }[];
    };
    const models = new Map<string, CatalogEntry>();
    for (const m of data.data ?? []) {
      models.set(m.id, {
        params: m.supported_parameters ?? [],
        maxCompletionTokens: m.top_provider?.max_completion_tokens ?? null,
      });
    }
    catalog = { fetchedAt: Date.now(), models };
    return models;
  } catch (err) {
    console.warn("[AI] openrouter_catalog_unreachable", String(err).slice(0, 120));
    return catalog?.models ?? null;
  }
}

/**
 * What to try for a model, or null when it cannot be called: no API key for
 * its provider, or OpenRouter no longer lists it (free models come and go).
 */
export async function capabilitiesFor(model: LlmModel): Promise<ModelCapabilities | null> {
  if (model.provider === "google") {
    if (!env.GOOGLE_API_KEY) return null;
    return { modes: ["json_schema", "json_object", "text"], forceTool: false, maxCompletionTokens: null };
  }
  if (!env.OPENROUTER_API_KEY) return null;
  const models = await openRouterCatalog();
  // Catalog unreachable: try everything and let rejections downgrade.
  if (!models) return { modes: ALL_MODES, forceTool: true, maxCompletionTokens: null };
  const entry = models.get(model.modelId);
  if (!entry) return null;
  return capabilitiesFromParameters(entry.params, entry.maxCompletionTokens);
}

export type CallOptions = {
  mode: OutputMode;
  spec: OutputSpec;
  capabilities: ModelCapabilities;
  temperature: number;
  maxTokens: number;
  /** Per-call limit; callers with an overall deadline pass what is left. */
  timeoutMs?: number;
};

/** One call in one mode. Never throws. */
export async function callModel(model: LlmModel, messages: LlmMessage[], opts: CallOptions): Promise<LlmResult> {
  const maxTokens = Math.min(opts.maxTokens, opts.capabilities.maxCompletionTokens ?? opts.maxTokens);
  try {
    const { response, read } =
      model.provider === "google"
        ? await callGemini(model, messages, opts, maxTokens)
        : await callOpenRouter(model, messages, opts, maxTokens);

    if (!response.ok) {
      const body = await response.text();
      const reason = classifyHttpFailure(response.status, opts.mode, body);
      return { ok: false, reason, detail: `HTTP ${response.status}: ${body.slice(0, 200)}` };
    }
    const result: ReadResult = read(await response.json());
    if (!result.text) return { ok: false, reason: "unavailable", detail: result.error ?? "empty response" };
    return { ok: true, text: result.text, truncated: result.truncated };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    // Gemini's key rides in the URL, which a fetch error can echo.
    const detail = timedOut ? "timed out" : String(err).replace(/key=[^&\s"']+/g, "key=***").slice(0, 200);
    return { ok: false, reason: "unavailable", detail };
  }
}

async function callOpenRouter(model: LlmModel, messages: LlmMessage[], opts: CallOptions, maxTokens: number) {
  const body: Record<string, unknown> = {
    model: model.modelId,
    messages,
    temperature: opts.temperature,
    max_tokens: maxTokens,
  };
  const { name, description, schema } = opts.spec;
  if (opts.mode === "json_schema") {
    body.response_format = { type: "json_schema", json_schema: { name, strict: true, schema } };
  } else if (opts.mode === "tool") {
    body.tools = [{ type: "function", function: { name, description, parameters: schema } }];
    if (opts.capabilities.forceTool) body.tool_choice = { type: "function", function: { name } };
  } else if (opts.mode === "json_object") {
    body.response_format = { type: "json_object" };
  }
  // Without this OpenRouter may route to a provider that silently ignores the
  // structure parameters; with it, an unsupported request fails fast instead.
  if (opts.mode !== "text") body.provider = { require_parameters: true };

  const response = await fetch(`${OPENROUTER_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.BETTER_AUTH_URL,
      "X-Title": "LogEveryLift AI Setup",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  return { response, read: readChatCompletion };
}

async function callGemini(model: LlmModel, messages: LlmMessage[], opts: CallOptions, maxTokens: number) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const generationConfig: Record<string, unknown> = { temperature: opts.temperature, maxOutputTokens: maxTokens };
  if (opts.mode === "json_schema" || opts.mode === "json_object") generationConfig.responseMimeType = "application/json";
  if (opts.mode === "json_schema") generationConfig.responseJsonSchema = opts.spec.schema;

  const body: Record<string, unknown> = {
    contents: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig,
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  // The AQ. key format needs ?key=, not a Bearer token.
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.modelId)}:generateContent?key=${env.GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    },
  );
  return { response, read: readGeminiResponse };
}
