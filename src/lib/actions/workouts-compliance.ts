"use server";

/**
 * Structured workouts, "Did you do it?" and sick periods from the app
 * (docs/plans/workouts-and-compliance.md, section 7). Endurance features
 * only (D18). Session changes (use a workout, link a brick, missed, move to
 * the suggested day) go through updatePlannedSession in planned-sessions.ts.
 */

import { restoreDeletedAthleteRow } from "@/lib/athlete-profile";
import { enduranceEnabledFor } from "@/lib/endurance";
import { addIllness, deleteIllness, listIllness, updateIllness, type IllnessRow } from "@/lib/illness";
import { DuplicateSession } from "@/lib/logged-sessions";
import { PlanConflictError, PlanNotFoundError, PlanStateError, type PlanWriteContext } from "@/lib/plan-revisions";
import { confirmDone, homeEndurance, type HomeEndurance } from "@/lib/session-answers";
import { requireSession } from "@/lib/utils/session";
import { confirmDoneSchema, illnessOpSchema, workoutOpSchema } from "@/lib/validators/planned-sessions";
import { deleteWorkout, duplicateWorkout, listWorkouts, updateWorkout, type LibraryWorkout } from "@/lib/workouts";
import type { ActionResult } from "@/types/workout";
import { revalidatePath } from "next/cache";
import { z } from "zod";

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
    console.error("[confirmPlannedDone] failed", e);
    return { success: false, error: "Failed to save the session" };
  }
}

/** What the home card shows: sessions to answer, missed key sessions with their day, the return rule. */
export async function getHomeEndurance(): Promise<ActionResult<HomeEndurance | null>> {
  const auth = await requireSession();
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: true, data: null };
  try {
    return { success: true, data: await homeEndurance(auth.user.id) };
  } catch (e) {
    console.error("[getHomeEndurance] failed", e);
    return { success: false, error: "Failed to read the sessions" };
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
    revalidatePath("/more/athlete");
    return { success: true, data: { id } };
  } catch (e) {
    const msg = known(e);
    if (msg) return { success: false, error: msg };
    console.error("[manageIllness] failed", { op: parsed.data.op });
    return { success: false, error: "Failed to save the sick period" };
  }
}

/** Bring back a deleted sick period. */
export async function restoreIllness(data: unknown): Promise<ActionResult<undefined>> {
  const auth = await requireSession();
  const parsed = z.object({ id: z.number().int().positive() }).safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  try {
    const done = await restoreDeletedAthleteRow(ctxFor(auth.user.id), "illness", parsed.data.id);
    if (!done) return { success: false, error: "Nothing to restore" };
    revalidatePath("/more/athlete");
    return { success: true, data: undefined };
  } catch (e) {
    const msg = known(e);
    if (msg) return { success: false, error: msg };
    console.error("[restoreIllness] failed", e);
    return { success: false, error: "Failed to restore the sick period" };
  }
}

/** The user's sick periods, newest first. */
export async function getIllness(): Promise<ActionResult<IllnessRow[]>> {
  const auth = await requireSession();
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: true, data: [] };
  return { success: true, data: await listIllness(auth.user.id) };
}

/** The library, live or recently deleted. */
export async function getWorkouts(data: unknown): Promise<ActionResult<LibraryWorkout[]>> {
  const auth = await requireSession();
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: true, data: [] };
  const deleted = typeof data === "object" && data != null && (data as { deleted?: unknown }).deleted === true;
  try {
    return { success: true, data: await listWorkouts(auth.user.id, { deleted }) };
  } catch (e) {
    console.error("[getWorkouts] failed", e);
    return { success: false, error: "Failed to read the workouts" };
  }
}

/** Duplicate, rename, delete or restore a library workout. The step editor waits for C6. */
export async function manageWorkout(data: unknown): Promise<ActionResult<{ id: number }>> {
  const auth = await requireSession();
  const parsed = workoutOpSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: false, error: ENDURANCE_OFF };
  const ctx = ctxFor(auth.user.id);
  try {
    const d = parsed.data;
    let id = d.id;
    if (d.op === "duplicate") id = (await duplicateWorkout(ctx, d.id)).id;
    else if (d.op === "rename") await updateWorkout(ctx, d.id, { name: d.name });
    else if (d.op === "delete") await deleteWorkout(ctx, d.id);
    else if (!(await restoreDeletedAthleteRow(ctx, "workout", d.id))) return { success: false, error: "Nothing to restore" };
    revalidatePath("/more/workouts");
    revalidatePath("/more/calendar");
    return { success: true, data: { id } };
  } catch (e) {
    const msg = known(e);
    if (msg) return { success: false, error: msg };
    console.error("[manageWorkout] failed", { op: parsed.data.op });
    return { success: false, error: "Failed to change the workout" };
  }
}
