/**
 * MCP tools: dated sessions (docs/plans/sessions.md, 6). Read the planned
 * sessions of a date range, and move, skip, change, add or remove one, as the
 * user can in the app. Every change is a revision of that session.
 */

import { LIMITS_TEXT, limitRefusal, limitSummary, overrideArgs, overrideFrom } from "@/lib/mcp/limits";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import { REVISION_RULES, assistantContext, planErrorResult, reasonArg } from "@/lib/mcp/revisions";
import { applyRotationOp, applySessionOp, listPlanned } from "@/lib/planned-sessions";
import { LimitRefusedError, limitContext } from "@/lib/training-limits";
import { PLANNED_RANGE_MAX_DAYS, addDaysStr } from "@/lib/utils/planned-sessions";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const sessionVersionArg = z
  .number()
  .int()
  .positive()
  .describe("The session's version from list_planned_sessions or your last write. A write based on an older version is refused as a conflict.");

export function registerPlannedSessionTools(server: McpServer, userId: string, clientId?: string) {
  server.registerTool(
    "list_planned_sessions",
    {
      description: [
        `The planned sessions of a date range (from and to, YYYY-MM-DD, at most ${PLANNED_RANGE_MAX_DAYS} days), for the active cycle and a cycle scheduled to start; cycleId to read one cycle.`,
        "A weekday cycle makes one dated session per program slot for the whole block, and a day can hold up to three (position 1-3). Each can be moved, skipped or changed alone; a template edit rewrites the sessions nobody changed (touched: false) from this week's Monday on. Done sessions, changed ones and earlier weeks never change.",
        "A rotation cycle has no fixed dates: its sessions are worked out from the walk (a missed session repeats the next day), so they have rotationPosition and an id only when you or the user stored a skip or a change for that position.",
        "Each entry: id, cycleId, date, position, programId, programName, label, notes, status (planned; done with loggedSessionId; missed = a past day not done; skipped with skipReason), autoComplete (a day tracked outside the app), touched, templateDate, version.",
      ].join(" "),
      inputSchema: { from: dateArg, to: dateArg, cycleId: z.number().int().positive().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ from, to, cycleId }) => {
      if (to < from || to > addDaysStr(from, PLANNED_RANGE_MAX_DAYS)) {
        return fail(`from must be on or before to, and the range at most ${PLANNED_RANGE_MAX_DAYS} days`);
      }
      try {
        return ok({ sessions: await listPlanned(userId, from, to, cycleId) });
      } catch (e) {
        return failInternal("planned_sessions", e);
      }
    },
  );

  server.registerTool(
    "manage_planned_session",
    {
      description: [
        "Change one dated session of the user's plan.",
        "Weekday cycles, by id: operation='move' (date, optional position 1-3: a day from today to the last day of the block; never a past day), 'skip' (optional skipReason), 'unskip' (a skipped session from today on), 'change' (any of programId, label, notes, position), 'reset' (back to what the template says, on its template day), 'remove' (only a session added by hand; skip a template session instead).",
        "operation='add': cycleId, date, programId, optional position, label, notes: an extra session on a day of a weekday cycle. A day holds at most three sessions.",
        "Rotation cycles, by cycleId and rotationPosition (from list_planned_sessions): 'skip', 'unskip' and 'change' (programId), only for a position still to come in this block. A rotation session cannot be moved: one that is not done moves to the next day by itself.",
        "A session that is logged, or a day that has passed, does not change: a past session can only be skipped (declined), or moved forward if it was missed.",
        `Every operation requires reason; all but add, and the first change to a rotation position, require expectedVersion (the session's version). ${REVISION_RULES}`,
        `On move, change, add, unskip and reset: ${LIMITS_TEXT} Hard sessions are counted in each Monday-to-Sunday week the change touches.`,
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        ...overrideArgs,
        operation: z.enum(["move", "skip", "unskip", "change", "reset", "remove", "add"]),
        id: z.number().int().positive().optional(),
        cycleId: z.number().int().positive().optional(),
        rotationPosition: z.number().int().min(0).optional(),
        date: dateArg.optional(),
        position: z.number().int().min(1).max(3).optional(),
        programId: z.number().int().positive().optional(),
        label: z.string().max(100).nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
        skipReason: z.string().max(200).nullable().optional(),
        reason: reasonArg,
        expectedVersion: sessionVersionArg.optional(),
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
      const override = overrideFrom(args);
      if (typeof override === "string") return fail(override);
      try {
        // Rotation: by walk position.
        if (args.rotationPosition !== undefined) {
          if (args.cycleId == null) return fail("cycleId is required with rotationPosition");
          if (args.operation !== "skip" && args.operation !== "unskip" && args.operation !== "change") {
            return fail("A rotation session can only be skipped, unskipped or changed");
          }
          if (args.operation === "change" && args.programId == null) return fail("programId is required to change a rotation session");
          const { row, version } = await applyRotationOp(ctx, {
            op: args.operation,
            cycleId: args.cycleId,
            rotationPosition: args.rotationPosition,
            programId: args.programId,
            reason: args.skipReason,
            expectedVersion: args.expectedVersion,
          });
          audit("manage_planned_session", { userId, op: args.operation, id: row.id });
          return ok({ session: row, version, limits: { notChecked: [{ rule: "hard_sessions_per_week", why: "Rotation cycles have no fixed week." }] } });
        }
        if (args.operation === "add") {
          if (args.cycleId == null || args.date == null || args.programId == null) return fail("add requires cycleId, date and programId");
        } else {
          if (args.id == null) return fail(`${args.operation} requires id`);
          if (args.expectedVersion == null) return fail("expectedVersion is required: read the session with list_planned_sessions");
          if (args.operation === "move" && args.date == null) return fail("move requires date");
        }
        const lc = await limitContext(userId);
        const checked = ["move", "change", "add", "unskip", "reset"].includes(args.operation);
        const input =
          args.operation === "add"
            ? { op: "add" as const, cycleId: args.cycleId!, date: args.date!, programId: args.programId!, position: args.position, label: args.label, notes: args.notes }
            : args.operation === "move"
              ? { op: "move" as const, id: args.id!, date: args.date!, position: args.position, expectedVersion: args.expectedVersion }
              : args.operation === "skip"
                ? { op: "skip" as const, id: args.id!, reason: args.skipReason, expectedVersion: args.expectedVersion }
                : args.operation === "change"
                  ? { op: "change" as const, id: args.id!, programId: args.programId, label: args.label, notes: args.notes, position: args.position, expectedVersion: args.expectedVersion }
                  : { op: args.operation, id: args.id!, expectedVersion: args.expectedVersion };
        const { row, version, limits } = await applySessionOp(ctx, input, checked ? { lc, override } : undefined);
        audit("manage_planned_session", { userId, op: args.operation, id: row.id });
        return ok({ session: row, version, ...(limits && { limits: limitSummary(limits.check, limits.unusedOverrides) }) });
      } catch (e) {
        if (e instanceof LimitRefusedError) return limitRefusal(e);
        return (await planErrorResult(userId, e)) ?? failInternal("planned_sessions", e);
      }
    },
  );
}
