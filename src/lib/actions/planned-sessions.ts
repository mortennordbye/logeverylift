"use server";

/**
 * Dated sessions from the app (docs/plans/sessions.md, 5): read a range, and
 * move, skip, plan again, change, add, remove or reset one session. Each
 * change is a revision of that session; the app sends no version (A4).
 */

import { db } from "@/db";
import { plannedSessions } from "@/db/schema";
import { livePlannedSessions } from "@/lib/plan-live";
import { PlanConflictError, PlanNotFoundError, PlanStateError } from "@/lib/plan-revisions";
import { applyRotationOp, applySessionOp, listPlanned, type PlannedView } from "@/lib/planned-sessions";
import { addDaysStr, PLANNED_RANGE_MAX_DAYS } from "@/lib/utils/planned-sessions";
import { requireSession } from "@/lib/utils/session";
import { plannedRangeSchema, plannedSessionOpSchema, rotationSessionOpSchema } from "@/lib/validators/planned-sessions";
import type { ActionResult } from "@/types/workout";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function getPlannedSessions(data: unknown): Promise<ActionResult<PlannedView[]>> {
  const auth = await requireSession();
  const parsed = plannedRangeSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { from, to, cycleId } = parsed.data;
  if (to < from || to > addDaysStr(from, PLANNED_RANGE_MAX_DAYS)) {
    return { success: false, error: `Pick a range of at most ${PLANNED_RANGE_MAX_DAYS} days` };
  }
  try {
    return { success: true, data: await listPlanned(auth.user.id, from, to, cycleId) };
  } catch (e) {
    console.error("[getPlannedSessions] failed", e);
    return { success: false, error: "Failed to read the planned sessions" };
  }
}

export async function updatePlannedSession(data: unknown): Promise<ActionResult<{ id: number; date: string | null; status: string }>> {
  const auth = await requireSession();
  const parsed = plannedSessionOpSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const { row } = await applySessionOp({ userId: auth.user.id, writer: "user" }, parsed.data);
    revalidatePath("/");
    revalidatePath("/more/calendar");
    return { success: true, data: { id: row.id, date: row.date, status: row.status } };
  } catch (e) {
    if (e instanceof PlanNotFoundError) return { success: false, error: "Session not found" };
    if (e instanceof PlanStateError || e instanceof PlanConflictError) return { success: false, error: e.message };
    console.error("[updatePlannedSession] failed", e);
    return { success: false, error: "Failed to change the session" };
  }
}

/**
 * Skip, plan again or change one coming session of a rotation cycle by its
 * walk position (docs/plans/sessions.md, 4.3). The app sends no version (A4):
 * a stored change on that position is read here and written on top.
 */
export async function updateRotationSession(data: unknown): Promise<ActionResult<{ id: number; status: string }>> {
  const auth = await requireSession();
  const parsed = rotationSessionOpSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const input = parsed.data;
  try {
    const [existing] = await db
      .select({ version: plannedSessions.version })
      .from(plannedSessions)
      .where(
        and(
          eq(plannedSessions.userId, auth.user.id),
          eq(plannedSessions.cycleId, input.cycleId),
          eq(plannedSessions.rotationPosition, input.rotationPosition),
          livePlannedSessions,
        ),
      );
    const { row } = await applyRotationOp(
      { userId: auth.user.id, writer: "user" },
      { ...input, programId: input.op === "change" ? input.programId : undefined, expectedVersion: existing?.version },
    );
    revalidatePath("/");
    revalidatePath(`/cycles/${input.cycleId}`);
    return { success: true, data: { id: row.id, status: row.status } };
  } catch (e) {
    if (e instanceof PlanNotFoundError) return { success: false, error: "Cycle not found" };
    if (e instanceof PlanStateError || e instanceof PlanConflictError) return { success: false, error: e.message };
    console.error("[updateRotationSession] failed", { cycleId: input.cycleId, op: input.op }, e);
    return { success: false, error: "Failed to change the session" };
  }
}
