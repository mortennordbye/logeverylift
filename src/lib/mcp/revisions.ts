/**
 * MCP side of the revision layer (docs/plans/revisions.md, 2.10): the
 * arguments every plan write takes, how its errors read to the model, and the
 * tools to list and restore revisions.
 */

import { db } from "@/db";
import { planRevisions } from "@/db/schema";
import { fail, failInternal, ok } from "@/lib/mcp/result";
import {
  OpenWorkoutError,
  PlanConflictError,
  PlanNotFoundError,
  PlanStateError,
  listAssistantChangeSets,
  listRevisions,
  restoreChangeSet,
  restoreRevision,
  type PlanWriteContext,
} from "@/lib/plan-revisions";
import { limitSummary } from "@/lib/mcp/limits";
import {
  NO_FACTS,
  limitCyclesWith,
  cycleScope,
  evaluateLimits,
  limitContext,
  planFacts,
  type LimitScope,
} from "@/lib/training-limits";
import { diffSnapshots, type PlanSnapshot } from "@/lib/utils/plan-revisions";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq, gt, lt, ne, desc, max } from "drizzle-orm";
import { z } from "zod";

export const reasonArg = z
  .string()
  .min(1)
  .max(500)
  .describe("Why you make this change, in a sentence the user will read in the app's history.");

export const expectedVersionArg = z
  .number()
  .int()
  .positive()
  .describe(
    "The version you read (from get_program or get_training_cycle, or the result of your last write). A write based on an older version is refused as a conflict.",
  );

export const REVISION_RULES =
  "Every change makes a revision the user can see and restore in the app; nothing you change is lost.";

export function assistantContext(userId: string, clientId: string | undefined, reason: string): PlanWriteContext {
  return { userId, writer: "assistant", clientId: clientId ?? null, reason };
}

/** What changed after the version the model read, so it can redo its change. */
async function conflictText(userId: string, e: PlanConflictError): Promise<string> {
  const since = await db
    .select()
    .from(planRevisions)
    .where(
      and(
        eq(planRevisions.userId, userId),
        eq(planRevisions.objectType, e.target.type),
        eq(planRevisions.objectId, e.target.id),
        gt(planRevisions.version, e.expectedVersion),
        ne(planRevisions.action, "conflict"),
      ),
    )
    .orderBy(asc(planRevisions.id))
    .limit(20);
  const lines: string[] = [];
  for (const r of since) {
    const [prior] = await db
      .select({ snapshot: planRevisions.snapshot })
      .from(planRevisions)
      .where(
        and(
          eq(planRevisions.userId, userId),
          eq(planRevisions.objectType, r.objectType),
          eq(planRevisions.objectId, r.objectId),
          lt(planRevisions.id, r.id),
          ne(planRevisions.action, "conflict"),
        ),
      )
      .orderBy(desc(planRevisions.id))
      .limit(1);
    const changes = diffSnapshots((prior?.snapshot as PlanSnapshot) ?? null, r.snapshot as PlanSnapshot);
    lines.push(`version ${r.version} by ${r.writer} at ${r.createdAt.toISOString()}: ${changes.join("; ") || r.action}`);
  }
  return `${e.message} Changes since: ${lines.join(" | ") || "none recorded"}. Read it again and redo the change.`;
}

/** A tool result for an error from the revision layer, or null for any other error. */
export async function planErrorResult(userId: string, e: unknown) {
  if (e instanceof PlanConflictError) return fail(await conflictText(userId, e));
  if (e instanceof PlanNotFoundError || e instanceof PlanStateError) return fail(e.message);
  if (e instanceof OpenWorkoutError) {
    return fail("The user has a workout in progress on this plan. Try again after it is finished.");
  }
  return null;
}

/** The limit scope of a restored program or cycle (T4: restores get warnings, never a block). */
async function restoreScope(userId: string, type: "program" | "cycle" | "memory", id: number): Promise<LimitScope | null> {
  if (type === "program") return { programIds: [id], cycleIds: await limitCyclesWith(db, userId, id) };
  if (type === "cycle") return (await cycleScope(id, 1))?.scope ?? null;
  return null;
}

export function registerRevisionTools(server: McpServer, userId: string, clientId?: string) {
  server.registerTool(
    "list_revisions",
    {
      description: [
        "List the change history of one program or training cycle (objectType and objectId), newest first: who changed it (user, assistant, progression engine, weekly sync, Garmin suggestion), when, the reason and what changed.",
        "Without objectType, list your own (assistant) change sets instead: each groups the writes of one review.",
        "Use the revision id or the change-set id with restore_revision.",
      ].join(" "),
      inputSchema: {
        objectType: z.enum(["program", "cycle"]).optional(),
        objectId: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ objectType, objectId }) => {
      try {
        if (objectType) {
          if (objectId == null) return fail("objectId is required with objectType");
          const revisions = await listRevisions(userId, { type: objectType, id: objectId });
          if (revisions.length === 0) return fail("No history for that object");
          return ok(
            revisions.map((r) => ({
              revisionId: r.id,
              version: r.version,
              action: r.action,
              writer: r.writer,
              reason: r.reason,
              changeSetId: r.changeSetId,
              at: r.createdAt,
              changes: r.changes,
            })),
          );
        }
        return ok(await listAssistantChangeSets(userId));
      } catch (e) {
        return failInternal("revisions", e);
      }
    },
  );

  server.registerTool(
    "restore_revision",
    {
      description: [
        "Restore a program or training cycle to an earlier revision (revisionId), or undo a whole change set (changeSetId).",
        "A restore keeps all ids and never changes logged workouts. Weekly targets owned by the sync, and weights or reps the progression engine set since, keep their current values; the weekly sync runs again. A restore is itself a revision and can be restored.",
        "Requires a reason. Refused while the user has a workout in progress on the program.",
        "A restore of one revision runs the training limits as warnings only: it is never refused for them, and the result lists any limit the restored plan breaks.",
      ].join(" "),
      inputSchema: {
        revisionId: z.number().int().positive().optional(),
        changeSetId: z.string().min(1).max(100).optional(),
        reason: reasonArg,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ revisionId, changeSetId, reason }) => {
      const ctx = assistantContext(userId, clientId, reason);
      try {
        if (revisionId != null) {
          const [rev] = await db
            .select({ objectType: planRevisions.objectType, objectId: planRevisions.objectId })
            .from(planRevisions)
            .where(and(eq(planRevisions.id, revisionId), eq(planRevisions.userId, userId)));
          if (!rev) return fail("Revision not found");
          // The limits as warnings (T4): read the plan around the restore.
          const lc = await limitContext(userId);
          const scope = lc.endurance ? await restoreScope(userId, rev.objectType, rev.objectId) : null;
          const before = scope ? await planFacts(db, scope) : NO_FACTS;
          const [{ last }] = await db.select({ last: max(planRevisions.id) }).from(planRevisions).where(eq(planRevisions.userId, userId));
          const done = await restoreRevision(ctx, revisionId);
          if (!done) return fail("Revision not found");
          if (!scope) return ok({ restored: true, ...done });
          const after = await planFacts(db, scope);
          const { blocking, check } = evaluateLimits(lc, before, after, { rules: [], reason: null });
          check.warnings = blocking;
          check.passed = check.checked.filter((r) => !blocking.some((b) => b.rule === r));
          // Stored on the restore's revisions, so the user sees the warning too.
          await db
            .update(planRevisions)
            .set({ limitCheck: check })
            .where(and(eq(planRevisions.userId, userId), gt(planRevisions.id, last ?? 0), eq(planRevisions.writer, "assistant")));
          return ok({ restored: true, ...done, limits: limitSummary(check) });
        }
        if (changeSetId) {
          const done = await restoreChangeSet(ctx, changeSetId);
          if (!done) return fail("Change set not found");
          return ok({ restored: true, ...done });
        }
        return fail("Provide revisionId or changeSetId");
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("revisions", e);
      }
    },
  );
}
