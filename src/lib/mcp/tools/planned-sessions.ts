/**
 * MCP tools: dated sessions (docs/plans/sessions.md, 6). Read the planned
 * sessions of a date range, and move, skip, change, add or remove one, as the
 * user can in the app. Every change is a revision of that session.
 */

import { LIMITS_TEXT, limitRefusal, limitSummary, overrideArgs, overrideFrom } from "@/lib/mcp/limits";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import { REVISION_RULES, assistantContext, planErrorResult, reasonArg } from "@/lib/mcp/revisions";
import { applyRotationOp, applySessionOp, listPlanned, WorkoutSchemaError, type SessionOp } from "@/lib/planned-sessions";
import { moveSuggestion } from "@/lib/session-answers";
import { enduranceEnabledFor } from "@/lib/endurance";
import { sessionCompliance, thresholdValues } from "@/lib/session-compliance";
import { appSessionLoads, type SessionLoadRow } from "@/lib/training-load";
import { workoutPlannedLoad } from "@/lib/utils/step-results";
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

const roundLoad = (p: { load: number; partial: boolean }) => ({ value: Math.round(p.load), partial: p.partial });

/** The load of a logged session for the planned session's sport (all sports when it has none). */
function doneLoad(rows: SessionLoadRow[], sessionId: number, sport: string | null) {
  const mine = rows.filter((r) => r.id === sessionId && (sport === null || r.sport === sport));
  if (!mine.length) return null;
  const known = mine.filter((r) => r.load !== null);
  return known.length
    ? { value: Math.round(known.reduce((a, r) => a + r.load!, 0)), method: known.map((r) => r.method).join("+") }
    : { value: null, method: "none", reason: mine[0].reason ?? null };
}

export function registerPlannedSessionTools(server: McpServer, userId: string, clientId?: string) {
  server.registerTool(
    "list_planned_sessions",
    {
      description: [
        `The planned sessions of a date range (from and to, YYYY-MM-DD, at most ${PLANNED_RANGE_MAX_DAYS} days), for the active cycle and a cycle scheduled to start; cycleId to read one cycle.`,
        "A weekday cycle makes one dated session per program slot for the whole block, and a day can hold up to three (position 1-3). Each can be moved, skipped or changed alone; a template edit rewrites the sessions nobody changed (touched: false) from this week's Monday on. Done sessions, changed ones and earlier weeks never change.",
        "A rotation cycle has no fixed dates: its sessions are worked out from the walk (a missed session repeats the next day), so they have rotationPosition and an id only when you or the user stored a skip or a change for that position.",
        "Each entry: id, cycleId, date, position, programId, programName, label, notes, status (planned; done with loggedSessionId; missed = a past day not done; skipped with skipReason), autoComplete (a day tracked outside the app), touched, templateDate, version.",
        "Weekday sessions also carry: sport, priority (stored or derived: key = hard, or the longest bike or run of its week at 90 minutes or more), hard, workoutSummary, brickParentId, planned and done (durationSeconds, distanceMeters), state (planned, done, missed, unconfirmed = a past endurance session with no match and no answer, illness, sick, skipped), matchedBy (link, pick, app, garmin), ratio and band (green, yellow, orange, red, done, illness), missedReason, illnessId, and suggestedMoveTo for a confirmed missed key session. Matching to Garmin activities is for admins only. A session with a workout also has plannedLoad ({value, partial}: an estimate from its targets, 100 = one hour at threshold; partial when a step had no power or pace target). With endurance features on, a done session has load ({value, method}: run_pace, swim_css, srpe or strength_srpe; null with reason needs_rpe when nothing measured it). Garmin load is not shown here; read get_training_load.",
      ].join(" "),
      inputSchema: { from: dateArg, to: dateArg, cycleId: z.number().int().positive().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ from, to, cycleId }) => {
      if (to < from || to > addDaysStr(from, PLANNED_RANGE_MAX_DAYS)) {
        return fail(`from must be on or before to, and the range at most ${PLANNED_RANGE_MAX_DAYS} days`);
      }
      try {
        const sessions = await listPlanned(userId, from, to, cycleId);
        const facts = new Map((await sessionCompliance(userId, from, to, { cycleId })).map((s) => [s.id, s]));
        // Load (docs/plans/endurance-app.md, 7): planned from a workout's targets, done from what was logged.
        // Endurance switch only (review fix 7); by the linked sessions' ids, so one logged on another day counts (review fix 8).
        const endurance = await enduranceEnabledFor(userId);
        const linked = [...facts.values()].flatMap((f) => (f.loggedSessionId != null ? [f.loggedSessionId] : []));
        const [anchors, logged] = endurance ? await Promise.all([thresholdValues(userId), appSessionLoads(userId, null, null, { sessionIds: linked })]) : [{}, []];
        const out = [];
        for (const s of sessions) {
          const f = s.id != null ? facts.get(s.id) : undefined;
          if (!f) {
            out.push(s);
            continue;
          }
          const suggestion = await moveSuggestion(userId, f);
          out.push({
            ...s,
            sport: f.sport,
            priority: f.priority,
            storedPriority: f.storedPriority,
            hard: f.hard,
            workoutSummary: f.workoutSummary,
            brickParentId: f.brickParentId,
            planned: f.planned,
            done: f.done,
            state: f.state,
            matchedBy: f.matchedBy,
            ratio: f.ratio,
            band: f.band,
            missedReason: f.missedReason,
            illnessId: f.illnessId,
            ...(endurance && f.workout && { plannedLoad: roundLoad(workoutPlannedLoad(f.workout, anchors)) }),
            ...(endurance && f.loggedSessionId != null && { load: doneLoad(logged, f.loggedSessionId, f.sport) }),
            ...(suggestion && { suggestedMoveTo: suggestion }),
          });
        }
        return ok({ sessions: out });
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
        "With endurance features on (docs: logeverylift://docs/workout-steps): 'set_workout' (workout JSON, or workoutId to copy a library workout: the session gets its own copy and runs it instead of a program), 'clear_workout' (programId to run instead), 'update_from_library' (copy the library workout again), 'set_priority' (priority key, support, optional, or null for derived), 'link_brick' (brickParentId: the ride before this run, same day, earlier position), 'unlink_brick'. 'add' also takes workout or workoutId instead of programId, priority and brickParentId. Moving the first session of a brick moves the brick; its later session cannot move alone. set_workout and add run the limits too. A workout that breaks the schema check is refused with every problem and its path, and that check cannot be overridden.",
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        ...overrideArgs,
        operation: z.enum(["move", "skip", "unskip", "change", "reset", "remove", "add", "set_workout", "clear_workout", "update_from_library", "set_priority", "link_brick", "unlink_brick"]),
        workout: z.unknown().optional(),
        workoutId: z.number().int().positive().optional(),
        priority: z.enum(["key", "support", "optional"]).nullable().optional(),
        brickParentId: z.number().int().positive().optional(),
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
          if (args.cycleId == null || args.date == null) return fail("add requires cycleId and date");
          if ((args.programId == null) === (args.workout === undefined && args.workoutId == null)) return fail("add requires programId, or workout or workoutId: one of them");
        } else {
          if (args.id == null) return fail(`${args.operation} requires id`);
          if (args.expectedVersion == null) return fail("expectedVersion is required: read the session with list_planned_sessions");
          if (args.operation === "move" && args.date == null) return fail("move requires date");
        }
        const lc = await limitContext(userId);
        const checked = ["move", "change", "add", "unskip", "reset", "set_workout", "clear_workout", "update_from_library"].includes(args.operation);
        if (args.operation === "clear_workout" && args.programId == null) return fail("clear_workout requires programId");
        if (args.operation === "set_priority" && args.priority === undefined) return fail("set_priority requires priority (or null)");
        if (args.operation === "link_brick" && args.brickParentId == null) return fail("link_brick requires brickParentId");
        if (args.operation === "set_workout" && args.workout === undefined && args.workoutId == null) return fail("set_workout requires workout or workoutId");
        const workoutOp: SessionOp | null =
          args.operation === "set_workout"
            ? { op: "set_workout", id: args.id!, workout: args.workout, workoutId: args.workoutId, expectedVersion: args.expectedVersion }
            : args.operation === "clear_workout"
              ? { op: "clear_workout", id: args.id!, programId: args.programId!, expectedVersion: args.expectedVersion }
              : args.operation === "update_from_library"
                ? { op: "update_from_library", id: args.id!, expectedVersion: args.expectedVersion }
                : args.operation === "set_priority"
                  ? { op: "set_priority", id: args.id!, priority: args.priority ?? null, expectedVersion: args.expectedVersion }
                  : args.operation === "link_brick"
                    ? { op: "link_brick", id: args.id!, brickParentId: args.brickParentId!, expectedVersion: args.expectedVersion }
                    : args.operation === "unlink_brick"
                      ? { op: "unlink_brick", id: args.id!, expectedVersion: args.expectedVersion }
                      : null;
        const input: SessionOp =
          workoutOp ??
          (args.operation === "add"
            ? { op: "add" as const, cycleId: args.cycleId!, date: args.date!, programId: args.programId, workout: args.workout, workoutId: args.workoutId, priority: args.priority, brickParentId: args.brickParentId, position: args.position, label: args.label, notes: args.notes }
            : args.operation === "move"
              ? { op: "move" as const, id: args.id!, date: args.date!, position: args.position, expectedVersion: args.expectedVersion }
              : args.operation === "skip"
                ? { op: "skip" as const, id: args.id!, reason: args.skipReason, expectedVersion: args.expectedVersion }
                : args.operation === "change"
                  ? { op: "change" as const, id: args.id!, programId: args.programId, label: args.label, notes: args.notes, position: args.position, expectedVersion: args.expectedVersion }
                  : { op: args.operation as "unskip" | "reset" | "remove", id: args.id!, expectedVersion: args.expectedVersion });
        const { row, version, limits } = await applySessionOp(ctx, input, checked ? { lc, override } : undefined);
        audit("manage_planned_session", { userId, op: args.operation, id: row.id });
        return ok({ session: row, version, ...(limits && { limits: limitSummary(limits.check, limits.unusedOverrides) }) });
      } catch (e) {
        if (e instanceof LimitRefusedError) return limitRefusal(e);
        if (e instanceof WorkoutSchemaError) return fail(`${e.message}. Fix each problem and send it again.`);
        return (await planErrorResult(userId, e)) ?? failInternal("planned_sessions", e);
      }
    },
  );
}
