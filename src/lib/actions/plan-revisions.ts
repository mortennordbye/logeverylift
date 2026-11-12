"use server";

/**
 * Plan history in the app (docs/plans/revisions.md, 2.9): the revisions of a
 * program or cycle, restore, Recently deleted, the AI changes feed, and
 * "Apply my value" on a change that met a conflict.
 */

import { db } from "@/db";
import { oauthClients, planRevisions, programSets, programs, trainingCycles, type PlanObjectType } from "@/db/schema";
import {
  OpenWorkoutError,
  PlanNotFoundError,
  PlanStateError,
  listAssistantChangeSets,
  listDeleted,
  listRevisions,
  planWrite,
  restoreChangeSet,
  restoreRevision,
  setProgram,
  type ChangeSetEntry,
  type RevisionEntry,
} from "@/lib/plan-revisions";
import { requireSession } from "@/lib/utils/session";
import type { ActionResult } from "@/types/workout";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const objectSchema = z.object({
  type: z.enum(["program", "cycle"]),
  id: z.number().int().positive(),
});

export type PlanHistory = {
  name: string;
  version: number;
  deleted: boolean;
  revisions: (RevisionEntry & { clientName: string | null })[];
};

async function clientNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ clientId: oauthClients.clientId, name: oauthClients.name })
    .from(oauthClients)
    .where(inArray(oauthClients.clientId, wanted));
  return new Map(rows.map((r) => [r.clientId, r.name ?? "An assistant"]));
}

function revalidateObject(type: PlanObjectType, id: number) {
  if (type === "memory") {
    revalidatePath("/more/coach-memory");
    return;
  }
  if (type === "athlete" || type === "threshold" || type === "injury") {
    revalidatePath("/more/athlete");
    revalidatePath("/more/thresholds");
    return;
  }
  if (type === "program") {
    revalidatePath("/programs");
    revalidatePath(`/programs/${id}`);
    revalidatePath(`/programs/${id}/history`);
  } else {
    revalidatePath("/cycles");
    revalidatePath(`/cycles/${id}`);
    revalidatePath(`/cycles/${id}/history`);
  }
  revalidatePath("/");
}

/** The history of one of the caller's programs or cycles, newest first. */
export async function getPlanHistory(data: unknown): Promise<ActionResult<PlanHistory>> {
  const auth = await requireSession();
  const parsed = objectSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { type, id } = parsed.data;
  try {
    const table = type === "program" ? programs : trainingCycles;
    const [row] = await db
      // plan-read: includes deleted (a deleted object's history stays readable)
      .select({ name: table.name, version: table.version, deletedAt: table.deletedAt })
      .from(table)
      .where(and(eq(table.id, id), eq(table.userId, auth.user.id)));
    if (!row) return { success: false, error: type === "program" ? "Program not found" : "Cycle not found" };
    const revisions = await listRevisions(auth.user.id, { type, id });
    const names = await clientNames(revisions.map((r) => r.clientId));
    return {
      success: true,
      data: {
        name: row.name,
        version: row.version,
        deleted: row.deletedAt != null,
        revisions: revisions.map((r) => ({ ...r, clientName: r.clientId ? names.get(r.clientId) ?? "An assistant" : null })),
      },
    };
  } catch (e) {
    console.error("[getPlanHistory] failed", { type, id }, e);
    return { success: false, error: "Failed to load the history" };
  }
}

const revisionSchema = z.object({ revisionId: z.number().int().positive() });

/** Restore a program or cycle to one of its revisions. */
export async function restorePlanRevision(
  data: unknown,
): Promise<ActionResult<{ objectType: PlanObjectType; objectId: number; skipped: string[] }>> {
  const auth = await requireSession();
  const parsed = revisionSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const done = await restoreRevision({ userId: auth.user.id, writer: "user" }, parsed.data.revisionId);
    if (!done) return { success: false, error: "Revision not found" };
    revalidateObject(done.objectType, done.objectId);
    return { success: true, data: done };
  } catch (e) {
    if (e instanceof OpenWorkoutError || e instanceof PlanNotFoundError || e instanceof PlanStateError) {
      return { success: false, error: e.message };
    }
    console.error("[restorePlanRevision] failed", { revisionId: parsed.data.revisionId }, e);
    return { success: false, error: "Failed to restore" };
  }
}

const changeSetSchema = z.object({ changeSetId: z.string().min(1).max(100) });

/** Undo every change in one change set (an assistant's review). */
export async function undoPlanChangeSet(data: unknown): Promise<ActionResult<{ objects: number; skipped: string[] }>> {
  const auth = await requireSession();
  const parsed = changeSetSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const done = await restoreChangeSet({ userId: auth.user.id, writer: "user" }, parsed.data.changeSetId);
    if (!done) return { success: false, error: "Change set not found" };
    revalidatePath("/programs");
    revalidatePath("/cycles");
    revalidatePath("/more/assistants/changes");
    revalidatePath("/more/coach-memory");
    revalidatePath("/more/athlete");
    revalidatePath("/more/thresholds");
    revalidatePath("/");
    return { success: true, data: done };
  } catch (e) {
    if (e instanceof OpenWorkoutError || e instanceof PlanNotFoundError || e instanceof PlanStateError) {
      return { success: false, error: e.message };
    }
    console.error("[undoPlanChangeSet] failed", e);
    return { success: false, error: "Failed to undo the changes" };
  }
}

const deletedSchema = z.object({ type: z.enum(["program", "cycle"]) });

/** Programs or cycles the caller deleted and can still restore. */
export async function getDeletedPlans(
  data: unknown,
): Promise<ActionResult<{ id: number; name: string; deletedAt: Date; revisionId: number | null }[]>> {
  const auth = await requireSession();
  const parsed = deletedSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: "Invalid input" };
  try {
    return { success: true, data: await listDeleted(auth.user.id, parsed.data.type) };
  } catch (e) {
    console.error("[getDeletedPlans] failed", e);
    return { success: false, error: "Failed to load deleted plans" };
  }
}

/** The caller's assistant change sets, newest first, with the assistant's name. */
export async function getAssistantChanges(): Promise<ActionResult<(ChangeSetEntry & { clientName: string })[]>> {
  const auth = await requireSession();
  try {
    const sets = await listAssistantChangeSets(auth.user.id);
    const names = await clientNames(sets.map((s) => s.clientId));
    return {
      success: true,
      data: sets.map((s) => ({ ...s, clientName: (s.clientId && names.get(s.clientId)) || "An assistant" })),
    };
  } catch (e) {
    console.error("[getAssistantChanges] failed", e);
    return { success: false, error: "Failed to load assistant changes" };
  }
}

/**
 * "Apply my value" on a change from the workout that was not applied because
 * the plan had changed (docs/plans/revisions.md, 2.7). A normal user write.
 */
export async function applyRejectedChange(data: unknown): Promise<ActionResult<null>> {
  const auth = await requireSession();
  const parsed = revisionSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    const [rev] = await db
      .select()
      .from(planRevisions)
      .where(and(eq(planRevisions.id, parsed.data.revisionId), eq(planRevisions.userId, auth.user.id)));
    if (!rev || rev.action !== "conflict") return { success: false, error: "Not found" };
    const rejected = rev.rejected as { sets?: { programSetId: number; fields: Record<string, unknown> }[] } | null;
    const writes: { programSetId: number; values: Partial<typeof programSets.$inferInsert> }[] = [];
    for (const set of rejected?.sets ?? []) {
      const owner = await setProgram(db, set.programSetId, auth.user.id);
      // Only sets still in this program; a removed set has nothing to apply to.
      if (!owner || owner.programId !== rev.objectId) continue;
      const fields = set.fields;
      const values: Partial<typeof programSets.$inferInsert> = {};
      if (fields.targetReps !== undefined) values.targetReps = fields.targetReps as number | null;
      if (fields.weightKg !== undefined) {
        values.weightKg = fields.weightKg == null ? null : Number(fields.weightKg).toFixed(2);
      }
      if (fields.durationSeconds !== undefined) values.durationSeconds = fields.durationSeconds as number | null;
      if (Object.keys(values).length > 0) writes.push({ programSetId: set.programSetId, values });
    }
    if (writes.length === 0) return { success: false, error: "That set is no longer in the plan" };
    await planWrite({ userId: auth.user.id, writer: "user", reason: "Applied a change from a workout" }, async (w) => {
      await w.touch({ type: "program", id: rev.objectId });
      for (const x of writes) await w.tx.update(programSets).set(x.values).where(eq(programSets.id, x.programSetId));
    });
    revalidateObject("program", rev.objectId);
    return { success: true, data: null };
  } catch (e) {
    console.error("[applyRejectedChange] failed", { revisionId: parsed.data.revisionId }, e);
    return { success: false, error: "Failed to apply the change" };
  }
}
