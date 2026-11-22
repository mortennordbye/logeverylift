"use server";

/**
 * Pick from the session's match block (docs/plans/session-check.md, decision
 * 5): store one Garmin activity as the planned session's match, with the same
 * `pick` operation that MCP's confirm_planned_session uses. It checks that
 * both the session and the activity are the user's, and the day.
 */

import { PlanConflictError, PlanNotFoundError, PlanStateError } from "@/lib/plan-revisions";
import { applySessionOp } from "@/lib/planned-sessions";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const pickSchema = z.object({
  plannedSessionId: z.number().int().positive(),
  /** The app's row id of the activity (MatchActivity.id). */
  activityId: z.number().int().positive(),
});

export async function pickSessionActivity(data: unknown): Promise<ActionResult<null>> {
  const auth = await requireSession();
  const parsed = pickSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { plannedSessionId, activityId } = parsed.data;
  try {
    await applySessionOp({ userId: auth.user.id, writer: "user" }, { op: "pick", id: plannedSessionId, garminActivityId: activityId });
    revalidatePath(`/planned/${plannedSessionId}`);
    revalidatePath("/");
    revalidatePath("/week");
    revalidatePath("/more/calendar");
    revalidatePath("/programs", "layout");
    return { success: true, data: null };
  } catch (e) {
    if (e instanceof PlanNotFoundError) return { success: false, error: "Session not found" };
    if (e instanceof PlanStateError || e instanceof PlanConflictError) return { success: false, error: e.message };
    console.error("[pickSessionActivity] failed", { plannedSessionId, activityId });
    return { success: false, error: "Failed to pick the activity" };
  }
}
