/**
 * The brick of a run (docs/plans/run-logger.md, 4.3 and 4.7): the ride a run
 * follows comes from today's planned brick pair (`brickParentId`), never from
 * "the last ride today". The run keeps it as `rides.brick_ride_id`; the ride's
 * done screen hands over to the run, and the run screen shows T2.
 *
 * Plain server code: callers resolve the user.
 */

import { db } from "@/db";
import { exercises, plannedSessions, programExercises, rides, workoutSessions } from "@/db/schema";
import { livePlannedSessions, liveProgramExercises } from "@/lib/plan-live";
import { settle } from "@/lib/ride-settle";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { localDateStr } from "@/lib/utils/user-date";
import { toDateStr } from "@/lib/utils/cycle-position";
import { rideTimeline, type RideTimeline } from "@/lib/utils/ride-timeline";
import { and, asc, desc, eq, gt, inArray, isNotNull, or } from "drizzle-orm";

/** A ride counts for today's brick when it started this recently (as RIDE_RECENT_MS). */
const BRICK_RECENT_MS = 12 * 60 * 60 * 1000;
/** T2 shows only when the run starts this soon after the ride's end (4.7). */
export const T2_MAX_MS = 60 * 60 * 1000;

/** The user's latest bike ride of today (in the user's time zone) on this planned session, or on a workout of its program. */
async function rideOfPlanned(userId: string, planned: { id: number; programId: number | null }) {
  const [{ timeZone }, rows] = await Promise.all([
    getUserSettings(userId),
    db
      .select({ ride: rides })
    .from(rides)
    .innerJoin(workoutSessions, eq(workoutSessions.id, rides.sessionId))
    .where(
      and(
        eq(rides.userId, userId),
        eq(rides.sport, "bike"),
        gt(rides.startedAt, new Date(Date.now() - BRICK_RECENT_MS)),
        or(eq(workoutSessions.plannedSessionId, planned.id), planned.programId !== null ? eq(workoutSessions.programId, planned.programId) : undefined),
      ),
    )
      .orderBy(desc(rides.startedAt), desc(rides.id))
      .limit(5),
  ]);
  // Today's only: a ride of the same program last night is not this brick's (4.7).
  const today = localDateStr(new Date(), timeZone);
  return rows.find((r) => localDateStr(r.ride.startedAt, timeZone) === today)?.ride ?? null;
}

/** Today's planned run of this program that follows a ride, with that ride's planned session. */
async function plannedPairOfRun(userId: string, runProgramId: number) {
  const today = toDateStr(await userToday(userId));
  const [run] = await db
    .select({ parentId: plannedSessions.brickParentId })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.userId, userId), eq(plannedSessions.programId, runProgramId), eq(plannedSessions.date, today), isNotNull(plannedSessions.brickParentId), livePlannedSessions))
    .orderBy(asc(plannedSessions.position))
    .limit(1);
  if (!run?.parentId) return null;
  const [parent] = await db
    .select({ id: plannedSessions.id, programId: plannedSessions.programId })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.id, run.parentId), eq(plannedSessions.userId, userId), livePlannedSessions));
  return parent ?? null;
}

/** The ride of today's brick whose run is this program's, or null when the run is in no brick or its ride has not started. */
export async function brickRideOf(userId: string, runProgramId: number) {
  const parent = await plannedPairOfRun(userId, runProgramId);
  return parent ? rideOfPlanned(userId, parent) : null;
}

export type BrickRide = {
  rideId: number;
  /** The ride still runs: the run screen offers "End ride and start run". */
  live: boolean;
  /** When the ride ended (epoch ms), for T2; null while it runs, or when T2 does not show (an auto end, or over 60 min ago). */
  t2From: number | null;
};

/** The ride of the run's brick as the run screen shows it (4.3, section 5 "Brick"). */
export async function brickRideView(userId: string, runProgramId: number): Promise<BrickRide | null> {
  const ride = await brickRideOf(userId, runProgramId);
  if (!ride) return null;
  // Settled: a ride whose last step ran out reads as ended.
  const v = await settle(db, ride, Date.now());
  const live = v.ride.status === "running" || v.ride.status === "paused";
  const t = rideTimeline(v.plan, v.events, v.serverNow, { heartbeatAt: v.ride.heartbeatAt });
  const endedAt = v.ride.endedAt;
  const t2From = !live && endedAt !== null && !t.autoEnded && v.serverNow - endedAt <= T2_MAX_MS ? endedAt : null;
  return { rideId: v.ride.id, live, t2From };
}

/**
 * The run that follows this ride in today's brick: where its run exercise
 * opens, and whether a run of it has started since the ride. Null when the
 * ride's session is in no brick.
 */
export async function brickRunOf(userId: string, rideId: number): Promise<{ href: string; started: boolean } | null> {
  const [session] = await db
    .select({ plannedSessionId: workoutSessions.plannedSessionId, programId: workoutSessions.programId, startedAt: rides.startedAt })
    .from(rides)
    .innerJoin(workoutSessions, eq(workoutSessions.id, rides.sessionId))
    .where(and(eq(rides.id, rideId), eq(rides.userId, userId), eq(rides.sport, "bike")));
  if (!session) return null;
  const today = toDateStr(await userToday(userId));
  // The ride's planned session: the one its workout opened from, else today's of its program.
  const parents = await db
    .select({ id: plannedSessions.id })
    .from(plannedSessions)
    .where(
      and(
        eq(plannedSessions.userId, userId),
        livePlannedSessions,
        session.plannedSessionId !== null
          ? eq(plannedSessions.id, session.plannedSessionId)
          : session.programId !== null
            ? and(eq(plannedSessions.programId, session.programId), eq(plannedSessions.date, today))
            : eq(plannedSessions.id, -1),
      ),
    );
  if (!parents.length) return null;
  const [child] = await db
    .select({ programId: plannedSessions.programId })
    .from(plannedSessions)
    .where(and(eq(plannedSessions.userId, userId), inArray(plannedSessions.brickParentId, parents.map((p) => p.id)), livePlannedSessions))
    .orderBy(asc(plannedSessions.position))
    .limit(1);
  if (child?.programId == null) return null;
  const [pe] = await db
    .select({ id: programExercises.id })
    .from(programExercises)
    .innerJoin(exercises, eq(exercises.id, programExercises.exerciseId))
    .where(and(eq(programExercises.programId, child.programId), eq(exercises.discipline, "run"), liveProgramExercises))
    .orderBy(asc(programExercises.orderIndex))
    .limit(1);
  if (!pe) return null;
  const [run] = await db
    .select({ id: rides.id })
    .from(rides)
    .where(and(eq(rides.userId, userId), eq(rides.sport, "run"), eq(rides.programExerciseId, pe.id), gt(rides.startedAt, session.startedAt)))
    .limit(1);
  return { href: `/programs/${child.programId}/workout/exercises/${pe.id}`, started: !!run };
}

/**
 * The ride of a run's brick as the run summary shows it (section 5 "Summary",
 * 4.7): the ride's run time, and T2 from its end to the run's start when it
 * shows (60 min or less, and the ride did not auto end).
 */
export async function brickSummaryOf(userId: string, brickRideId: number, runStartedAt: number): Promise<{ rideSeconds: number; t2Seconds: number | null } | null> {
  const [ride] = await db.select().from(rides).where(and(eq(rides.id, brickRideId), eq(rides.userId, userId), eq(rides.sport, "bike")));
  if (!ride) return null;
  const v = await settle(db, ride, Date.now());
  const t = rideTimeline(v.plan, v.events, v.serverNow, { heartbeatAt: v.ride.heartbeatAt });
  return brickTimes(t, v.ride.endedAt, runStartedAt);
}

/** The brick ride's run time and T2 (4.7) from its timeline and end. */
export function brickTimes(t: Pick<RideTimeline, "steps" | "autoEnded">, rideEndedAt: number | null, runStartedAt: number): { rideSeconds: number; t2Seconds: number | null } {
  const rideSeconds = t.steps.reduce((a, s) => a + s.activeSeconds, 0);
  const gap = rideEndedAt !== null ? runStartedAt - rideEndedAt : null;
  return { rideSeconds, t2Seconds: gap !== null && gap >= 0 && gap <= T2_MAX_MS && !t.autoEnded ? Math.round(gap / 1000) : null };
}
