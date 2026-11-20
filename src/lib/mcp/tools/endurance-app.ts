/**
 * MCP tools: training load, per-step results (docs/plans/endurance-app.md,
 * section 7) and rides (docs/plans/bike-ride-logger.md, step 5). Registered
 * only with the endurance switch on (D18). The guided player and ride mode
 * have no tool: they are device screens, and no tool changes a running ride (D9).
 */

import { enduranceEnabledFor } from "@/lib/endurance";
import { DuplicateSession } from "@/lib/logged-sessions";
import { audit, fail, failInternal, ok } from "@/lib/mcp/result";
import { reasonArg } from "@/lib/mcp/revisions";
import { PlanStateError } from "@/lib/plan-revisions";
import { saveSessionStepResults } from "@/lib/program-step-results";
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
  { rule: "bike_power: the same formula with NP estimated from step average watts", label: "Inference" },
  { rule: "run_gap: the same formula per run step with IF = grade-adjusted speed (Minetti 2002) / threshold speed", label: "Inference" },
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
    avgPower: z.number().int().min(0).max(2500).optional().describe("Average power of the step, W."),
    avgHr: z.number().int().min(30).max(250).optional().describe("Average heart rate, bpm."),
    maxHr: z.number().int().min(30).max(250).optional().describe("Highest heart rate, bpm."),
    avgCadence: z.number().int().min(0).max(250).optional().describe("Average cadence, rpm."),
    avgSpeed: z.number().min(0).max(40).optional().describe("Average speed, m/s."),
    climbM: z.number().int().min(0).max(20000).optional().describe("Climbing, metres."),
    rpe: z.number().int().min(1).max(10).optional(),
    notes: z.string().max(280).optional(),
  })
  .strict();

/** The route registers these tools only with the switch on; the ride tools check it again, as the app's actions do. */
const ENDURANCE_OFF = "Endurance features are not on for this account";

export function registerEnduranceAppTools(server: McpServer, userId: string) {
  server.registerTool(
    "get_training_load",
    {
      description: [
        "Training load, fitness, fatigue and form, on one scale (100 = one hour at threshold).",
        "source 'garmin' when the user has Garmin data (that series also holds the app sessions Garmin did not record), else 'app' from sessions logged in the app. The two are never added.",
        "App methods: run_pace (needs a threshold pace), run_gap (a run from the app's run mode with distance on 90% of its time and a threshold pace: an estimate, per step hours x IF^2 x 100 with IF = grade-adjusted speed / threshold speed, a treadmill's first 1% incline counted as flat; never on Trail or snow), swim_css (needs CSS), bike_power (a ride with step average watts on 90% of its time and an FTP: an estimate, hours x IF^2 x 100 with the step averages' fourth-power mean as NP), srpe (minutes x RPE x 0.22), strength_srpe. A session with no RPE and no usable threshold has no load: it is listed in noLoad, never guessed.",
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
        "Per-step results of a structured session, by plannedSessionId or workoutSessionId (a ride with no planned session reads by workoutSessionId): each step's key, planned time and distance and target (resolved with the thresholds of that day), the result (status, active time, distance, measured value, avg power, avg and max heart rate, cadence, speed in m/s, climbing in m, RPE, notes), sources (who wrote each result field: typed by the athlete, clock of ride mode, garmin, or assistant; null for steps logged without), its band (green, yellow, orange, red) and whether the value was in the target. Also the session RPE, time, distance, its load with the method, and the planned load estimate. Null results when none were logged. For a bike ride, get_ride gives the ride's own numbers.",
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
            sources: r.sources,
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
    "get_ride",
    {
      description: [
        "A bike ride from ride mode, by workoutSessionId, or the latest ride of a program exercise by programExerciseId.",
        "Gives the mode (indoor or outdoor), the status (running, paused, finished, ended_early; an ended-early ride does not count as a done key session), the plan as frozen at the start (FTP, steps, planned time, load, IF, kJ, minutes per power zone), and per step the plan (end, target, watts, ramp, outdoor target, cadence, note) against what was done (status, time, +1 min extensions, the rider's ±5 W offset, avg power, avg and max heart rate, cadence, speed m/s, distance, climbing, RPE) with sources, who wrote each value (clock, typed, garmin, assistant). underTarget is true when the avg power (outdoors the avg heart rate) was under the plan's low end.",
        "numbers: avg power over the steps with power; kJ only when power covers 90% of the ridden time; an estimated power load (method bike_power, NP estimated from the step averages) when power covers 90% and an FTP is set, else the effort load (method srpe, minutes x RPE x 0.22), else none; minutes per power zone by step average (needs an FTP). With a Garmin activity that filled the ride (stream true): avg power, NP (30 s rolling mean), intensityFactor (NP / the plan's FTP), the load (hours x IF^2 x 100, not an estimate), kJ and power zone minutes come from the 1 s stream; also heartRateZoneMinutes (Friel, bike LTHR), drift (heart rate drift in %, rides of 60 min or more, warm-up and cool-down left out; under 5 is steady) and per step timeOnTargetPct (power indoors, heart rate outdoors). Without one they are null. garmin: the fill state (filled, pick when two or more Garmin rides match and the rider picks one in the app, refill when the rider undid the fill of the one match and can fill it again in the app, none), whether a fill was undone, and how the activity was split into steps (laps or time). Load models are inference; say so.",
        "ftpTest (an FTP test ride, else null): the test (ramp or 20min), the power it reads (ramp: the best 1 min, 20min: the all-out step's average) and its basis (garmin stream, typed step average, or target: the planned watts of the highest done ramp step with no number), proposedFtp (ramp 75%, 20min 95% of that power; null when the test gives none), currentFtp, saved (the current FTP is the proposed one), measuredOn (the ride's date), and the protocol and testData to add it with manage_thresholds (source test) when the rider asks you to.",
        "Read only. No tool changes a running ride: it keeps its plan, and a program edit applies from the next ride. Null when there is no ride.",
      ].join(" "),
      inputSchema: { workoutSessionId: z.number().int().positive().optional(), programExerciseId: z.number().int().positive().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ workoutSessionId, programExerciseId }) => {
      if ((workoutSessionId == null) === (programExerciseId == null)) return fail("Send workoutSessionId or programExerciseId");
      try {
        if (!(await enduranceEnabledFor(userId))) return fail(ENDURANCE_OFF);
        // Loaded on use: the ride readers reach the app's session code, which this module must not load at registration.
        const { rideReport } = await import("@/lib/ride-report");
        return ok({ ride: await rideReport(userId, { workoutSessionId, programExerciseId }) });
      } catch (e) {
        return failInternal("get_ride", e);
      }
    },
  );

  server.registerTool(
    "log_step_results",
    {
      description: [
        "Log the per-step results of a structured session, for example from what the athlete tells you.",
        "plannedSessionId (a session whose program has steps), or workoutSessionId of a logged session (a ride with no planned session), and steps: each key is the step id, plus #n for round n of a repeat (s3#2). Steps are numbered s1, s2 … in the order of the program's step tree (a repeat takes one number, its steps the next ones); with more than one structured exercise each key starts with the exercise's place (e2:s1). get_step_results and get_ride list the keys. Each step takes status, activeSeconds, distanceMeters, value, and for a ride avgPower, avgHr, maxHr, avgCadence, avgSpeed (m/s) and climbM, plus rpe and notes. Optional sessionRpe (1-10; without it and without a threshold the session has no load), notes. Give each step its own distanceMeters.",
        "Each step is logged as one set of the session. When the session is not logged yet (plannedSessionId only), this writes it as a completed session linked to the planned one. When it is, the results attach to it: only the steps you name change, and each field you send is written with source 'assistant'. A value the athlete typed or Garmin filled is never replaced: the result lists it under kept, so tell the user. RPE and notes are only filled where empty, and a step already logged as done stays done. sessionRpe goes on each done step without its own RPE. Step results are logged data: they make no revision. A ride that is still running or paused is refused: wait until it has ended. For a session with a ride, the keys are the ride's own (get_ride lists them) and its steps keep the plan frozen at its start; for another session by workoutSessionId, a program changed since the session was logged is refused.",
        "Requires reason.",
      ].join(" "),
      inputSchema: {
        plannedSessionId: z.number().int().positive().optional(),
        workoutSessionId: z.number().int().positive().optional(),
        steps: z.array(stepArg).min(1).max(400),
        sessionRpe: z.number().int().min(1).max(10).optional(),
        notes: z.string().max(500).optional(),
        reason: reasonArg,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      if ((args.plannedSessionId == null) === (args.workoutSessionId == null)) return fail("Send plannedSessionId or workoutSessionId");
      try {
        if (!(await enduranceEnabledFor(userId))) return fail(ENDURANCE_OFF);
        const r =
          args.workoutSessionId != null
            ? await saveSessionStepResults(userId, args.workoutSessionId, { steps: args.steps, sessionRpe: args.sessionRpe })
            : await saveStepResults(userId, { plannedSessionId: args.plannedSessionId!, steps: args.steps, sessionRpe: args.sessionRpe, notes: args.notes }, "assistant");
        audit("log_step_results", { ...(args.plannedSessionId != null && { plannedSessionId: args.plannedSessionId }), workoutSessionId: r.workoutSessionId });
        return ok({
          workoutSessionId: r.workoutSessionId,
          written: r.created === "session" ? "new session" : "attached to the logged session",
          // Each kept field with who wrote it: typed (the athlete), garmin, or logged (effort, notes, a done step).
          kept: r.kept ?? [],
        });
      } catch (e) {
        if (e instanceof StepResultsError || e instanceof PlanStateError || e instanceof DuplicateSession) return fail(e.message);
        return failInternal("log_step_results", e);
      }
    },
  );
}
