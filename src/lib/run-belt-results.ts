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
import { workoutSessions, workoutSets } from "@/db/schema";
import type { RideView } from "@/lib/ride-settle";
import { planSport, rideTimeline } from "@/lib/utils/ride-timeline";
import { beltResults, beltStepsChanged } from "@/lib/utils/run-screen";
import { and, eq, sql } from "drizzle-orm";

type Executor = Pick<typeof db, "update" | "select">;

type View = Pick<RideView, "plan" | "events" | "serverNow" | "ride">;

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
