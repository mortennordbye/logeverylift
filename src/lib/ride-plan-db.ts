/**
 * A workout session's ride and its frozen plan, for the writers of its steps
 * (docs/plans/bike-ride-logger.md, D9 and 4.3): a step saves with the plan
 * the ride started with, never the program as edited since, and no write of
 * results reaches a ride that still runs.
 *
 * Plain server code: callers resolve the user.
 */

import { db } from "@/db";
import { programSets, rideEvents, rides, workoutSessions } from "@/db/schema";
import type { PlannedStepSnapshot } from "@/lib/utils/program-steps";
import { rideTimeline, type RidePlan } from "@/lib/utils/ride-timeline";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

type Executor = Pick<typeof db, "select">;

/** The user's latest ride on this workout session, or null. */
export async function sessionRide(ex: Executor, userId: string, sessionId: number) {
  const [ride] = await ex
    .select()
    .from(rides)
    .where(and(eq(rides.userId, userId), eq(rides.sessionId, sessionId)))
    .orderBy(desc(rides.startedAt), desc(rides.id))
    .limit(1);
  return ride ?? null;
}

/** The step of a frozen plan that logs to this program set: a ridden step or a dropped one. */
export function planStepOf(plan: RidePlan, programSetId: number) {
  return plan.steps.find((s) => s.programSetId === programSetId) ?? plan.dropped?.find((s) => s.programSetId === programSetId) ?? null;
}

/**
 * The plan copy a step of this session's ride saves with: the step and the
 * threshold values frozen at the start. Null when the session has no ride or
 * its plan does not hold this program set.
 */
export async function rideStepSnapshot(ex: Executor, userId: string, sessionId: number, programSetId: number): Promise<PlannedStepSnapshot | null> {
  const ride = await sessionRide(ex, userId, sessionId);
  const s = ride ? planStepOf(ride.plan as RidePlan, programSetId) : null;
  if (!ride || !s) return null;
  // plan-read: includes deleted (the block of a set the program may have dropped since)
  const [row] = s.round ? await ex.select({ blockId: programSets.blockId }).from(programSets).where(eq(programSets.id, programSetId)) : [];
  return { v: 2, sport: "bike", step: s.step, blockId: row?.blockId ?? null, blockRound: s.round?.index ?? null, thresholds: (ride.plan as RidePlan).thresholds };
}

/**
 * The id of the user's ride on this session when it still runs or is paused
 * by its timeline (a stored status settles on the app's next read), else null.
 */
export async function liveRideOnSession(ex: Executor, userId: string, sessionId: number): Promise<number | null> {
  const ride = await sessionRide(ex, userId, sessionId);
  if (!ride || (ride.status !== "running" && ride.status !== "paused")) return null;
  const events = await ex.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id)).orderBy(asc(rideEvents.seq));
  const t = rideTimeline(
    ride.plan as RidePlan,
    events.map((e) => ({ seq: e.seq, kind: e.kind, value: e.value, at: e.at.getTime() })),
    Date.now(),
    { heartbeatAt: ride.heartbeatAt?.getTime() ?? null },
  );
  return t.status === "running" || t.status === "paused" ? ride.id : null;
}

/** The same for any open workout of this program: a ride started from the program page has no planned session. */
export async function liveRideOnProgram(ex: Executor, userId: string, programId: number): Promise<number | null> {
  const open = await ex
    .select({ id: workoutSessions.id })
    .from(rides)
    .innerJoin(workoutSessions, eq(workoutSessions.id, rides.sessionId))
    .where(and(eq(rides.userId, userId), inArray(rides.status, ["running", "paused"]), eq(workoutSessions.programId, programId), eq(workoutSessions.isCompleted, false)));
  for (const s of open) {
    const live = await liveRideOnSession(ex, userId, s.id);
    if (live) return live;
  }
  return null;
}

/** The refusal for a results write while the session's ride runs (D9). */
export const rideRunningText = (rideId: number) =>
  `Ride ${rideId} is still running. Its steps save from the phone as they end; log results after the ride has ended.`;
