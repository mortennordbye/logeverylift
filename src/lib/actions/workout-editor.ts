"use server";

/**
 * The workout editor and the session controls the assistant had alone
 * (docs/plans/bike-sessions.md, 5.3): save an edited workout for one session,
 * for the library, or as a new library workout; preview the training limits
 * before Save; add a library workout on a calendar day; and priority, update
 * from library and "Not missed" on a session. Endurance features only (D18).
 *
 * Every save is one change set with writer `user`: undoPlanChangeSet undoes it.
 */

import { db } from "@/db";
import { plannedSessions, workoutSessions } from "@/db/schema";
import { enduranceEnabledFor } from "@/lib/endurance";
import { livePlannedSessions } from "@/lib/plan-live";
import { PlanConflictError, PlanNotFoundError, PlanStateError, restoreChangeSet, type PlanWriteContext } from "@/lib/plan-revisions";
import { applySessionOp, WorkoutSchemaError } from "@/lib/planned-sessions";
import { limitContext, NO_OVERRIDE } from "@/lib/training-limits";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { requireSession } from "@/lib/utils/session";
import type { LimitCheck } from "@/lib/utils/training-limits";
import { createWorkout, handEditedSessions, listWorkouts, previewSessionWorkout, previewWorkoutUpdate, updateWorkout } from "@/lib/workouts";
import type { ActionResult } from "@/types/workout";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const ENDURANCE_OFF = "Endurance features are not on for this account";
const id = z.number().int().positive();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

const saveSchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("session"), sessionId: id, workout: z.unknown() }),
  z.object({ target: z.literal("later"), workoutId: id, sessionId: id.optional(), workout: z.unknown() }),
  z.object({ target: z.literal("new"), workout: z.unknown(), plan: z.object({ cycleId: id, date: day }).optional() }),
]);

const previewSchema = z.object({ sessionId: id.optional(), workoutId: id.optional(), workout: z.unknown() });

const addSchema = z.object({ cycleId: id, date: day, workoutId: id });

const menuSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_priority"), id, priority: z.enum(["key", "support", "optional"]).nullable() }),
  z.object({ op: z.literal("update_from_library"), id }),
  z.object({ op: z.literal("unmiss"), id }),
]);

export type SavedWorkout = { changeSetId: string; workoutId: number | null; sessionId: number | null; warnings: string[] };

const warningsOf = (check: LimitCheck | null | undefined) => check?.warnings.map((w) => w.message) ?? [];

function failure(e: unknown, tag: string): { success: false; error: string; fieldErrors?: Record<string, string[]> } {
  if (e instanceof WorkoutSchemaError) {
    return { success: false, error: "Fix the marked fields.", fieldErrors: Object.fromEntries(e.errors.map((x) => [x.path || "workout", [x.message]])) };
  }
  if (e instanceof PlanNotFoundError || e instanceof PlanStateError || e instanceof PlanConflictError) return { success: false, error: e.message };
  console.error(`[${tag}] failed`);
  return { success: false, error: "Failed to save the workout" };
}

function revalidateAll(sessionId: number | null) {
  revalidatePath("/");
  revalidatePath("/week");
  revalidatePath("/more/calendar");
  revalidatePath("/more/workouts");
  if (sessionId != null) revalidatePath(`/planned/${sessionId}`);
}

/** A session with a workout started for it, or done, does not change. */
async function assertOpen(userId: string, sessionId: number) {
  const [row] = await db
    .select({ id: plannedSessions.id })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.id, sessionId), eq(plannedSessions.userId, userId), livePlannedSessions));
  if (!row) throw new PlanNotFoundError({ type: "planned_session", id: sessionId });
  const [started] = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.plannedSessionId, sessionId), eq(workoutSessions.userId, userId)))
    .limit(1);
  if (started) throw new PlanStateError("This session is started or done. It cannot change.");
}

/**
 * Save the editor's workout. `session`: this session's own copy (set_workout).
 * `later`: the library workout, so untouched later sessions follow; with a
 * session that was changed by hand, that session takes the new version too.
 * `new`: a new library workout, and with `plan`, a session of it on that day.
 */
export async function saveEditedWorkout(data: unknown): Promise<ActionResult<SavedWorkout>> {
  const auth = await requireSession();
  const parsed = saveSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  const userId = auth.user.id;
  if (!(await enduranceEnabledFor(userId))) return { success: false, error: ENDURANCE_OFF };
  const changeSetId = `user:${randomUUID()}`;
  const ctx = (): PlanWriteContext => ({ userId, writer: "user", changeSetId });
  const d = parsed.data;
  try {
    const lc = await limitContext(userId);
    const limits = { lc, override: NO_OVERRIDE, mode: "warn" as const };
    if (d.target === "session") {
      await assertOpen(userId, d.sessionId);
      const r = await applySessionOp(ctx(), { op: "set_workout", id: d.sessionId, workout: d.workout }, limits);
      revalidateAll(d.sessionId);
      return { success: true, data: { changeSetId, workoutId: null, sessionId: d.sessionId, warnings: warningsOf(r.limits?.check) } };
    }
    if (d.target === "later") {
      if (d.sessionId != null) await assertOpen(userId, d.sessionId);
      const r = await updateWorkout(ctx(), d.workoutId, { workout: d.workout }, limits);
      const warnings = warningsOf(r.limits?.check);
      if (d.sessionId != null) {
        const [row] = await db
          .select({ touchedAt: plannedSessions.touchedAt, workoutId: plannedSessions.workoutId })
          .from(plannedSessions)
          .where(and(eq(plannedSessions.id, d.sessionId), eq(plannedSessions.userId, userId), livePlannedSessions));
        // An untouched session followed the library in the update above.
        if (row && (row.touchedAt != null || row.workoutId !== d.workoutId)) {
          const s = await applySessionOp(ctx(), { op: "set_workout", id: d.sessionId, workoutId: d.workoutId }, limits);
          warnings.push(...warningsOf(s.limits?.check).filter((w) => !warnings.includes(w)));
        }
      }
      revalidateAll(d.sessionId ?? null);
      return { success: true, data: { changeSetId, workoutId: d.workoutId, sessionId: d.sessionId ?? null, warnings } };
    }
    const created = await createWorkout(ctx(), { workout: d.workout });
    let sessionId: number | null = null;
    let warnings: string[] = [];
    if (d.plan) {
      try {
        const r = await applySessionOp(ctx(), { op: "add", cycleId: d.plan.cycleId, date: d.plan.date, workoutId: created.id }, limits);
        sessionId = r.row.id;
        warnings = warningsOf(r.limits?.check);
      } catch (e) {
        // The day refused it: take the new library workout back too, so nothing half saves.
        await restoreChangeSet(ctx(), changeSetId);
        throw e;
      }
    }
    revalidateAll(sessionId);
    return { success: true, data: { changeSetId, workoutId: created.id, sessionId, warnings } };
  } catch (e) {
    return failure(e, "saveEditedWorkout");
  }
}

export type SavePreview = {
  /** Limit warnings if saved for this session only; null when there is no session. */
  session: string[] | null;
  /** Limit warnings if saved to the library workout; null when there is none. */
  later: string[] | null;
  /** Coming sessions that keep their own version on a library save. */
  keepOwn: { id: number; date: string }[];
};

/** What the save sheet shows before Save: the training limits in warn mode, and the sessions that keep their own version. */
export async function previewEditedWorkout(data: unknown): Promise<ActionResult<SavePreview>> {
  const auth = await requireSession();
  const parsed = previewSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  const userId = auth.user.id;
  if (!(await enduranceEnabledFor(userId))) return { success: false, error: ENDURANCE_OFF };
  const { sessionId, workoutId, workout } = parsed.data;
  try {
    const lc = await limitContext(userId);
    const ctx = (): PlanWriteContext => ({ userId, writer: "user" });
    const session = sessionId != null ? warningsOf(await previewSessionWorkout(ctx(), sessionId, workout, lc)) : null;
    const later = workoutId != null ? warningsOf(await previewWorkoutUpdate(ctx(), workoutId, workout, lc)) : null;
    const today = toDateStr(await userToday(userId));
    const keepOwn = workoutId != null ? (await handEditedSessions(userId, workoutId, today)).filter((s) => s.id !== sessionId) : [];
    return { success: true, data: { session, later, keepOwn } };
  } catch (e) {
    return failure(e, "previewEditedWorkout");
  }
}

/** Calendar "Add session": a library workout on a coming day of a weekday cycle. */
export async function addWorkoutSession(data: unknown): Promise<ActionResult<{ sessionId: number; changeSetId: string; warnings: string[] }>> {
  const auth = await requireSession();
  const parsed = addSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  const userId = auth.user.id;
  if (!(await enduranceEnabledFor(userId))) return { success: false, error: ENDURANCE_OFF };
  const changeSetId = `user:${randomUUID()}`;
  try {
    const lc = await limitContext(userId);
    const r = await applySessionOp(
      { userId, writer: "user", changeSetId },
      { op: "add", cycleId: parsed.data.cycleId, date: parsed.data.date, workoutId: parsed.data.workoutId },
      { lc, override: NO_OVERRIDE, mode: "warn" },
    );
    revalidateAll(r.row.id);
    return { success: true, data: { sessionId: r.row.id, changeSetId, warnings: warningsOf(r.limits?.check) } };
  } catch (e) {
    return failure(e, "addWorkoutSession");
  }
}

/** The session page menu: priority, "Update from library" and "Not missed". */
export async function sessionMenuOp(data: unknown): Promise<ActionResult<{ id: number }>> {
  const auth = await requireSession();
  const parsed = menuSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  const userId = auth.user.id;
  if (!(await enduranceEnabledFor(userId))) return { success: false, error: ENDURANCE_OFF };
  try {
    const d = parsed.data;
    if (d.op === "update_from_library") await assertOpen(userId, d.id);
    await applySessionOp({ userId, writer: "user" }, d);
    revalidateAll(d.id);
    return { success: true, data: { id: d.id } };
  } catch (e) {
    if (e instanceof PlanNotFoundError) return { success: false, error: "Session not found" };
    if (e instanceof PlanStateError || e instanceof PlanConflictError) return { success: false, error: e.message };
    console.error("[sessionMenuOp] failed", { op: parsed.data.op });
    return { success: false, error: "Failed to change the session" };
  }
}

/** The library, for the template builder's "Use a workout". */
export async function libraryForPicker(): Promise<ActionResult<{ id: number; name: string; sport: "swim" | "bike" | "run"; summary: string }[]>> {
  const auth = await requireSession();
  if (!(await enduranceEnabledFor(auth.user.id))) return { success: false, error: ENDURANCE_OFF };
  try {
    const rows = await listWorkouts(auth.user.id);
    return { success: true, data: rows.map((w) => ({ id: w.id, name: w.name, sport: w.sport, summary: w.summary })) };
  } catch (e) {
    console.error("[libraryForPicker] failed", e);
    return { success: false, error: "Failed to read the workouts" };
  }
}
