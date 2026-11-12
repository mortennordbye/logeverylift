/**
 * Coach memory (docs/plans/ai-coach.md, 2.5; decision T10): one module for
 * the app's Server Actions and the MCP tools. Plain server code that takes a
 * resolved userId. Every write goes through the revision layer as object type
 * `memory`, so each change can be seen and undone, and assistant writes are
 * grouped with the rest of the assistant's review.
 *
 * Not checked by the training limits: memory is context, not a plan change.
 * Not sent to the in-app AI (AI Setup, the check-in): only the user's own
 * connected assistant reads it.
 */

import { db } from "@/db";
import { coachMemory, planRevisions, type CoachMemoryKind } from "@/db/schema";
import {
  COACH_MEMORY_MAX,
  assertMemoryRoom,
  planWrite,
  restoreRevision,
  versionKey,
  type PlanWriteContext,
} from "@/lib/plan-revisions";
import { DELETED_PLAN_RETENTION_DAYS } from "@/lib/utils/plan-revisions";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { PlanConflictError, PlanNotFoundError } from "@/lib/plan-revisions";
import { and, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";

/** Live entries (active or not) a user may keep, so the assistant's read stays small. */
export { COACH_MEMORY_MAX };
export const COACH_MEMORY_TEXT_MAX = 1000;

export type CoachMemoryEntry = typeof coachMemory.$inferSelect & {
  /** Who wrote it last: the user, or the assistant's OAuth client id. */
  lastWriter: "user" | "assistant";
  lastClientId: string | null;
};

/** The user's live entries, newest first; inactive ones only when asked. */
export async function listCoachMemory(userId: string, includeInactive = false): Promise<CoachMemoryEntry[]> {
  const rows = await db
    .select()
    .from(coachMemory)
    .where(
      and(eq(coachMemory.userId, userId), isNull(coachMemory.deletedAt), includeInactive ? undefined : eq(coachMemory.active, true)),
    )
    .orderBy(desc(coachMemory.entryDate), desc(coachMemory.id));
  if (rows.length === 0) return [];
  const revs = await db
    .select({ objectId: planRevisions.objectId, writer: planRevisions.writer, clientId: planRevisions.clientId })
    .from(planRevisions)
    .where(
      and(
        eq(planRevisions.userId, userId),
        eq(planRevisions.objectType, "memory"),
        inArray(
          planRevisions.objectId,
          rows.map((r) => r.id),
        ),
      ),
    )
    .orderBy(desc(planRevisions.id));
  const last = new Map<number, { writer: string; clientId: string | null }>();
  for (const r of revs) if (!last.has(r.objectId)) last.set(r.objectId, r);
  return rows.map((r) => {
    const l = last.get(r.id);
    return { ...r, lastWriter: l?.writer === "assistant" ? "assistant" : "user", lastClientId: l?.clientId ?? null };
  });
}

export type MemoryInput = { kind: CoachMemoryKind; text: string; entryDate?: string };

export async function addCoachMemory(ctx: PlanWriteContext, input: MemoryInput) {
  const entryDate = input.entryDate ?? toDateStr(await userToday(ctx.userId));
  const { result, versions } = await planWrite(ctx, async (w) => {
    await assertMemoryRoom(w.tx, ctx.userId);
    const [row] = await w.tx
      .insert(coachMemory)
      .values({ userId: ctx.userId, kind: input.kind, text: input.text, entryDate })
      .returning();
    w.create({ type: "memory", id: row.id });
    return row;
  });
  return { ...result, version: versions.get(versionKey({ type: "memory", id: result.id })) ?? 1 };
}

export type MemoryChange = Partial<MemoryInput> & { active?: boolean };

/** Update, (de)activate or soft delete one entry. Throws PlanNotFoundError or PlanConflictError. */
export async function changeCoachMemory(
  ctx: PlanWriteContext,
  id: number,
  change: MemoryChange | "delete",
  expectedVersion?: number,
) {
  // Nothing to change: no write, no revision, no new version.
  if (change !== "delete" && Object.values(change).every((v) => v === undefined)) {
    const [row] = await db
      .select()
      .from(coachMemory)
      .where(and(eq(coachMemory.id, id), eq(coachMemory.userId, ctx.userId), isNull(coachMemory.deletedAt)));
    if (!row) throw new PlanNotFoundError({ type: "memory", id });
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      throw new PlanConflictError({ type: "memory", id }, row.version, expectedVersion);
    }
    return { entry: row, version: row.version };
  }
  const { result, versions } = await planWrite(ctx, async (w) => {
    if (change === "delete") {
      await w.touch({ type: "memory", id }, { action: "delete", expectedVersion });
      await w.tx.update(coachMemory).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(coachMemory.id, id));
      return null;
    }
    await w.touch({ type: "memory", id }, { expectedVersion });
    const set: Partial<typeof coachMemory.$inferInsert> = { updatedAt: new Date() };
    if (change.kind !== undefined) set.kind = change.kind;
    if (change.text !== undefined) set.text = change.text;
    if (change.entryDate !== undefined) set.entryDate = change.entryDate;
    if (change.active !== undefined) set.active = change.active;
    const [row] = await w.tx.update(coachMemory).set(set).where(eq(coachMemory.id, id)).returning();
    return row;
  });
  return { entry: result, version: versions.get(versionKey({ type: "memory", id })) ?? null };
}

/** Entries the user deleted that can still be restored (90 days), newest first. */
export async function listDeletedCoachMemory(userId: string) {
  const since = new Date(Date.now() - DELETED_PLAN_RETENTION_DAYS * 86_400_000);
  return db
    .select()
    .from(coachMemory)
    .where(and(eq(coachMemory.userId, userId), isNotNull(coachMemory.deletedAt), gt(coachMemory.deletedAt, since)))
    .orderBy(desc(coachMemory.deletedAt));
}

/** Bring a deleted entry back from the revision of its delete. Null when there is none. */
export async function restoreDeletedCoachMemory(ctx: PlanWriteContext, id: number) {
  // The same window the Recently deleted list shows: older entries are gone for good soon.
  const since = new Date(Date.now() - DELETED_PLAN_RETENTION_DAYS * 86_400_000);
  const [row] = await db
    .select({ deletedAt: coachMemory.deletedAt })
    .from(coachMemory)
    .where(and(eq(coachMemory.id, id), eq(coachMemory.userId, ctx.userId), gt(coachMemory.deletedAt, since)));
  if (!row?.deletedAt) return null;
  const [rev] = await db
    .select({ id: planRevisions.id })
    .from(planRevisions)
    .where(
      and(
        eq(planRevisions.userId, ctx.userId),
        eq(planRevisions.objectType, "memory"),
        eq(planRevisions.objectId, id),
        eq(planRevisions.action, "delete"),
      ),
    )
    .orderBy(desc(planRevisions.id))
    .limit(1);
  if (!rev) return null;
  return restoreRevision(ctx, rev.id);
}

