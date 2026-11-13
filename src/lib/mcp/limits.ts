/**
 * MCP side of the training limits (docs/plans/ai-coach.md, 2.4; decision D3):
 * the override arguments a checked write takes, the refusal the model reads
 * when a write breaks a limit, and the short summary every checked write
 * returns, so the model always knows whether a check ran.
 */

import type { LimitOverride, LimitRefusedError } from "@/lib/training-limits";
import { LIMIT_RULES, type LimitCheck, type LimitRule } from "@/lib/utils/training-limits";
import { z } from "zod";

export const overrideArgs = {
  overrideLimits: z
    .array(z.enum(LIMIT_RULES))
    .max(LIMIT_RULES.length)
    .optional()
    .describe(
      `Only after a refusal: the training limits you go past on purpose (${LIMIT_RULES.join(", ")}). Needs overrideReason.`,
    ),
  overrideReason: z
    .string()
    .min(10)
    .max(500)
    .optional()
    .describe("Why the change still fits the athlete, for example a longer run they did outside the app. Stored with the change."),
};

export const LIMITS_TEXT =
  `Training limits (${LIMIT_RULES.join(", ")}) are checked on this write for users with endurance features on; a write that breaks one is refused with the numbers, and you may send it again with overrideLimits and overrideReason.`;

/** The override from a tool's arguments, or an error message when it is incomplete. */
export function overrideFrom(args: { overrideLimits?: LimitRule[]; overrideReason?: string }): LimitOverride | string {
  const rules = args.overrideLimits ?? [];
  if (rules.length > 0 && !args.overrideReason) return "overrideReason is required with overrideLimits";
  return { rules, reason: args.overrideReason ?? null };
}

/** The error result for a write a limit refused. Nothing was applied. */
export function limitRefusal(e: LimitRefusedError) {
  const rules = e.blocking.map((b) => b.rule);
  console.info("[mcp:limits] refused", { rules });
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            applied: false,
            brokenLimits: e.blocking.map((b) => ({
              rule: b.rule,
              message: b.message,
              numbers: b.numbers,
              evidence: b.evidence,
              source: b.source,
            })),
            howToOverride: `Nothing was changed. If the change still fits the athlete, send the same call again with overrideLimits: ${JSON.stringify(rules)} and overrideReason (why it still fits, for example a longer run they did outside the app). The user sees the reason in the app.`,
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}

/** The short summary a checked write returns. */
export function limitSummary(check: LimitCheck, unusedOverrides: LimitRule[] = []) {
  return {
    checked: check.checked,
    notChecked: check.notChecked,
    passed: check.passed,
    overridden: check.overridden.map((o) => ({ rule: o.rule, message: o.message })),
    ...(unusedOverrides.length && { ignoredOverrides: unusedOverrides.map((r) => `${r} was not broken, so the override did nothing`) }),
    ...(check.warnings.length && { warnings: check.warnings.map((w) => ({ rule: w.rule, message: w.message, evidence: w.evidence })) }),
  };
}
