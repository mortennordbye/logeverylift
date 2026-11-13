/**
 * MCP side of the revision layer (docs/plans/revisions.md, 2.10): the
 * arguments every plan write takes, how its errors read to the model, and the
 * tools to list and restore revisions.
 */

import { db } from "@/db";
import { PLAN_OBJECT_TYPES, planRevisions, plannedSessions, type PlanObjectType } from "@/db/schema";
import { fail, failInternal, ok } from "@/lib/mcp/result";
import { enduranceEnabledFor } from "@/lib/endurance";
import {
  ENDURANCE_OFF,
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
  NO_OVERRIDE,
  asWarnings,
  limitCyclesWith,
  cycleScope,
  evaluateLimits,
  limitContext,
  planFacts,
  type LimitContext,
  type LimitScope,
} from "@/lib/training-limits";
import type { LimitCheck } from "@/lib/utils/training-limits";
import { diffSnapshots, type PlanSnapshot } from "@/lib/utils/plan-revisions";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq, gt, isNull, lt, ne, desc, max } from "drizzle-orm";
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
async function restoreScope(userId: string, type: PlanObjectType, id: number, revisionId: number): Promise<LimitScope | null> {
  if (type === "program") return { programIds: [id], cycleIds: await limitCyclesWith(db, userId, id) };
  if (type === "cycle") return (await cycleScope(id, 1))?.scope ?? null;
  if (type === "planned_session") {
    // The weeks of the session now and in the restored version (review 24).
    const { mondayOf } = await import("@/lib/utils/planned-sessions");
    // plan-read: includes deleted (a removed session can be restored)
    const [row] = await db
      .select({ date: plannedSessions.date })
      .from(plannedSessions)
      .where(and(eq(plannedSessions.id, id), eq(plannedSessions.userId, userId)));
    const [rev] = await db
      .select({ snapshot: planRevisions.snapshot })
      .from(planRevisions)
      .where(and(eq(planRevisions.id, revisionId), eq(planRevisions.userId, userId)));
    const target = (rev?.snapshot as { session?: { date?: unknown } } | undefined)?.session?.date;
    const dates = [row?.date, typeof target === "string" ? target : null].filter((d): d is string => d != null);
    return { programIds: [], cycleIds: [], sessionWeeks: { userId, mondays: [...new Set(dates.map(mondayOf))].sort() } };
  }
  return null;
}

/** The limit scope of a whole change set: the union of each touched object's scope. */
async function changeSetScope(userId: string, changeSetId: string): Promise<LimitScope | null> {
  const revs = await db
    .select({ id: planRevisions.id, objectType: planRevisions.objectType, objectId: planRevisions.objectId })
    .from(planRevisions)
    .where(and(eq(planRevisions.userId, userId), eq(planRevisions.changeSetId, changeSetId)))
    .orderBy(asc(planRevisions.id));
  const first = new Map<string, (typeof revs)[number]>();
  for (const r of revs) if (!first.has(`${r.objectType}:${r.objectId}`)) first.set(`${r.objectType}:${r.objectId}`, r);
  const programIds = new Set<number>();
  const cycleIds = new Set<number>();
  const mondays = new Set<string>();
  for (const r of first.values()) {
    const s = await restoreScope(userId, r.objectType, r.objectId, r.id);
    if (!s) continue;
    s.programIds.forEach((id) => programIds.add(id));
    s.cycleIds.forEach((id) => cycleIds.add(id));
    s.sessionWeeks?.mondays.forEach((m) => mondays.add(m));
  }
  if (!programIds.size && !cycleIds.size && !mondays.size) return null;
  return {
    programIds: [...programIds].sort((a, b) => a - b),
    cycleIds: [...cycleIds].sort((a, b) => a - b),
    ...(mondays.size && { sessionWeeks: { userId, mondays: [...mondays].sort() } }),
  };
}

/**
 * Run a restore with the limits around it as warnings (T4): the plan before
 * and after, and the check stored on this restore's revisions so the user
 * sees the warning too. Null when the restore found nothing.
 */
async function restoreWithWarnings<T extends object>(
  userId: string,
  clientId: string | undefined,
  lc: LimitContext,
  scope: LimitScope | null,
  restore: () => Promise<T | null>,
): Promise<{ done: T; check: LimitCheck | null } | null> {
  const before = scope ? await planFacts(db, scope) : NO_FACTS;
  const [{ last }] = await db.select({ last: max(planRevisions.id) }).from(planRevisions).where(eq(planRevisions.userId, userId));
  const done = await restore();
  if (!done) return null;
  if (!scope) return { done, check: null };
  const after = await planFacts(db, scope);
  const { blocking, check } = evaluateLimits(lc, before, after, NO_OVERRIDE);
  const warned = asWarnings(check, blocking);
  await db
    .update(planRevisions)
    .set({ limitCheck: warned })
    .where(
      and(
        eq(planRevisions.userId, userId),
        gt(planRevisions.id, last ?? 0),
        // Only this restore's rows: a restore by this client, not
        // another assistant's write that landed meanwhile.
        eq(planRevisions.writer, "assistant"),
        eq(planRevisions.action, "restore"),
        clientId ? eq(planRevisions.clientId, clientId) : isNull(planRevisions.clientId),
      ),
    );
  return { done, check: warned };
}

/** Object types of the endurance add-on: listed and restored only with the switch on (D18). */
const ENDURANCE_TYPES = new Set<string>(["athlete", "injury", "workout", "illness"]);

export function registerRevisionTools(server: McpServer, userId: string, clientId?: string) {
  server.registerTool(
    "list_revisions",
    {
      description: [
        "List the change history of one program, training cycle, season, dated session (planned_session), coach memory entry, the athlete profile (athlete), a threshold value, an injury, a library workout (workout) or a sick period (illness) (objectType and objectId; the last four need endurance features on), newest first: who changed it (user, assistant, progression engine, weekly sync, Garmin suggestion), when, the reason and what changed.",
        "Without objectType, list your own (assistant) change sets instead: each groups the writes of one review.",
        "Use the revision id or the change-set id with restore_revision.",
      ].join(" "),
      inputSchema: {
        objectType: z.enum(PLAN_OBJECT_TYPES).optional(),
        objectId: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ objectType, objectId }) => {
      try {
        if (objectType) {
          if (objectId == null) return fail("objectId is required with objectType");
          // The athlete profile, injuries, workouts and sick periods belong to the endurance add-on (D18).
          if (ENDURANCE_TYPES.has(objectType) && !(await enduranceEnabledFor(userId))) return fail(ENDURANCE_OFF);
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
        "Restore a program, training cycle, season (its fields and races; phases stay where they are), dated session (a logged or past one, or one on a day that has passed, is refused), coach memory entry, the athlete profile, a threshold value, an injury, a library workout or a sick period to an earlier revision (revisionId), or undo a whole change set (changeSetId). The athlete profile, injuries, workouts and sick periods need endurance features on.",
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
          const scope = lc.endurance ? await restoreScope(userId, rev.objectType, rev.objectId, revisionId) : null;
          const out = await restoreWithWarnings(userId, clientId, lc, scope, () => restoreRevision(ctx, revisionId));
          if (!out) return fail("Revision not found");
          return ok({ restored: true, ...out.done, ...(out.check && { limits: limitSummary(out.check) }) });
        }
        if (changeSetId) {
          // The limits as warnings on a whole undo too: the scope is every
          // program, cycle and dated session the change set touched.
          const lc = await limitContext(userId);
          const scope = lc.endurance ? await changeSetScope(userId, changeSetId) : null;
          const out = await restoreWithWarnings(userId, clientId, lc, scope, () => restoreChangeSet(ctx, changeSetId));
          if (!out) return fail("Change set not found");
          return ok({ restored: true, ...out.done, ...(out.check && { limits: limitSummary(out.check) }) });
        }
        return fail("Provide revisionId or changeSetId");
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("revisions", e);
      }
    },
  );
}
