/**
 * A ride as the assistant reads it (docs/plans/bike-ride-logger.md, step 5,
 * MCP get_ride): the frozen plan, the mode, the status, each step planned
 * against done with the source of each number, and the numbers of 4.6 that
 * exist without a power stream.
 *
 * Read only: the status comes from the ride's timeline and is not stored
 * here, so a read never changes a ride (D9).
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { rideEvents, rides, workoutSessions } from "@/db/schema";
import { rideStepLogs } from "@/lib/bike-exercise-view";
import { getUserSettings } from "@/lib/user-settings";
import { bikeStepRows, plannedRideNumbers } from "@/lib/utils/bike-ride-view";
import { rideSummary } from "@/lib/utils/ride-results";
import { rideTimeline, type RidePlan } from "@/lib/utils/ride-timeline";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

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

  const [events, [session], { units }] = await Promise.all([
    db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id)).orderBy(asc(rideEvents.seq)),
    db
      .select({ plannedSessionId: workoutSessions.plannedSessionId, date: workoutSessions.date, isCompleted: workoutSessions.isCompleted })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, ride.sessionId), eq(workoutSessions.userId, userId))),
    getUserSettings(userId),
  ]);
  const plan = ride.plan as RidePlan;
  const { logs, timeline } = await rideStepLogs(userId, {
    plan,
    events: events.map((e) => ({ seq: e.seq, kind: e.kind, value: e.value, at: e.at.getTime() })),
    serverNow: Date.now(),
    ride: { sessionId: ride.sessionId, heartbeatAt: ride.heartbeatAt?.getTime() ?? null },
  });
  const summary = rideSummary(plan, logs, units);
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
      };
    }),
    numbers: {
      seconds: n.seconds,
      avgPower: n.avgPower === null ? null : Math.round(n.avgPower),
      powerCoverage: r2(n.powerCoverage),
      // From Garmin's 1 s power stream only (4.6); null until a stream is matched.
      stream: false,
      np: n.np,
      intensityFactor: n.intensityFactor,
      npEstimate: n.npEstimate === null ? null : Math.round(n.npEstimate),
      kj: n.kj,
      load: n.load && {
        value: r1(n.load.value),
        method: n.load.method === "power" ? "bike_power" : "srpe",
        estimated: n.load.estimated,
      },
      effort: summary.effort,
      powerZoneMinutes: zones(n.zoneMinutes),
      heartRateZoneMinutes: null,
      drift: null,
      timeOnTarget: null,
    },
  };
}

export type RideReport = NonNullable<Awaited<ReturnType<typeof rideReport>>>;

/**
 * The id of the user's ride that is still running or paused on this workout
 * session, or on the session logged for this planned session; null when none
 * runs (D9: no assistant write reaches a running ride).
 */
export async function liveRideOn(userId: string, by: { workoutSessionId?: number; plannedSessionId?: number }): Promise<number | null> {
  const [ride] = await db
    .select({ id: rides.id, plan: rides.plan, heartbeatAt: rides.heartbeatAt })
    .from(rides)
    .innerJoin(workoutSessions, eq(workoutSessions.id, rides.sessionId))
    .where(
      and(
        eq(rides.userId, userId),
        inArray(rides.status, ["running", "paused"]),
        by.workoutSessionId != null ? eq(rides.sessionId, by.workoutSessionId) : eq(workoutSessions.plannedSessionId, by.plannedSessionId ?? -1),
      ),
    )
    .limit(1);
  if (!ride) return null;
  // The stored status is settled on the next read of the app; the timeline says whether it still runs.
  const events = await db.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id)).orderBy(asc(rideEvents.seq));
  const t = rideTimeline(
    ride.plan as RidePlan,
    events.map((e) => ({ seq: e.seq, kind: e.kind, value: e.value, at: e.at.getTime() })),
    Date.now(),
    { heartbeatAt: ride.heartbeatAt?.getTime() ?? null },
  );
  return t.status === "running" || t.status === "paused" ? ride.id : null;
}
