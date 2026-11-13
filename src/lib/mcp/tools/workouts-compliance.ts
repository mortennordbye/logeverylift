/**
 * MCP tools: structured workouts, planned vs done and sick periods
 * (docs/plans/workouts-and-compliance.md, section 8). The library tools, the
 * answers and the sick periods register only with the endurance switch on
 * (D18); get_compliance is for every user (decision 13).
 *
 * A workout that breaks the schema check is refused with every problem and
 * its path. That check is never overridable (D3).
 */

import { getLibraryWorkout, createWorkout, deleteWorkout, duplicateWorkout, listWorkouts, updateWorkout } from "@/lib/workouts";
import { addIllness, deleteIllness, listIllness, updateIllness } from "@/lib/illness";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import { LIMITS_TEXT, limitRefusal, limitSummary, overrideArgs, overrideFrom } from "@/lib/mcp/limits";
import { LimitRefusedError, limitContext } from "@/lib/training-limits";
import { REVISION_RULES, assistantContext, planErrorResult, reasonArg } from "@/lib/mcp/revisions";
import { applySessionOp, WorkoutSchemaError } from "@/lib/planned-sessions";
import { confirmDone, moveSuggestion, oneSession } from "@/lib/session-answers";
import { illnessOf, sessionCompliance, thresholdValues, storedWorkout } from "@/lib/session-compliance";
import { DuplicateSession } from "@/lib/logged-sessions";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { addDaysStr } from "@/lib/utils/seasons";
import { CONSISTENCY_WEEKS, RETURN_RULE, SEE_DOCTOR_RULE, consistency, mondayOf, returnInfo } from "@/lib/utils/session-compliance";
import { estimateWorkout, resolveWorkout } from "@/lib/utils/workout-steps";
import { workoutPlannedLoad } from "@/lib/utils/step-results";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Planned load (docs/plans/endurance-app.md, 6.2): an estimate, 100 = one hour at threshold. */
function plannedLoadOut(w: Parameters<typeof workoutPlannedLoad>[0], t: Parameters<typeof workoutPlannedLoad>[1]) {
  const p = workoutPlannedLoad(w, t);
  return { value: Math.round(p.load), partial: p.partial };
}

const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const versionArg = z.number().int().positive().describe("The object's version from your last read or write. A write based on an older version is refused as a conflict.");
const priorityArg = z.enum(["key", "support", "optional"]).nullable();

const SCHEMA_TEXT =
  "The workout is JSON checked by one schema (read the resource logeverylift://docs/workout-steps first). A workout that breaks it is not saved: the result lists every problem with its path. That check cannot be overridden.";

function schemaRefusal(e: unknown) {
  return e instanceof WorkoutSchemaError ? fail(`${e.message}. Fix each problem and send it again.`) : null;
}

/** Endurance-only tools: the library, the answers and sick periods. */
export function registerWorkoutLibraryTools(server: McpServer, userId: string, clientId?: string) {
  server.registerTool(
    "list_workouts",
    {
      description:
        "The user's workout library: reusable structured endurance workouts. Each: id, name, sport, priority (null = derived), summary (one line in the user's units), estimate (durationSeconds, distanceMeters and whether each is complete), version. Filter by sport or search by name; deleted: true lists the recently deleted ones.",
      inputSchema: {
        sport: z.enum(["swim", "bike", "run"]).optional(),
        q: z.string().max(80).optional(),
        deleted: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => {
      try {
        const rows = await listWorkouts(userId, args);
        return ok({
          workouts: rows.map((w) => ({ id: w.id, name: w.name, sport: w.sport, priority: w.priority, summary: w.summary, estimate: w.estimate, version: w.version, deleted: w.deletedAt != null })),
        });
      } catch (e) {
        return failInternal("list_workouts", e);
      }
    },
  );

  server.registerTool(
    "get_workout",
    {
      description:
        "One workout, from the library (workoutId) or a dated session (plannedSessionId): the JSON, the one-line summary, each step's target in the user's own numbers (watts, bpm, pace in their units) from their current thresholds, the estimate, missingAnchors (thresholds the workout needs that the user has not set), and plannedLoad ({value, partial}: an estimate from the targets, 100 = one hour at threshold; partial when a step had no power or pace target, inference).",
      inputSchema: { workoutId: z.number().int().positive().optional(), plannedSessionId: z.number().int().positive().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ workoutId, plannedSessionId }) => {
      if ((workoutId == null) === (plannedSessionId == null)) return fail("Send workoutId or plannedSessionId");
      try {
        const [thresholds, { units }] = await Promise.all([thresholdValues(userId), getUserSettings(userId)]);
        if (workoutId != null) {
          const w = await getLibraryWorkout(userId, workoutId);
          if (!w) return fail("Workout not found");
          const r = resolveWorkout(w.workout, thresholds, units);
          return ok({ ...w, resolvedSteps: r.steps, missingAnchors: r.missingAnchors, estimate: estimateWorkout(w.workout, thresholds), plannedLoad: plannedLoadOut(w.workout, thresholds) });
        }
        const s = await oneSession(userId, plannedSessionId!);
        if (!s) return fail("Planned session not found");
        if (!s.workout) return fail("That session runs a program, not a workout");
        const workout = storedWorkout(s.workout, s.id)!;
        const r = resolveWorkout(workout, thresholds, units);
        return ok({ plannedSessionId: s.id, date: s.date, workout, summary: s.workoutSummary, resolvedSteps: r.steps, missingAnchors: r.missingAnchors, estimate: estimateWorkout(workout, thresholds), plannedLoad: plannedLoadOut(workout, thresholds) });
      } catch (e) {
        return failInternal("get_workout", e);
      }
    },
  );

  server.registerTool(
    "manage_workout",
    {
      description: [
        "Create, update, duplicate or delete a workout in the user's library.",
        "operation='create': workout (JSON), optional priority. 'update': workoutId, expectedVersion, and any of workout, priority, name. 'duplicate': workoutId. 'delete': workoutId, expectedVersion (the user can restore it).",
        "Updating or deleting a library workout changes the dated sessions that a cycle slot made from it and that nobody changed, from this week's Monday on (sessionsRegenerated). Sessions with their own copy, done sessions and earlier weeks keep theirs. To change one day's session, use manage_planned_session set_workout.",
        SCHEMA_TEXT,
        `Every operation requires reason. ${REVISION_RULES}`,
        `On update: ${LIMITS_TEXT} The weeks checked are those of the sessions the edit rewrites.`,
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        ...overrideArgs,
        operation: z.enum(["create", "update", "duplicate", "delete"]),
        workoutId: z.number().int().positive().optional(),
        workout: z.unknown().optional(),
        priority: priorityArg.optional(),
        name: z.string().min(1).max(80).optional(),
        reason: reasonArg,
        expectedVersion: versionArg.optional(),
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
      const override = overrideFrom(args);
      if (typeof override === "string") return fail(override);
      try {
        if (args.operation === "create") {
          if (args.workout === undefined) return fail("create requires workout");
          const r = await createWorkout(ctx, { workout: args.workout, priority: args.priority });
          audit("manage_workout", { userId, op: "create", id: r.id });
          return ok({ workoutId: r.id, version: r.version });
        }
        if (args.workoutId == null) return fail(`${args.operation} requires workoutId`);
        if (args.operation === "duplicate") {
          const r = await duplicateWorkout(ctx, args.workoutId);
          audit("manage_workout", { userId, op: "duplicate", id: r.id });
          return ok({ workoutId: r.id, version: r.version });
        }
        if (args.expectedVersion == null) return fail("expectedVersion is required: read the workout with list_workouts");
        if (args.operation === "delete") {
          const r = await deleteWorkout(ctx, args.workoutId, args.expectedVersion);
          audit("manage_workout", { userId, op: "delete", id: args.workoutId });
          return ok({ deleted: true, ...r });
        }
        const r = await updateWorkout(
          ctx,
          args.workoutId,
          { workout: args.workout, priority: args.priority, name: args.name, expectedVersion: args.expectedVersion },
          { lc: await limitContext(userId), override },
        );
        audit("manage_workout", { userId, op: "update", id: args.workoutId });
        return ok({
          workoutId: r.id,
          version: r.version,
          sessionsRegenerated: r.sessionsRegenerated,
          ...(r.limits && { limits: limitSummary(r.limits.check, r.limits.unusedOverrides) }),
        });
      } catch (e) {
        if (e instanceof LimitRefusedError) return limitRefusal(e);
        return schemaRefusal(e) ?? (await planErrorResult(userId, e)) ?? failInternal("manage_workout", e);
      }
    },
  );

  server.registerTool(
    "confirm_planned_session",
    {
      description: [
        "Answer \"did you do it?\" for one dated endurance session (list_planned_sessions shows state 'unconfirmed' for a past session with no match).",
        "outcome='done': durationSeconds, optional distanceMeters, rpe (1-10), notes: logs a workout on the session's day, linked to it (it shows as logged by the assistant). For admins, garminActivityId instead links a Garmin activity (list_garmin_activities) from that day or the day before or after.",
        "outcome='missed': optional reason. A missed easy session is skipped: the plan goes on. A missed key session gets suggestedMoveTo, a free day in the same week next to no hard day; move it with manage_planned_session move if the user wants (D19), or leave it.",
        "outcome='unmiss': back to planned (a mistaken answer).",
        `Requires reason; 'missed', 'unmiss' and a Garmin link also require expectedVersion (the session's). ${REVISION_RULES}`,
      ].join(" "),
      annotations: { openWorldHint: false },
      inputSchema: {
        plannedSessionId: z.number().int().positive(),
        outcome: z.enum(["done", "missed", "unmiss"]),
        durationSeconds: z.number().int().min(60).max(86_400).optional(),
        distanceMeters: z.number().int().min(0).max(1_000_000).optional(),
        rpe: z.number().int().min(1).max(10).optional(),
        notes: z.string().max(500).optional(),
        garminActivityId: z.number().int().positive().optional(),
        missedReason: z.string().max(200).optional(),
        reason: reasonArg,
        expectedVersion: versionArg.optional(),
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
      try {
        if (args.outcome === "done" && args.garminActivityId == null) {
          if (args.durationSeconds == null) return fail("done requires durationSeconds, or garminActivityId");
          const r = await confirmDone(ctx, args.plannedSessionId, { durationSeconds: args.durationSeconds, distanceMeters: args.distanceMeters, rpe: args.rpe, notes: args.notes }, "assistant");
          audit("confirm_planned_session", { userId, id: args.plannedSessionId, outcome: "done" });
          const s = await oneSession(userId, args.plannedSessionId);
          return ok({ loggedSessionId: r.sessionId, state: s?.state, band: s?.band, ratio: s?.ratio });
        }
        if (args.expectedVersion == null) return fail("expectedVersion is required: read the session with list_planned_sessions");
        const op =
          args.outcome === "done"
            ? { op: "pick" as const, id: args.plannedSessionId, garminActivityId: args.garminActivityId!, expectedVersion: args.expectedVersion }
            : args.outcome === "missed"
              ? { op: "miss" as const, id: args.plannedSessionId, reason: args.missedReason ?? null, expectedVersion: args.expectedVersion }
              : { op: "unmiss" as const, id: args.plannedSessionId, expectedVersion: args.expectedVersion };
        const { version } = await applySessionOp(ctx, op);
        audit("confirm_planned_session", { userId, id: args.plannedSessionId, outcome: args.outcome });
        const s = await oneSession(userId, args.plannedSessionId);
        const suggestion = s ? await moveSuggestion(userId, s) : null;
        return ok({ version, state: s?.state, priority: s?.priority, band: s?.band, ...(suggestion && { suggestedMoveTo: suggestion }) });
      } catch (e) {
        if (e instanceof DuplicateSession) return fail(e.message);
        return (await planErrorResult(userId, e)) ?? failInternal("confirm_planned_session", e);
      }
    },
  );

  server.registerTool(
    "manage_illness",
    {
      description: [
        "Log a sick period as one entry (D20): sessions inside it read as missed by illness, with no \"did you do it?\" prompt, and the plan does not change by itself.",
        "operation='add': startedOn (today or earlier), optional endedOn (null = still sick; at most 14 days ahead), severity (mild: nose and throat only; moderate: cough or short of breath; severe: fever over 38 °C, chills, aches, chest pain or a racing heart), notes. 'update': illnessId, expectedVersion, any field. 'end': illnessId, expectedVersion, optional endedOn (default yesterday). 'delete': illnessId, expectedVersion.",
        "Periods never overlap. The result lists the return rule (IOC 2022): before moderate or hard training, a 10-20 minute test at 60-70% of normal intensity; stop and see a doctor on symptoms. Do not plan intensity until the athlete reports a normal test.",
        `Requires reason. ${REVISION_RULES}`,
      ].join(" "),
      annotations: { destructiveHint: true, openWorldHint: false },
      inputSchema: {
        operation: z.enum(["add", "update", "end", "delete"]),
        illnessId: z.number().int().positive().optional(),
        startedOn: dateArg.optional(),
        endedOn: dateArg.nullable().optional(),
        severity: z.enum(["mild", "moderate", "severe"]).nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
        reason: reasonArg,
        expectedVersion: versionArg.optional(),
      },
    },
    async (args) => {
      const ctx = assistantContext(userId, clientId, args.reason);
      try {
        let id: number;
        let version: number | undefined;
        if (args.operation === "add") {
          if (!args.startedOn) return fail("add requires startedOn");
          ({ id, version } = await addIllness(ctx, { startedOn: args.startedOn, endedOn: args.endedOn ?? null, severity: args.severity ?? null, notes: args.notes ?? null }));
        } else {
          if (args.illnessId == null) return fail(`${args.operation} requires illnessId`);
          if (args.expectedVersion == null) return fail("expectedVersion is required: read the sick periods with get_athlete_profile");
          id = args.illnessId;
          if (args.operation === "delete") {
            await deleteIllness(ctx, id, args.expectedVersion);
            audit("manage_illness", { userId, op: "delete", id });
            return ok({ deleted: true, illnessId: id });
          }
          const today = toDateStr(await userToday(userId));
          const patch =
            args.operation === "end"
              ? { endedOn: args.endedOn ?? addDaysStr(today, -1) }
              : { startedOn: args.startedOn, endedOn: args.endedOn, severity: args.severity, notes: args.notes };
          ({ version } = await updateIllness(ctx, id, { ...patch, expectedVersion: args.expectedVersion }));
        }
        audit("manage_illness", { userId, op: args.operation, id });
        const today = toDateStr(await userToday(userId));
        const periods = await illnessOf(userId);
        const p = periods.find((x) => x.id === id);
        const sessions = p ? await sessionCompliance(userId, p.startedOn, p.endedOn ?? addDaysStr(today, 14)) : [];
        return ok({
          illnessId: id,
          version,
          sessionsReadAsIllness: sessions.filter((s) => s.illnessId === id).map((s) => ({ id: s.id, date: s.date, state: s.state })),
          returnInfo: returnInfo(periods, today, [], { days: 14, untilFirstSession: false }),
        });
      } catch (e) {
        return (await planErrorResult(userId, e)) ?? failInternal("manage_illness", e);
      }
    },
  );
}

/** For every user: compliance and consistency (decision 13). */
export function registerComplianceTools(server: McpServer, userId: string) {
  server.registerTool(
    "get_compliance",
    {
      description: [
        `Planned vs done over weeks (Monday to Sunday, the user's zone). weeks: 1-52, default ${CONSISTENCY_WEEKS}. Per full week: counted sessions, done sessions, complete (at least 80% done). consistency: complete weeks over counted weeks, and this week apart.`,
        "Counted: planned sessions minus those skipped before their day (a plan change). Missed and illness count as not done. Bands per done session: green 80-120% of plan by duration (else distance), yellow 50-79% or 121-150%, orange further off, red missed.",
        "Evidence: athletes who completed over 80% of planned training weeks were 7 times more likely to reach their goal (IOC 2022, study); counting it per week from sessions is inference.",
      ].join(" "),
      inputSchema: { weeks: z.number().int().min(1).max(52).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ weeks = CONSISTENCY_WEEKS }) => {
      try {
        const today = toDateStr(await userToday(userId));
        const from = addDaysStr(mondayOf(today), -7 * weeks);
        const sessions = await sessionCompliance(userId, from, addDaysStr(mondayOf(today), 6));
        const c = consistency(
          sessions.map((s) => ({ date: s.date, done: s.state === "done", skipped: s.status === "skipped", statusOn: s.statusOn })),
          today,
          weeks,
        );
        const bands: Record<string, number> = {};
        for (const s of sessions) if (s.band) bands[s.band] = (bands[s.band] ?? 0) + 1;
        const bySport: Record<string, { planned: number; done: number }> = {};
        for (const s of sessions) {
          if (s.date >= today && s.state !== "done") continue;
          const k = s.sport ?? "strength";
          bySport[k] ??= { planned: 0, done: 0 };
          bySport[k].planned++;
          if (s.state === "done") bySport[k].done++;
        }
        return ok({ ...c, bands, bySport, evidence: "IOC 2022 (study) for the 80% predictor; per-week counting is inference" });
      } catch (e) {
        return failInternal("get_compliance", e);
      }
    },
  );
}

/** Sick periods and the return rule for get_athlete_profile. */
export async function illnessForProfile(userId: string) {
  const today = toDateStr(await userToday(userId));
  const rows = await listIllness(userId);
  const cut = addDaysStr(today, -90);
  const periods = rows.filter((r) => r.endedOn == null || r.endedOn >= cut);
  return {
    sickPeriods: periods.map((p) => ({ id: p.id, startedOn: p.startedOn, endedOn: p.endedOn, severity: p.severity, notes: p.notes, version: p.version })),
    returnInfo: returnInfo(rows, today, [], { days: 14, untilFirstSession: false }),
    returnRule: [...RETURN_RULE, SEE_DOCTOR_RULE],
  };
}
