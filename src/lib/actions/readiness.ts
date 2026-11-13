"use server";

/**
 * The readiness swap from the home screen (docs/plans/limits-strength-readiness.md,
 * section 5): the user taps "Make it easy". The server reads the suggestion
 * again and applies only what it says; the client sends the session id only.
 */

import { PlanConflictError, PlanNotFoundError, PlanStateError } from "@/lib/plan-revisions";
import { STALE_SWAP, applyReadinessSwap } from "@/lib/readiness-swap";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const readinessSwapSchema = z.object({ plannedSessionId: z.number().int().positive(), expectedVersion: z.number().int().positive().optional() });

export async function makeSessionEasy(data: unknown): Promise<ActionResult<{ id: number }>> {
  const auth = await requireSession();
  const parsed = readinessSwapSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const { row } = await applyReadinessSwap({ userId: auth.user.id, writer: "apply" }, parsed.data.plannedSessionId, undefined, parsed.data.expectedVersion);
    revalidatePath("/");
    revalidatePath("/more/calendar");
    return { success: true, data: { id: row.id } };
  } catch (e) {
    if (e instanceof PlanNotFoundError) return { success: false, error: "Session not found" };
    // A changed session (another device made it easy first) reads as the suggestion having changed.
    if (e instanceof PlanConflictError) return { success: false, error: STALE_SWAP };
    // SessionInputError (a past day, a bad workout) is a PlanStateError: its own message.
    if (e instanceof PlanStateError) {
      console.info("[makeSessionEasy] stale", { id: parsed.data.plannedSessionId });
      return { success: false, error: e.message };
    }
    console.error("[makeSessionEasy] failed", e);
    return { success: false, error: "Failed to change the session" };
  }
}
