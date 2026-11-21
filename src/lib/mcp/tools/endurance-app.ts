/**
 * MCP tools: training load, per-step results (docs/plans/endurance-app.md,
 * section 7), rides (docs/plans/bike-ride-logger.md, step 5) and runs
 * (docs/plans/run-logger.md, step 5). Registered
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
import { beltKmhSchema, inclinePercentSchema } from "@/lib/utils/workout-steps";
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
    beltKmh: beltKmhSchema
      .optional()
      .describe("A treadmill run's step only: the belt speed in km/h (one decimal). It is the step's speed, and its distance over the step's time when you send no distanceMeters. Not with avgSpeed."),
    inclinePercent: inclinePercentSchema.optional().describe("A treadmill run's step only: the incline in %, -3 to 30 (one decimal)."),
    rpe: z.number().int().min(1).max(10).optional(),
    notes: z.string().max(280).optional(),
  })
  .strict()
  .refine((s) => s.beltKmh === undefined || s.avgSpeed === undefined, { message: "send beltKmh or avgSpeed, not both", path: ["beltKmh"] });

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
        [
        "Per-step results of a structured session, by plannedSessionId or workoutSessionId (a ride or run with no planned session reads by workoutSessionId): each step's key, planned time and distance and target (resolved with the thresholds of that day), the result (status, active time, distance, measured value, avg power, avg and max heart rate, cadence, speed in m/s, climbing in m, RPE, notes), sources (who wrote each result field: typed by the athlete, clock of ride or run mode, belt (a treadmill's belt in run mode), garmin, or assistant; null for steps logged without), its band (green, yellow, orange, red) and whether the value was in the target. Also the session RPE, time, distance, its load with the method, and the planned load estimate. Null results when none were logged.",
        "A treadmill run from run mode also gives per step the belt frozen at its start (planned.belt: kmh, null when set by feel, and inclinePercent, null when the incline before carries on) and the result's beltKmh (its speed in km/h) and inclinePercent.",
        "A session with a ride and a run (a brick in one program) keys each step with its exercise's place (e1:s1, e2:s1), the keys log_step_results takes. For a ride or a run from ride or run mode, get_ride gives its own numbers.",
      ].join(" "),
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
            planned: {
              text: r.text,
              seconds: r.plannedSeconds,
              meters: r.plannedMeters,
              target: r.target ? { low: r.target.low, high: r.target.high, unit: r.target.unit, text: r.target.text } : null,
              ...(r.plannedBelt && { belt: r.plannedBelt }),
            },
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
        "A bike ride from ride mode or a run from run mode (sport says which): the latest of a workout session by workoutSessionId, the latest of a program exercise by programExerciseId, or both for that exercise in that session (a session can hold a ride and a run; workoutSessionId alone gives the later of the two).",
        "A ride gives the mode (indoor or outdoor), the status (running, paused, finished, ended_early; an ended-early ride does not count as a done key session), the plan as frozen at the start (FTP, steps, planned time, load, IF, kJ, minutes per power zone), and per step the plan (end, target, watts, ramp, outdoor target, cadence, note) against what was done (status, time, +1 min extensions, the rider's ±5 W offset, avg power, avg and max heart rate, cadence, speed m/s, distance, climbing, RPE) with sources, who wrote each value (clock, typed, garmin, assistant). underTarget is true when the avg power (outdoors the avg heart rate) was under the plan's low end.",
        "numbers: avg power over the steps with power; kJ only when power covers 90% of the ridden time; an estimated power load (method bike_power, NP estimated from the step averages) when power covers 90% and an FTP is set, else the effort load (method srpe, minutes x RPE x 0.22), else none; minutes per power zone by step average (needs an FTP). With a Garmin activity that filled the ride (stream true): avg power, NP (30 s rolling mean), intensityFactor (NP / the plan's FTP), the load (hours x IF^2 x 100, not an estimate), kJ and power zone minutes come from the 1 s stream; also heartRateZoneMinutes (Friel, bike LTHR), drift (heart rate drift in %, rides of 60 min or more, warm-up and cool-down left out; under 5 is steady) and per step timeOnTargetPct (power indoors, heart rate outdoors). Without one they are null. garmin: the fill state (filled, pick when two or more Garmin rides match and the rider picks one in the app, refill when the rider undid the fill of the one match and can fill it again in the app, none), whether a fill was undone, and how the activity was split into steps (laps or time). Load models are inference; say so.",
        "ftpTest (an FTP test ride, else null): the test (ramp or 20min), the power it reads (ramp: the best 1 min, 20min: the all-out step's average) and its basis (garmin stream, typed step average, or target: the planned watts of the highest done ramp step with no number), proposedFtp (ramp 75%, 20min 95% of that power; null when the test gives none), currentFtp, saved (the current FTP is the proposed one), measuredOn (the ride's date), and the protocol and testData to add it with manage_thresholds (source test) when the rider asks you to.",
        "A run (sport run) gives mode (indoor is the treadmill; modeName says Treadmill or Outdoor), surface (road, or trail for trail or snow; outdoors only), the status, endReason (tired, pain, time or other, when the runner gave one), brick (the linked ride's time and T2 in seconds, T2 only when 60 min or less), and the plan as frozen at the start (threshold pace, run LTHR, planned time, km, an estimated load and minutes per zone). Per step the plan (end; rule: time, belt_distance for a treadmill distance, estimate for an outdoor distance run on the time its pace gives, or lap; target; on a treadmill beltKmh with beltFrom, carry (true on the 20 min of a run test, which keeps the belt the step before ended on, so its beltKmh is null and it is not by feel) and inclinePercent, null incline carrying the one before; outdoors the outdoor target) against what was done (status, time, distance, avgSpeed m/s, on a treadmill beltKmh and inclinePercent, pace in s/km, avg and max heart rate, cadence in steps per minute, climbing, RPE) with sources (clock, belt, typed, garmin, assistant), and judged: above or below its target (a heart rate cap passes under its number, a heart rate on a step under 8 min is not judged, a treadmill pace target judges the belt within 0.25 km/h), else null. block marks the steps of a strides block, one row in the app.",
        "A run's numbers: time and distance (skipped steps count, they were still run) with distanceSource, moving pace, GAP on a treadmill (Minetti 2002, the first 1% incline counted as flat), avg heart rate, IF, the load (run_gap: per step hours x IF^2 x 100 with IF = GAP speed / threshold speed, when distance covers 90% of the time, a threshold pace is set and the surface is not trail; else srpe; both estimates), effort, and minutes per heart rate zone by step average (Friel, run LTHR). With a Garmin run that filled it (stream true; zonesFrom stream): the zones come from the 1 s stream, outdoors also GAP (from Garmin's distance and altitude over 30 s), IF and the run_gap load per step from the stream; drift is Friel's Pa:HR decoupling in % over the steady steps when they run 45 min or more, the first 10 min and strides left out (under 5 is steady); timeOnTarget and each step's timeOnTargetPct are the share of seconds inside the target (heart rate for a heart rate step of 8 min or more, pace outdoors). Without one they are null. garmin (null for a user without Garmin): the fill state (filled, pick when two or more Garmin runs match and the runner picks one in the app, refill after an Undo, none), whether a fill was undone, the split (laps or time) and the matching runs (with segment, the part of a multisport file, and meters). A Garmin fill writes heart rate, cadence and, where the belt gave none, distance; outdoors also distance, pace, climbing and an estimate step's lap time, and it corrects the mode (a treadmill run type is the treadmill; outdoors only with GPS). Brick T2 comes from Garmin's transition when the run is part of a multisport file.",
        "thresholdTest (a run threshold test, else null; 4.10 of the run brief): proposedLthr (the 20 min step's average heart rate, 120 to 210) and proposedThresholdPace and proposedThresholdSpeed (the average pace of the whole 30 min; null on a treadmill when the runner never tapped the belt during the test, as the pace is then the plan's), the current values, band (save: within 5 bpm and 3%; choose: 6 to 10 bpm or 3 to 8%, the app shows both; retest: further off, the app says run the test again in 4 weeks), valid and failedChecks (no stops, the last 20 min pace within 5% of the first 10, the 20 min heart rate at 80% of max HR or more, effort 8 or more), saved, measuredOn, and rows: each row's kind, value and testData to add with manage_thresholds (source test, protocol run_30min) when the runner asks you to. No result when the 20 min step was not done or paused more than 60 s.",
        "Read only. No tool changes a running ride or run: it keeps its plan, and a program edit applies from the next one. Null when there is none.",
      ].join(" "),
      inputSchema: { workoutSessionId: z.number().int().positive().optional(), programExerciseId: z.number().int().positive().optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ workoutSessionId, programExerciseId }) => {
      if (workoutSessionId == null && programExerciseId == null) return fail("Send workoutSessionId or programExerciseId");
      try {
        if (!(await enduranceEnabledFor(userId))) return fail(ENDURANCE_OFF);
        // Loaded on use: the ride readers reach the app's session code, which this module must not load at registration.
        const { rideOrRunReport } = await import("@/lib/ride-report");
        return ok({ ride: await rideOrRunReport(userId, { workoutSessionId, programExerciseId }) });
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
        "plannedSessionId (a session whose program has steps), or workoutSessionId of a logged session (a ride or run with no planned session), and steps: each key is the step id, plus #n for round n of a repeat (s3#2). Steps are numbered s1, s2 … in the order of the program's step tree (a repeat takes one number, its steps the next ones); with more than one structured exercise each key starts with the exercise's place (e2:s1). In a session with more than one ride (a ride and a run of a brick in one program), give each key its exercise's place (e1:s1 for the first exercise's s1), as get_step_results lists them; get_ride lists each one's keys without it. A key without the place is taken only when one ride alone has that step, and refused when two share it. Each step takes status, activeSeconds, distanceMeters, value, and for a ride or run avgPower (rides), avgHr, maxHr, avgCadence, avgSpeed (m/s) and climbM, plus rpe and notes. For a treadmill run from run mode (by its workoutSessionId) a step also takes beltKmh, its speed in km/h (with no distanceMeters, its distance over the step's time), and inclinePercent; any other step refuses them. Optional sessionRpe (1-10; without it and without a threshold the session has no load), notes. Give each step its own distanceMeters.",
        "Each step is logged as one set of the session. When the session is not logged yet (plannedSessionId only), this writes it as a completed session linked to the planned one. When it is, the results attach to it: only the steps you name change, and each field you send is written with source 'assistant'. A value the athlete typed, Garmin filled or a treadmill's belt gave is never replaced (a belt step's incline with it): the result lists it under kept, so tell the user; the runner corrects a belt in the app's results table. RPE and notes are only filled where empty, and a step already logged as done stays done. sessionRpe goes on each done step without its own RPE. Step results are logged data: they make no revision. A ride that is still running or paused is refused: wait until it has ended. For a session with a ride, the keys are the ride's own (get_ride lists them) and its steps keep the plan frozen at its start; for another session by workoutSessionId, a program changed since the session was logged is refused.",
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
          // Each kept field with who wrote it: typed (the athlete), garmin, belt (a treadmill's belt), or logged (effort, notes, a done step).
          kept: r.kept ?? [],
        });
      } catch (e) {
        if (e instanceof StepResultsError || e instanceof PlanStateError || e instanceof DuplicateSession) return fail(e.message);
        return failInternal("log_step_results", e);
      }
    },
  );
}
