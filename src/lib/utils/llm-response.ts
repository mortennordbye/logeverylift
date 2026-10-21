/**
 * Pure helpers for the LLM client (src/lib/llm.ts): which output modes a
 * model supports, reading a provider response, and classifying failures.
 * Kept free of env and fetch so they can be unit tested.
 */

/**
 * How the model is asked to return structure, best first:
 * - json_schema: the provider enforces our JSON Schema (structured outputs)
 * - tool:        the plan is the arguments of a forced function call
 * - json_object: the provider guarantees valid JSON, the shape is prompted
 * - text:        plain completion; the shape comes from the prompt alone
 */
export type OutputMode = "json_schema" | "tool" | "json_object" | "text";

export type ModelCapabilities = {
  modes: OutputMode[];
  /** The tool call can be forced with tool_choice. */
  forceTool: boolean;
  /** Provider cap on completion tokens, when known. */
  maxCompletionTokens: number | null;
};

/** From an OpenRouter model's `supported_parameters`. Text is always last. */
export function capabilitiesFromParameters(
  params: string[],
  maxCompletionTokens: number | null = null,
): ModelCapabilities {
  const modes: OutputMode[] = [];
  if (params.includes("structured_outputs")) modes.push("json_schema");
  if (params.includes("tools")) modes.push("tool");
  if (params.includes("response_format")) modes.push("json_object");
  modes.push("text");
  return { modes, forceTool: params.includes("tool_choice"), maxCompletionTokens };
}

export type ReadResult = {
  text: string | null;
  truncated: boolean;
  error: string | null;
};

function joinContent(content: unknown): string | null {
  if (typeof content === "string") return content.trim() ? content : null;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === "string" ? part : (part as { text?: unknown })?.text))
      .filter((t): t is string => typeof t === "string")
      .join("");
    return text.trim() ? text : null;
  }
  return null;
}

/**
 * OpenAI-compatible chat completion (OpenRouter). Prefers a tool call's
 * arguments, then the message content (string or array of parts). Reasoning
 * fields are ignored; <think> blocks in content are stripped by the parser.
 */
export function readChatCompletion(data: unknown): ReadResult {
  const d = data as {
    error?: { message?: string } | string;
    choices?: {
      finish_reason?: string | null;
      error?: { message?: string };
      message?: {
        content?: unknown;
        tool_calls?: { function?: { arguments?: unknown } }[];
      };
    }[];
  } | null;
  if (!d) return { text: null, truncated: false, error: "empty body" };
  if (d.error) {
    return { text: null, truncated: false, error: typeof d.error === "string" ? d.error : (d.error.message ?? "provider error") };
  }
  const choice = d.choices?.[0];
  if (!choice) return { text: null, truncated: false, error: "no choices" };
  if (choice.error) return { text: null, truncated: false, error: choice.error.message ?? "provider error" };

  const truncated = choice.finish_reason === "length";
  const args = choice.message?.tool_calls?.[0]?.function?.arguments;
  if (typeof args === "string" && args.trim()) return { text: args, truncated, error: null };
  if (args && typeof args === "object") return { text: JSON.stringify(args), truncated, error: null };

  const text = joinContent(choice.message?.content);
  return { text, truncated, error: text ? null : "empty content" };
}

/** Gemini generateContent: the non-thought parts of the first candidate. */
export function readGeminiResponse(data: unknown): ReadResult {
  const d = data as {
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  } | null;
  if (!d) return { text: null, truncated: false, error: "empty body" };
  if (d.error) return { text: null, truncated: false, error: d.error.message ?? "provider error" };
  if (d.promptFeedback?.blockReason) return { text: null, truncated: false, error: `blocked: ${d.promptFeedback.blockReason}` };
  const candidate = d.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  const truncated = candidate?.finishReason === "MAX_TOKENS";
  return { text: text.trim() ? text : null, truncated, error: text.trim() ? null : `empty (finish: ${candidate?.finishReason ?? "none"})` };
}

export type FailureReason = "unsupported" | "rate_limited" | "unavailable";

/**
 * An HTTP failure. A 400/422 while asking for structure most likely means this
 * model or route rejects that mode, so the caller downgrades and retries the
 * same model. OpenRouter answers 404 both for "no endpoint supports these
 * parameters" (downgrade) and for a broken upstream provider (move on), so a
 * 404 only downgrades when the body says it is about support.
 */
export function classifyHttpFailure(status: number, mode: OutputMode, body = ""): FailureReason {
  if (status === 429) return "rate_limited";
  if (mode === "text") return "unavailable";
  if (status === 400 || status === 422) return "unsupported";
  if (status === 404 && /support/i.test(body)) return "unsupported";
  return "unavailable";
}
