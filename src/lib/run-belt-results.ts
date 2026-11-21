/**
 * A treadmill run step's distance, speed and incline from the belt
 * (docs/plans/run-logger.md, 4.7). The phone saves them when the step ends;
 * a belt or incline event that reaches the server later (an offline replay)
 * moves them, so the server writes them again from the timeline. Only fields
 * still marked `belt`: a typed or Garmin value stays.
 *
 * Plain server code: callers resolve the user.
 */

import { db } from "@/db";
import { rideEvents, rides, workoutSessions, workoutSets } from "@/db/schema";
import type { RideView } from "@/lib/ride-settle";
import { sessionRide } from "@/lib/ride-plan-db";
import { planSport, rideTimeline, type RidePlan } from "@/lib/utils/ride-timeline";
import { beltResults, beltStepsChanged } from "@/lib/utils/run-screen";
import { and, asc, eq, sql } from "drizzle-orm";

type Executor = Pick<typeof db, "update" | "select">;

type View = Pick<RideView, "plan" | "events" | "serverNow" | "ride">;

/**
 * A treadmill run step's belt fields as the server's timeline has them now,
 * for a step save from the phone: the phone works them out from its own
 * timeline, which can place an offline tap elsewhere than the server stored
 * it, and its save can land after the replay that rewrote them. Null when the
 * step has not ended on the server yet: the phone's numbers stay.
 *
 * Locks the ride as `sendRideEvent` does, inside the caller's transaction:
 * a belt event either lands before this read or rewrites the row after it.
 */
export async function serverBeltResults(ex: Executor, userId: string, sessionId: number, programExerciseId: number, programSetId: number) {
  const latest = await sessionRide(ex, userId, sessionId, programExerciseId);
  if (!latest) return null;
  const [ride] = await ex.select().from(rides).where(eq(rides.id, latest.id)).for("update");
  const plan = ride.plan as RidePlan;
  if (planSport(plan) !== "run" || plan.mode !== "indoor") return null;
  const events = await ex.select().from(rideEvents).where(eq(rideEvents.rideId, ride.id)).orderBy(asc(rideEvents.seq));
  const t = rideTimeline(
    plan,
    events.map((e) => ({ seq: e.seq, kind: e.kind, value: e.value, at: e.at.getTime(), stepKey: e.stepKey })),
    Date.now(),
    { heartbeatAt: ride.heartbeatAt?.getTime() ?? null },
  );
  const r = t.steps.find((x) => x.programSetId === programSetId);
  return r ? beltResults(r) : null;
}

/**
 * Write the belt fields of a treadmill run's ended steps again, where they
 * are still the belt's: only the steps the new event changed, from the ride
 * as it was before it (`before`) to after it.
 */
export async function rewriteBeltResults(ex: Executor, userId: string, view: View, before: View) {
  if (planSport(view.plan) !== "run" || view.plan.mode !== "indoor") return;
  const timeline = (v: View) => rideTimeline(v.plan, v.events, view.serverNow, { heartbeatAt: v.ride.heartbeatAt });
  const changed = beltStepsChanged(timeline(before), timeline(view));
  if (!changed.length) return;
  const [session] = await ex
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.id, view.ride.sessionId), eq(workoutSessions.userId, userId)));
  if (!session) return;
  for (const r of changed) {
    const b = beltResults(r);
    if (b.distanceMeters === undefined) continue;
    const row = and(eq(workoutSets.sessionId, session.id), eq(workoutSets.programSetId, r.programSetId));
    await ex
      .update(workoutSets)
      .set({ distanceMeters: b.distanceMeters, inclinePercent: b.inclinePercent ?? null })
      .where(and(row, sql`${workoutSets.sources}->>'distanceMeters' = 'belt'`));
    await ex
      .update(workoutSets)
      .set({ avgSpeed: b.avgSpeed ?? null })
      .where(and(row, sql`${workoutSets.sources}->>'avgSpeed' = 'belt'`));
  }
}
