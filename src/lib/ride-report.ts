/**
 * A ride as the assistant reads it (docs/plans/bike-ride-logger.md, step 5,
 * MCP get_ride): the frozen plan, the mode, the status, each step planned
 * against done with the source of each number, and the numbers of 4.6: from
 * the Garmin activity that filled the ride when there is one (NP, IF, zones,
 * drift, time on target), else from the step averages.
 *
 * Read only: the status comes from the ride's timeline and is not stored
 * here, so a read never changes a ride (D9).
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { rideEvents, rides, workoutSessions } from "@/db/schema";
import { rideStepLogs } from "@/lib/bike-exercise-view";
import { rideGarminView } from "@/lib/ride-garmin";
import { getUserSettings } from "@/lib/user-settings";
import { bikeStepRows, plannedRideNumbers } from "@/lib/utils/bike-ride-view";
import { rideSummary } from "@/lib/utils/ride-results";
import type { RidePlan } from "@/lib/utils/ride-timeline";
import { and, asc, desc, eq } from "drizzle-orm";

const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const zones = (minutes: number[]) => minutes.map((m, i) => ({ zone: i + 1, minutes: m })).filter((z) => z.minutes > 0);

/** The user's ride of a workout session, or the latest ride of a program exercise; null when there is none. */
export async function rideReport(userId: string, by: { workoutSessionId?: number; programExerciseId?: number }) {
  const [ride] = await db
    .select()
    .from(rides)
    .where(
      and(
        eq(rides.userId, userId),
        by.workoutSessionId != null ? eq(rides.sessionId, by.workoutSessionId) : eq(rides.programExerciseId, by.programExerciseId ?? -1),
      ),
    )
    .orderBy(desc(rides.startedAt), desc(rides.id))
    .limit(1);
  if (!ride) return null;

  const [events, [session], { units }, garmin] = await Promise.all([
    db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id)).orderBy(asc(rideEvents.seq)),
    db
      .select({ plannedSessionId: workoutSessions.plannedSessionId, date: workoutSessions.date, isCompleted: workoutSessions.isCompleted })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, ride.sessionId), eq(workoutSessions.userId, userId))),
    getUserSettings(userId),
    rideGarminView(userId, ride.id),
  ]);
  const plan = ride.plan as RidePlan;
  const { logs, timeline } = await rideStepLogs(userId, {
    plan,
    events: events.map((e) => ({ seq: e.seq, kind: e.kind, value: e.value, at: e.at.getTime() })),
    serverNow: Date.now(),
    ride: { sessionId: ride.sessionId, heartbeatAt: ride.heartbeatAt?.getTime() ?? null },
  });
  const summary = rideSummary(plan, logs, units, garmin.stream);
  const stream = garmin.stream;
  const planned = plannedRideNumbers(plan);
  const rows = bikeStepRows(plan, units);
  const n = summary.numbers;
  const live = timeline.status === "running" || timeline.status === "paused";

  return {
    rideId: ride.id,
    workoutSessionId: ride.sessionId,
    plannedSessionId: session?.plannedSessionId ?? null,
    programExerciseId: ride.programExerciseId,
    date: session?.date ?? null,
    mode: plan.mode,
    status: timeline.status,
    autoEnded: timeline.autoEnded,
    startedAt: ride.startedAt.toISOString(),
    endedAt: iso(timeline.endedAt),
    note: live
      ? "This ride is running. It keeps the plan it started with: program edits apply from the next ride."
      : "The plan is the copy frozen when the ride started; later program or FTP changes do not touch it.",
    plan: {
      name: plan.name,
      ftp: plan.thresholds.ftp ?? null,
      lthrBike: plan.thresholds.lthr_bike ?? null,
      steps: plan.steps.length,
      seconds: planned.seconds,
      openSteps: planned.open,
      load: { value: Math.round(planned.load.load), partial: planned.load.partial },
      intensityFactor: r2(planned.intensityFactor),
      kj: planned.kj,
      zoneMinutes: zones(planned.zoneMinutes),
    },
    steps: plan.steps.map((s, i) => {
      const log = logs[s.programSetId] ?? null;
      return {
        key: s.key,
        n: i + 1,
        title: rows[i].title,
        type: s.step.type,
        planned: {
          seconds: s.seconds,
          end: s.step.end,
          target: s.target?.text ?? null,
          watts: s.power,
          ...(s.step.ramp && { ramp: s.step.ramp }),
          ...(s.step.free && { free: true }),
          outdoor: s.outdoor?.text ?? null,
          cadence: s.step.cadence ?? null,
          note: s.step.note ?? null,
        },
        done: log && {
          status: log.status,
          seconds: log.durationSeconds,
          extendedSeconds: log.extendedSeconds,
          targetOffsetW: log.targetOffsetW,
          avgPower: log.avgPower,
          avgHr: log.avgHr,
          maxHr: log.maxHr,
          avgCadence: log.avgCadence,
          avgSpeed: log.avgSpeed,
          distanceMeters: log.distanceMeters,
          climbM: log.climbM,
          rpe: log.rpe,
          sources: log.sources,
        },
        underTarget: summary.rows[i].under,
        // Percent of the step's seconds inside its target (power indoors, heart rate outdoors), from the stream.
        timeOnTargetPct: summary.rows[i].onTarget,
      };
    }),
    numbers: {
      seconds: n.seconds,
      avgPower: n.avgPower === null ? null : Math.round(n.avgPower),
      powerCoverage: r2(n.powerCoverage),
      // NP, IF, heart rate zones, drift and time on target come from Garmin's 1 s stream only (4.6).
      stream: stream !== null,
      np: n.np === null ? null : Math.round(n.np),
      intensityFactor: r2(n.intensityFactor),
      npEstimate: n.npEstimate === null ? null : Math.round(n.npEstimate),
      kj: n.kj,
      load: n.load && {
        value: r1(n.load.value),
        // "power": from the Garmin stream; "bike_power": estimated from the step averages.
        method: n.load.method === "power" ? (n.load.estimated ? "bike_power" : "power") : "srpe",
        estimated: n.load.estimated,
      },
      effort: summary.effort,
      powerZoneMinutes: zones(n.zoneMinutes),
      heartRateZoneMinutes: stream ? zones(stream.numbers.hrZoneMinutes) : null,
      drift: stream?.numbers.drift ? { pct: stream.numbers.drift.pct, steady: stream.numbers.drift.steady } : null,
      timeOnTarget: stream
        ? plan.steps.flatMap((s, i) => (summary.rows[i].onTarget === null ? [] : [{ key: s.key, pct: summary.rows[i].onTarget }]))
        : null,
    },
    garmin: {
      // "filled": the steps hold Garmin numbers (Undo in the app); "pick": two or more Garmin rides match and the rider picks one in the app.
      state: garmin.state,
      garminActivityId: garmin.garminActivityId,
      declined: garmin.declined,
      split: stream?.split ?? null,
      matches: garmin.candidates.map((c) => ({ garminActivityId: c.garminActivityId, startedAt: iso(c.startMs), seconds: c.seconds })),
    },
  };
}

export type RideReport = NonNullable<Awaited<ReturnType<typeof rideReport>>>;

