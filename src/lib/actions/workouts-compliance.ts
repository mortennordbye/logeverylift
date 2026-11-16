"use server";

/**
 * "Did you do it?" and sick periods from the app
 * (docs/plans/workouts-and-compliance.md, section 7). Endurance features
 * only (D18). Session changes (link a brick, missed, move to the suggested
 * day) go through updatePlannedSession in planned-sessions.ts.
 */

import { enduranceEnabledFor } from "@/lib/endurance";
import { addIllness, deleteIllness, updateIllness } from "@/lib/illness";
import { DuplicateSession } from "@/lib/logged-sessions";
import { PlanConflictError, PlanNotFoundError, PlanStateError, type PlanWriteContext } from "@/lib/plan-revisions";
import { confirmDone } from "@/lib/session-answers";
import { requireSession } from "@/lib/utils/session";
import { confirmDoneSchema, illnessOpSchema } from "@/lib/validators/planned-sessions";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";

const ENDURANCE_OFF = "Endurance features are not on for this account";
const ctxFor = (userId: string): PlanWriteContext => ({ userId, writer: "user" });

function known(e: unknown): string | null {
  if (e instanceof PlanNotFoundError) return e.message;
  if (e instanceof PlanStateError || e instanceof PlanConflictError || e instanceof DuplicateSession) return e.message;
  return null;
}

/** "Yes, I did it": logs the session's time, distance and RPE as a workout linked to it. */
export async function confirmPlannedDone(data: unknown): Promise<ActionResult<{ sessionId: number }>> {
  const auth = await requireSession();
  const parsed = confirmDoneSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: false, error: ENDURANCE_OFF };
  try {
    const { plannedSessionId, ...answer } = parsed.data;
    const r = await confirmDone(ctxFor(auth.user.id), plannedSessionId, answer, "app");
    revalidatePath("/");
    revalidatePath("/more/calendar");
    revalidatePath("/history");
    return { success: true, data: r };
  } catch (e) {
    const msg = known(e);
    if (msg) return { success: false, error: msg };
    console.error("[confirmPlannedDone] failed", { plannedSessionId: parsed.data.plannedSessionId });
    return { success: false, error: "Failed to save the session" };
  }
}

/** Add, change, end or delete a sick period. */
export async function manageIllness(data: unknown): Promise<ActionResult<{ id: number }>> {
  const auth = await requireSession();
  const parsed = illnessOpSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: false, error: ENDURANCE_OFF };
  const ctx = ctxFor(auth.user.id);
  try {
    const d = parsed.data;
    let id: number;
    if (d.op === "add") id = (await addIllness(ctx, d)).id;
    else if (d.op === "delete") {
      await deleteIllness(ctx, d.id);
      id = d.id;
    } else if (d.op === "end") id = (await updateIllness(ctx, d.id, { endedOn: d.endedOn })).id;
    else id = (await updateIllness(ctx, d.id, { startedOn: d.startedOn, endedOn: d.endedOn, severity: d.severity, notes: d.notes })).id;
    revalidatePath("/");
    revalidatePath("/more/account", "layout");
    return { success: true, data: { id } };
  } catch (e) {
    const msg = known(e);
    if (msg) return { success: false, error: msg };
    console.error("[manageIllness] failed", { op: parsed.data.op });
    return { success: false, error: "Failed to save the sick period" };
  }
}
