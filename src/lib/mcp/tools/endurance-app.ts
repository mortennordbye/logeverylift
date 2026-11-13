/**
 * MCP tools: training load and per-step results (docs/plans/endurance-app.md,
 * section 7). Registered only with the endurance switch on (D18). The guided
 * player has no tool: it is a device screen.
 */

import { DuplicateSession } from "@/lib/logged-sessions";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import { reasonArg } from "@/lib/mcp/revisions";
import { PlanStateError } from "@/lib/plan-revisions";
import { StepResultsError, getStepResults, saveStepResults } from "@/lib/step-results";
import { getTrainingLoad } from "@/lib/training-load";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);

/** The evidence label of each load rule (endurance-app.md 6.6). */
export const LOAD_EVIDENCE = [
  { rule: "TSS = hours x IF^2 x 100", label: "Coach convention" },
  { rule: "run_pace: the same formula with IF = speed / threshold speed", label: "Inference" },
  { rule: "swim_css: hours x IF^3 x 100 with IF = speed / CSS", label: "Inference" },
  { rule: "srpe: minutes x session RPE x 0.22", label: "Inference" },
  { rule: "Fitness (CTL, 42 days), fatigue (ATL, 7 days), form = CTL - ATL", label: "Coach convention" },
  { rule: "Ramp: up to 5 a week normal, 5-8 fast, above 8 a warning", label: "Coach convention" },
] as const;

const stepArg = z
  .object({
    key: z.string().min(1).max(40).describe("The step key: the step id, plus #n for round n of a repeat (s3#2). get_step_results lists them."),
    status: z.enum(["done", "skipped", "partial", "not_done"]),
    activeSeconds: z.number().int().min(0).optional(),
    distanceMeters: z.number().min(0).optional(),
    value: z.number().min(0).optional().describe("One measured number in the target's metric unit: watts, bpm, m/s or rpm."),
    rpe: z.number().int().min(1).max(10).optional(),
    notes: z.string().max(280).optional(),
  })
  .strict();

export function registerEnduranceAppTools(server: McpServer, userId: string) {
  server.registerTool(
    "get_training_load",
    {
      description: [
        "Training load, fitness, fatigue and form, on one scale (100 = one hour at threshold).",
        "source 'garmin' when the user has Garmin data (that series also holds the app sessions Garmin did not record), else 'app' from sessions logged in the app. The two are never added.",
        "App methods: run_pace (needs a threshold pace), swim_css (needs CSS), srpe (minutes x RPE x 0.22), strength_srpe. A session with no RPE and no usable threshold has no load: it is listed in noLoad, never guessed.",
        "Per day: load, fitness (ctl), fatigue (atl) and form (tsb) per sport and total. ramp is the 7-day change in total fitness with its band. The first 42 days are calibrating. evidence gives the label of each rule.",
      ].join(" "),
      inputSchema: { days: z.number().int().min(7).max(365).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ days }) => {
      try {
        const t = await getTrainingLoad(userId, days ?? 90);
        return ok({
          source: t.source,
          days: t.days.map((d) => ({
            date: d.date,
            calibrating: d.calibrating,
            ...Object.fromEntries(Object.entries(d.tracks).map(([k, p]) => [k, { load: r1(p.load), ctl: r1(p.ctl), atl: r1(p.atl), tsb: r1(p.tsb) }])),
          })),
          ramp: r1(t.ramp),
          rampBand: t.rampBand,
          noLoad: t.noLoad,
          methods: t.methods,
          evidence: LOAD_EVIDENCE,
        });
      } catch (e) {
        return failInternal("get_training_load", e);
      }
    },
  );

  server.registerTool(
    "get_step_results",
    {
      description:
        "Per-step results of a structured session, by plannedSessionId or workoutSessionId: each step's key, planned time and distance and target (resolved with the thresholds of that day), the result (status, active time, distance, measured value, RPE, notes), its band (green, yellow, orange, red) and whether the value was in the target. Also the session RPE, time, distance, its load with the method, and the planned load estimate. Null results when none were logged.",
      inputSchema: { plannedSessionId: z.number().int().positive().optional(), workoutSessionId: z.number().int().positive().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ plannedSessionId, workoutSessionId }) => {
      if ((plannedSessionId == null) === (workoutSessionId == null)) return fail("Send plannedSessionId or workoutSessionId");
      try {
        const v = await getStepResults(userId, { plannedSessionId, workoutSessionId });
        if (!v) return ok({ results: null });
        return ok({
          workoutSessionId: v.workoutSessionId,
          plannedSessionId: v.plannedSessionId,
          date: v.date,
          source: v.source,
          name: v.workout.name,
          sport: v.workout.sport,
          sessionRpe: v.sessionRpe,
          durationSeconds: v.durationSeconds,
          distanceMeters: v.distanceMeters,
          load: v.load ? { value: r1(v.load.value), method: v.load.method, reason: v.load.reason } : null,
          plannedLoad: { value: Math.round(v.plannedLoad.load), partial: v.plannedLoad.partial },
          steps: v.rows.map((r) => ({
            key: r.key,
            type: r.type,
            round: r.round,
            planned: { text: r.text, seconds: r.plannedSeconds, meters: r.plannedMeters, target: r.target ? { low: r.target.low, high: r.target.high, unit: r.target.unit, text: r.target.text } : null },
            result: r.result,
            band: r.compare.band,
            targetHit: r.compare.hit,
          })),
        });
      } catch (e) {
        return failInternal("get_step_results", e);
      }
    },
  );

  server.registerTool(
    "log_step_results",
    {
      description: [
        "Log the per-step results of a structured session, for example from what the athlete tells you.",
        "plannedSessionId and steps (keys from get_step_results or get_workout: the step id, plus #n for round n of a repeat). Optional sessionRpe (1-10; without it and without a threshold the session has no load), distanceMeters, notes.",
        "When the session is not logged yet, this writes it as a completed session linked to the planned one, with the total active time. When it is, the results attach to it and replace earlier ones; sessionRpe fills only sets with no RPE, and distanceMeters goes on the session only when it has no distance. Step results are logged data: they make no revision.",
        "Requires reason.",
      ].join(" "),
      inputSchema: {
        plannedSessionId: z.number().int().positive(),
        steps: z.array(stepArg).min(1).max(400),
        sessionRpe: z.number().int().min(1).max(10).optional(),
        distanceMeters: z.number().int().min(0).max(1_000_000).optional(),
        notes: z.string().max(500).optional(),
        reason: reasonArg,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      try {
        const r = await saveStepResults(
          userId,
          { plannedSessionId: args.plannedSessionId, steps: args.steps, sessionRpe: args.sessionRpe, distanceMeters: args.distanceMeters, notes: args.notes },
          "assistant",
        );
        audit("log_step_results", { plannedSessionId: args.plannedSessionId, workoutSessionId: r.workoutSessionId });
        return ok({ workoutSessionId: r.workoutSessionId, written: r.created === "session" ? "new session" : "attached to the logged session" });
      } catch (e) {
        if (e instanceof StepResultsError || e instanceof PlanStateError || e instanceof DuplicateSession) return fail(e.message);
        return failInternal("log_step_results", e);
      }
    },
  );
}
