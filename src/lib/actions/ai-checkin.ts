"use server";

import { db } from "@/db";
import { aiSetupPlans, trainingCycles } from "@/db/schema";
import { checkinDue, revisionFor, type Revision } from "@/lib/utils/ai-checkin";
import { ForbiddenError, assertOwner, requireSession } from "@/lib/utils/session";
import {
  checkinAnswerSchema,
  checkinIssuesSchema,
  editRequestSchema,
  recordAiSetupImportSchema,
  templateParamsSchema,
} from "@/lib/validators/ai-setup";
import type { ActionResult } from "@/types/workout";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

/** Remembers a plan imported from AI Setup, so its cycle gets a check-in a week in. */
export async function recordAiSetupImport(data: unknown): Promise<ActionResult<{ id: number }>> {
  const auth = await requireSession();
  const parsed = recordAiSetupImportSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { cycleId, picks, edit, revisionOf } = parsed.data;

  try {
    const [cycle] = await db
      .select({ userId: trainingCycles.userId })
      .from(trainingCycles)
      .where(eq(trainingCycles.id, cycleId));
    assertOwner(cycle, auth.user.id);
    if (revisionOf !== null) {
      const [original] = await db
        .select({ userId: aiSetupPlans.userId })
        .from(aiSetupPlans)
        .where(eq(aiSetupPlans.id, revisionOf));
      assertOwner(original, auth.user.id);
    }

    const [row] = await db
      .insert(aiSetupPlans)
      .values({ userId: auth.user.id, cycleId, picks, edit, revisionOf })
      .returning({ id: aiSetupPlans.id });
    return { success: true, data: row };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[recordAiSetupImport] failed", { cycleId });
    return { success: false, error: "Failed to record the plan" };
  }
}

export type PendingCheckin = { id: number; cycleName: string };

/** The newest AI Setup plan whose cycle has run a week without a check-in answer, if any. */
export async function getPendingCheckin(): Promise<ActionResult<PendingCheckin | null>> {
  const auth = await requireSession();
  try {
    const rows = await db
      .select({
        id: aiSetupPlans.id,
        checkinStatus: aiSetupPlans.checkinStatus,
        cycleName: trainingCycles.name,
        status: trainingCycles.status,
        startDate: trainingCycles.startDate,
      })
      .from(aiSetupPlans)
      .innerJoin(trainingCycles, eq(aiSetupPlans.cycleId, trainingCycles.id))
      .where(and(eq(aiSetupPlans.userId, auth.user.id), eq(aiSetupPlans.checkinStatus, "pending")))
      .orderBy(desc(aiSetupPlans.id));
    const today = new Date();
    const due = rows.find((r) => checkinDue(r, r, today));
    return { success: true, data: due ? { id: due.id, cycleName: due.cycleName } : null };
  } catch (e) {
    console.error("[getPendingCheckin] failed", e);
    return { success: false, error: "Failed to load the check-in" };
  }
}

/** Stores the athlete's answer. "Not now" is final: the check-in doesn't come back. */
export async function answerCheckin(data: unknown): Promise<ActionResult<{ id: number }>> {
  const auth = await requireSession();
  const parsed = checkinAnswerSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { id, status, issues, note } = parsed.data;

  try {
    const [existing] = await db
      .select({ userId: aiSetupPlans.userId })
      .from(aiSetupPlans)
      .where(eq(aiSetupPlans.id, id));
    assertOwner(existing, auth.user.id);

    await db
      .update(aiSetupPlans)
      .set({
        checkinStatus: status,
        checkinIssues: status === "does_not_fit" ? issues : null,
        checkinNote: status === "does_not_fit" && note.trim() ? note.trim() : null,
        checkinAnsweredAt: new Date(),
      })
      .where(and(eq(aiSetupPlans.id, id), eq(aiSetupPlans.userId, auth.user.id)));
    revalidatePath("/");
    return { success: true, data: { id } };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[answerCheckin] failed", { id });
    return { success: false, error: "Failed to save your answer" };
  }
}

export type RevisionStart = Revision & { revisionOf: number };

/** The revised picks and AI request for a plan answered "doesn't fit", for AI Setup to open with. */
export async function getRevision(id: number): Promise<ActionResult<RevisionStart>> {
  const auth = await requireSession();
  if (!Number.isInteger(id) || id <= 0) return { success: false, error: "Invalid input" };

  try {
    const [row] = await db
      .select({
        userId: aiSetupPlans.userId,
        picks: aiSetupPlans.picks,
        edit: aiSetupPlans.edit,
        checkinStatus: aiSetupPlans.checkinStatus,
        checkinIssues: aiSetupPlans.checkinIssues,
        checkinNote: aiSetupPlans.checkinNote,
      })
      .from(aiSetupPlans)
      .where(eq(aiSetupPlans.id, id));
    assertOwner(row, auth.user.id);
    if (row.checkinStatus !== "does_not_fit") return { success: false, error: "This plan has no check-in to act on" };

    // Stored JSON may predate the current picks; rebuild only from what still validates.
    const picks = templateParamsSchema.safeParse(row.picks);
    if (!picks.success) return { success: false, error: "This plan was built with options AI Setup no longer has" };
    const edit = editRequestSchema.safeParse(row.edit);
    const issues = checkinIssuesSchema.safeParse(row.checkinIssues ?? []);
    const revision = revisionFor(
      { picks: picks.data, edit: edit.success ? edit.data : null },
      issues.success ? issues.data : [],
      row.checkinNote ?? "",
    );
    return { success: true, data: { ...revision, revisionOf: id } };
  } catch (e) {
    if (e instanceof ForbiddenError) return { success: false, error: e.message };
    console.error("[getRevision] failed", { id });
    return { success: false, error: "Failed to load the revision" };
  }
}
