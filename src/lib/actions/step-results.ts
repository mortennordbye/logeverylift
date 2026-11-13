"use server";

/**
 * Save per-step results from the guided player or by hand
 * (docs/plans/endurance-app.md, 5.2). Endurance features only (D18).
 */

import { enduranceEnabledFor } from "@/lib/endurance";
import { DuplicateSession } from "@/lib/logged-sessions";
import { PlanStateError } from "@/lib/plan-revisions";
import { StepResultsError, saveStepResults } from "@/lib/step-results";
import { requireSession } from "@/lib/utils/session";
import { saveStepResultsSchema } from "@/lib/validators/step-results";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";

export async function saveStepResultsAction(data: unknown): Promise<ActionResult<{ workoutSessionId: number }>> {
  const auth = await requireSession();
  const parsed = saveStepResultsSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: false, error: "Endurance features are not on for this account" };
  const d = parsed.data;
  try {
    const r = await saveStepResults(
      auth.user.id,
      {
        plannedSessionId: d.plannedSessionId,
        steps: d.steps,
        sessionRpe: d.sessionRpe,
        distanceMeters: d.distanceMeters,
        notes: d.notes,
        clientKey: d.clientKey,
        startedAt: d.startedAt ? new Date(d.startedAt) : null,
        finishedAt: d.finishedAt ? new Date(d.finishedAt) : null,
        pausedSeconds: d.pausedSeconds,
      },
      d.source,
    );
    revalidatePath("/");
    revalidatePath("/week");
    revalidatePath(`/planned/${d.plannedSessionId}`);
    revalidatePath("/history");
    return { success: true, data: { workoutSessionId: r.workoutSessionId } };
  } catch (e) {
    if (e instanceof StepResultsError || e instanceof PlanStateError || e instanceof DuplicateSession) return { success: false, error: e.message };
    console.error("[saveStepResults] failed", { plannedSessionId: d.plannedSessionId });
    return { success: false, error: "Failed to save the results" };
  }
}
