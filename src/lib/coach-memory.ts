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
import { PlanStateError, planWrite, versionKey, type PlanWriteContext } from "@/lib/plan-revisions";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";

/** Live entries (active or not) a user may keep, so the assistant's read stays small. */
export const COACH_MEMORY_MAX = 200;
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
    const [{ n }] = await w.tx
      .select({ n: count() })
      .from(coachMemory)
      .where(and(eq(coachMemory.userId, ctx.userId), isNull(coachMemory.deletedAt)));
    if (n >= COACH_MEMORY_MAX) {
      throw new PlanStateError(
        `Coach memory is full (${COACH_MEMORY_MAX} entries). Delete or merge old entries first.`,
      );
    }
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

