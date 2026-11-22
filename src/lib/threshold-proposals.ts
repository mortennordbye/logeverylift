/**
 * Coach proposals (docs/plans/strict-targets.md, decisions 5 and 9): the
 * connected coach proposes a threshold from the athlete's data, and the user
 * accepts or declines it in Account › Training numbers. Nothing changes
 * without the user's yes: accept writes the value as a threshold with source
 * coach, through the revision layer; decline closes the proposal.
 *
 * Plain server code that takes a resolved userId, for the app's Server
 * Actions and the MCP tool. Every query filters by userId.
 */

import { db } from "@/db";
import { thresholdProposals, type ThresholdKind } from "@/db/schema";
import { PlanStateError, addThreshold, resolveThresholdValue } from "@/lib/athlete-profile";
import { and, count, desc, eq, sql } from "drizzle-orm";

export type ProposalRow = typeof thresholdProposals.$inferSelect;

/** What the estimate rests on, as the coach sent it. */
export type ProposalEvidence = { dates?: string[]; activityIds?: number[]; numbers?: Record<string, number>; note?: string };

export const PROPOSAL_REASON_MAX = 200;

const NOT_OPEN = "This proposal is no longer open";

const openOf = (userId: string) => and(eq(thresholdProposals.userId, userId), eq(thresholdProposals.status, "open"));

/** The user's open proposals, newest first. */
export async function listOpenProposals(userId: string): Promise<ProposalRow[]> {
  return db.select().from(thresholdProposals).where(openOf(userId)).orderBy(desc(thresholdProposals.createdAt), desc(thresholdProposals.id));
}

/** How many proposals wait for the user's answer (the dot on Account). */
export async function openProposalCount(userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(thresholdProposals).where(openOf(userId));
  return row?.n ?? 0;
}

/**
 * Store a proposal. The value is stored metric and checked against the kind's
 * range. An open proposal of the same kind is replaced (deleted), so the user
 * answers only the latest. Throws PlanStateError on a value out of range.
 */
export async function proposeThreshold(
  userId: string,
  input: { kind: ThresholdKind; value: number; reason: string; evidence?: ProposalEvidence | null },
): Promise<{ proposal: ProposalRow; replacedId: number | null }> {
  const value = resolveThresholdValue({ kind: input.kind, value: input.value });
  return db.transaction(async (tx) => {
    // One open proposal per kind: two proposals at once must not both insert.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`threshold_proposal:${userId}`}))`);
    const [old] = await tx
      .delete(thresholdProposals)
      .where(and(openOf(userId), eq(thresholdProposals.kind, input.kind)))
      .returning({ id: thresholdProposals.id });
    const [proposal] = await tx
      .insert(thresholdProposals)
      .values({ userId, kind: input.kind, value, reason: input.reason, evidence: input.evidence ?? null })
      .returning();
    return { proposal, replacedId: old?.id ?? null };
  });
}

/**
 * Accept an open proposal: its value becomes a threshold dated today with
 * source coach, written by the user, and the proposal closes in the same
 * transaction. Throws PlanStateError when it is not the user's open proposal.
 */
export async function acceptProposal(userId: string, id: number) {
  const [p] = await db
    .select()
    .from(thresholdProposals)
    .where(and(eq(thresholdProposals.id, id), openOf(userId)));
  if (!p) throw new PlanStateError(NOT_OPEN);
  const { threshold } = await addThreshold(
    { userId, writer: "user", reason: "Accepted a coach proposal" },
    { kind: p.kind, value: p.value, source: "coach", notes: p.reason },
    {
      after: async (tx, row) => {
        const closed = await tx
          .update(thresholdProposals)
          .set({ status: "accepted", decidedAt: new Date(), thresholdId: row.id })
          .where(and(eq(thresholdProposals.id, id), openOf(userId)))
          .returning({ id: thresholdProposals.id });
        // Declined or replaced since the read: no threshold is added.
        if (closed.length === 0) throw new PlanStateError(NOT_OPEN);
      },
    },
  );
  return threshold;
}

/** Decline an open proposal. Throws PlanStateError when it is not the user's open proposal. */
export async function declineProposal(userId: string, id: number): Promise<void> {
  const closed = await db
    .update(thresholdProposals)
    .set({ status: "declined", decidedAt: new Date() })
    .where(and(eq(thresholdProposals.id, id), openOf(userId)))
    .returning({ id: thresholdProposals.id });
  if (closed.length === 0) throw new PlanStateError(NOT_OPEN);
}
