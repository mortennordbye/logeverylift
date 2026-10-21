/**
 * The model loop behind AI Setup's edits: one model at a time, best output
 * mode first, one repair turn with the exact validation problems. Server-only.
 * Lives outside the server action file so nothing here becomes a callable
 * action, and so scripts/ai-smoke.ts can drive it.
 */

import { callModel, capabilitiesFor, type LlmMessage, type LlmModel, type OutputSpec } from "@/lib/llm";
import { aiPlanJsonSchema, parsePlanText, validatePlan, type AiPlan, type AiPlanConstraints } from "@/lib/utils/ai-plan";
import { PLAN_TOOL_NAME } from "@/lib/utils/ai-prompt";

// Whole-request budget across models and retries; the client tells the user
// generation can take a few minutes.
export const GENERATION_DEADLINE_MS = 300_000;
// Valid edits on free models take about a minute; past two, move to the next model.
export const CALL_TIMEOUT_MS = 120_000;
// Not worth starting a call with less than this left.
export const MIN_CALL_MS = 20_000;
export const MAX_OUTPUT_TOKENS = 24_000;

export const planSpec = (): OutputSpec => ({
  name: PLAN_TOOL_NAME,
  description: "Submit the athlete's complete training setup: programs and the cycle that schedules them.",
  schema: aiPlanJsonSchema(),
});

export function repairRequest(issues: string[], truncated: boolean, delivery: "json" | "tool"): string {
  const lines = truncated
    ? ["Your reply was cut off before the JSON ended. Return a more compact plan (fewer exercises or sets) so it fits.", ...issues]
    : issues;
  return `That plan can't be imported yet. Fix these problems and return the complete corrected plan:\n${lines
    .map((l) => `- ${l}`)
    .join("\n")}\n${delivery === "tool" ? `Call the "${PLAN_TOOL_NAME}" tool again with the full plan.` : "Reply with only the corrected JSON object."}`;
}

export type Attempt = { plan: AiPlan } | { failure: "rate_limited" | "unavailable" | "invalid" };

/**
 * One model: best supported output mode first, downgrading when the provider
 * rejects a mode. A response that fails validation gets one repair turn with
 * the exact problems; after that the caller moves on to the next model.
 */
export async function generateWithModel(
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
  const spec = planSpec();

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
