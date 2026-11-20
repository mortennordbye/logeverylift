/**
 * A run as the assistant reads it (docs/plans/run-logger.md, step 5, MCP
 * get_ride): the frozen plan, the mode and surface, the status and end
 * reason, each step planned against done with the source of each number, and
 * the numbers of 4.9 that need no Garmin stream: distance and moving pace
 * from the belt or the steps, GAP on a treadmill, the load per step, and time
 * in heart rate zones by step average. With a Garmin fill (step 7) the stream
 * numbers come from the 1 s stream: outdoor GAP, IF and load, drift, time on
 * target and zones; without one they are null and `stream` is false.
 *
 * Read only: the status comes from the run's timeline and is not stored here,
 * so a read never changes a run (D9).
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { rideEvents, rides, workoutSessions } from "@/db/schema";
import { rideStepLogs } from "@/lib/bike-exercise-view";
import { brickTimes } from "@/lib/run-brick";
import { garminAllowedFor } from "@/lib/garmin/access";
import { runGarminView } from "@/lib/run-garmin";
import { runThresholdTest } from "@/lib/run-test";
import { getUserSettings } from "@/lib/user-settings";
import { runTestCheckText, runTestThresholds } from "@/lib/utils/run-test";
import { minSec } from "@/lib/utils/thresholds";
import { rideTimeline, type RidePlan } from "@/lib/utils/ride-timeline";
import { paceText } from "@/lib/utils/run-numbers";
import { runSummary, type RunStepLog } from "@/lib/utils/run-results";
import { RUN_MODE_NAME, plannedRunNumbers, runOutdoorText, runRowOfStep, runStepTitle, runTargetText } from "@/lib/utils/run-view";
import { and, asc, eq } from "drizzle-orm";

const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const kmh = (ms: number) => Math.round(ms * 36) / 10;
const tenths = (n: number | null) => (n === null ? null : n / 10);

const readEvents = (rideId: number) => db.select().from(rideEvents).where(eq(rideEvents.rideId, rideId)).orderBy(asc(rideEvents.seq));
const eventInputs = (events: Awaited<ReturnType<typeof readEvents>>) => events.map((e) => ({ seq: e.seq, kind: e.kind, value: e.value, at: e.at.getTime(), stepKey: e.stepKey }));

/** The run's brick ride: its time and T2, read without settling it. */
async function brickOf(userId: string, brickRideId: number, runStartedAt: number) {
  const [ride] = await db.select().from(rides).where(and(eq(rides.id, brickRideId), eq(rides.userId, userId), eq(rides.sport, "bike")));
  if (!ride) return null;
  const t = rideTimeline(ride.plan as RidePlan, eventInputs(await readEvents(ride.id)), Date.now(), { heartbeatAt: ride.heartbeatAt?.getTime() ?? null });
  return { rideId: ride.id, ...brickTimes(t, t.endedAt, runStartedAt) };
}

/** The run's time on target in percent: each step's share weighted by its seconds in the stream. */
function timeOnTargetOf(plan: RidePlan, onTarget: Record<number, number | null> | null, numbers: { seconds: number } | null): number | null {
  if (!onTarget || !numbers) return null;
  let inside = 0;
  let secs = 0;
  for (const s of plan.steps) {
    const pct = onTarget[s.programSetId];
    if (pct === null || pct === undefined) continue;
    const w = s.seconds ?? s.estSeconds;
    inside += (pct / 100) * w;
    secs += w;
  }
  return secs > 0 ? Math.round((inside / secs) * 100) : null;
}

/** The report of one run (a `rides` row of sport run) of the user. */
export async function runReport(userId: string, ride: typeof rides.$inferSelect) {
  const [events, [session]] = await Promise.all([
    readEvents(ride.id),
    db
      .select({ plannedSessionId: workoutSessions.plannedSessionId, date: workoutSessions.date })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, ride.sessionId), eq(workoutSessions.userId, userId))),
  ]);
  const plan = ride.plan as RidePlan;
  const th = plan.thresholds;
  const treadmill = plan.mode === "indoor";
  const surface = plan.surface ?? "road";
  const { logs, timeline } = await rideStepLogs(userId, {
    plan,
    events: eventInputs(events),
    serverNow: Date.now(),
    ride: { sessionId: ride.sessionId, heartbeatAt: ride.heartbeatAt?.getTime() ?? null },
  });
  const runLogs = logs as Record<number, RunStepLog>;
  const beltEvents = events.some((e) => e.kind === "belt" || e.kind === "incline");
  const [garmin, garminUser] = await Promise.all([runGarminView(userId, ride.id), garminAllowedFor(userId)]);
  const stream = garmin.stream;
  const summary = runSummary(plan, runLogs, { beltEvents, stream });
  const n = summary.numbers;
  const planned = plannedRunNumbers(plan);
  const live = timeline.status === "running" || timeline.status === "paused";
  const brickApp = ride.brickRideId !== null ? await brickOf(userId, ride.brickRideId, ride.startedAt.getTime()) : null;
  const test = live
    ? null
    : await runThresholdTest(userId, { plan, startedAt: ride.startedAt, timeZone: (await getUserSettings(userId)).timeZone }, runLogs, timeline, eventInputs(events));
  // Garmin's transition gives T2 when the run is the part of a multisport file after it (4.8).
  const brick = brickApp && garmin.t2Seconds !== null ? { ...brickApp, t2Seconds: garmin.t2Seconds } : brickApp;
  // The summary's row of each step (a strides block is one row) and its arrow.
  const rowOf = runRowOfStep(plan);
  const mark = { "↑": "above", "↓": "below" } as const;

  return {
    rideId: ride.id,
    sport: "run" as const,
    workoutSessionId: ride.sessionId,
    plannedSessionId: session?.plannedSessionId ?? null,
    programExerciseId: ride.programExerciseId,
    date: session?.date ?? null,
    // "indoor" is the treadmill (R3).
    mode: plan.mode,
    modeName: RUN_MODE_NAME[plan.mode],
    surface: treadmill ? null : surface,
    status: timeline.status,
    autoEnded: timeline.autoEnded,
    endReason: ride.endReason,
    startedAt: ride.startedAt.toISOString(),
    endedAt: iso(timeline.endedAt),
    note: live
      ? "This run is running. It keeps the plan it started with: program edits apply from the next run."
      : "The plan is the copy frozen when the run started; later program or threshold changes do not touch it.",
    brick: brick && { rideId: brick.rideId, rideSeconds: brick.rideSeconds, t2Seconds: brick.t2Seconds },
    plan: {
      name: plan.name,
      test: plan.test ?? null,
      // Threshold pace as speed (m/s) and as words, and the run LTHR.
      thresholdSpeed: r2(th.run_threshold_pace ?? null),
      thresholdPace: th.run_threshold_pace ? paceText(1000 / th.run_threshold_pace) : null,
      lthrRun: th.lthr_run ?? null,
      steps: plan.steps.length,
      seconds: planned.seconds,
      openSteps: planned.open,
      km: planned.km,
      load: { value: Math.round(planned.load.load), partial: planned.load.partial },
      zoneMinutes: planned.zoneMinutes.map((m, i) => ({ zone: i + 1, minutes: m })).filter((z) => z.minutes > 0),
    },
    steps: plan.steps.map((s, i) => {
      const log = runLogs[s.programSetId] ?? null;
      const outdoor = treadmill ? null : runOutdoorText(s, th, surface);
      const row = summary.rows[rowOf[i]];
      return {
        key: s.key,
        n: i + 1,
        title: runStepTitle(s, th),
        type: s.step.type,
        // A strides block (a repeat whose work step is under 60 s, 4.5): the summary shows it as one row.
        block: s.run?.block ?? null,
        planned: {
          seconds: s.seconds,
          end: s.step.end,
          // time, belt_distance (a treadmill distance), estimate (an outdoor distance run on the time its pace gives) or lap.
          rule: s.run?.rule ?? "time",
          meters: s.run?.meters ?? null,
          target: runTargetText(s, th),
          // The treadmill belt in km/h and where it came from (step, pace, history, zone, effort); null by feel. Incline null: the one before carries on.
          ...(treadmill && { beltKmh: tenths(s.run?.belt ?? null), beltFrom: s.run?.beltFrom ?? null, inclinePercent: tenths(s.run?.incline ?? null) }),
          ...(outdoor && { outdoor: outdoor.main, outdoorSecond: outdoor.second }),
          note: s.step.note ?? null,
        },
        done: log && {
          status: log.status,
          seconds: log.durationSeconds,
          extendedSeconds: log.extendedSeconds,
          distanceMeters: log.distanceMeters,
          avgSpeed: r2(log.avgSpeed),
          ...(treadmill && { beltKmh: log.avgSpeed !== null ? kmh(log.avgSpeed) : null, inclinePercent: log.inclinePercent ?? null }),
          paceSPerKm: log.distanceMeters && log.durationSeconds ? Math.round(log.durationSeconds / (log.distanceMeters / 1000)) : null,
          avgHr: log.avgHr,
          maxHr: log.maxHr,
          avgCadence: log.avgCadence,
          climbM: log.climbM,
          rpe: log.rpe,
          sources: log.sources,
        },
        // The summary's judgement (4.2): above a cap or a range, below a range; null when it passes or is not judged.
        judged: s.run?.block ? null : row?.key === s.key && row.mark ? mark[row.mark] : null,
        // Percent of the step's seconds inside its target, from the Garmin stream; null without one or without a target.
        timeOnTargetPct: stream?.numbers.onTarget[s.programSetId] ?? null,
      };
    }),
    numbers: {
      seconds: n.seconds,
      // Totals count skipped steps too: a skipped step was still run (4.7).
      distanceMeters: n.meters,
      distanceSource: summary.distanceLine,
      paceSPerKm: n.paceSPerKm === null ? null : Math.round(n.paceSPerKm),
      pace: n.paceSPerKm === null ? null : paceText(n.paceSPerKm),
      // Grade-adjusted pace: on a treadmill from the belt and incline; outdoors from the Garmin stream's distance and altitude.
      gapSPerKm: (treadmill || stream?.numbers.gapSPerKm != null) && n.gapSPerKm !== null ? Math.round(n.gapSPerKm) : null,
      avgHr: n.avgHr === null ? null : Math.round(n.avgHr),
      intensityFactor: r2(n.intensityFactor),
      load: n.load && {
        value: r1(n.load.value),
        // run_gap: per step hours x IF^2 x 100 with IF = GAP speed / threshold speed; srpe: minutes x RPE x 0.22. Both are estimates.
        method: n.load.method === "pace" ? "run_gap" : "srpe",
        estimated: true,
      },
      effort: summary.effort,
      // From the Garmin 1 s stream when the run is filled, else by step average; empty without a run LTHR.
      heartRateZoneMinutes: summary.zones.map((z) => ({ zone: z.zone, minutes: z.m })),
      zonesFrom: stream ? ("stream" as const) : ("steps" as const),
      // From Garmin's 1 s stream only: false and null until the run is filled from Garmin.
      stream: !!stream,
      // Friel Pa:HR over the steady steps (45 min or more), the first 10 min and strides left out; under 5% is steady.
      drift: stream?.numbers.drift ? { pct: stream.numbers.drift.pct, steady: stream.numbers.drift.steady } : null,
      // The share of the steps' seconds inside their targets, over the steps with a target.
      timeOnTarget: timeOnTargetOf(plan, stream?.numbers.onTarget ?? null, stream?.numbers ?? null),
    },
    // The run threshold test (4.10): LTHR from the 20 min step's average heart rate, threshold pace from the whole 30 min (Friel).
    thresholdTest: plan.test === "30min"
      ? {
          test: plan.test,
          proposedLthr: test?.result?.lthr ?? null,
          proposedThresholdSpeed: test?.result?.speed != null ? r2(test.result.speed) : null,
          proposedThresholdPace: test?.result?.speed != null ? `${minSec(1000 / test.result.speed)} /km` : null,
          currentLthr: test?.current.lthr ?? null,
          currentThresholdPace: test?.current.speed ? `${minSec(1000 / test.current.speed)} /km` : null,
          // save: within 5 bpm and 3% of the current values; choose: 6 to 10 bpm or 3 to 8%; retest: further off ("Run the test again in 4 weeks").
          band: test?.result?.band ?? null,
          // A failed check: "Test may be invalid".
          valid: test?.result?.valid ?? null,
          failedChecks: test?.result ? runTestCheckText(test.result.checks) : [],
          saved: test?.saved ?? false,
          measuredOn: test?.measuredOn ?? null,
          note: live
            ? "The test is still running."
            : test?.result
              ? test.saved
                ? "This test's values are stored as test thresholds."
                : "The runner saves it with Save on the run summary, or you add each row with manage_thresholds (source test, protocol run_30min and the row's testData)."
              : "The 20 min step was not run to its end, paused more than 60 s, or gave no heart rate or pace in range, so the test gives no threshold.",
          protocol: "run_30min" as const,
          rows: test?.result ? runTestThresholds(test.result).map((r) => ({ kind: r.kind, value: r.value, testData: r.testData })) : [],
        }
      : null,
    // Null for a user without Garmin access.
    garmin: !garminUser ? null : {
      // filled: Undo; pick: two or more Garmin runs match and none fills; refill: the one match was undone; none.
      state: garmin.state,
      garminActivityId: garmin.garminActivityId,
      declined: garmin.declined,
      split: stream?.split ?? null,
      matches: garmin.candidates.map((c) => ({ garminActivityId: c.garminActivityId, segment: c.segment ?? 0, startedAt: iso(c.startMs), seconds: c.seconds, meters: c.meters ?? null })),
    },
  };
}

export type RunReport = Awaited<ReturnType<typeof runReport>>;
