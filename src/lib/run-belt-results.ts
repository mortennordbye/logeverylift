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
import { beltResults } from "@/lib/utils/run-screen";
import { and, eq, sql } from "drizzle-orm";

type Executor = Pick<typeof db, "update" | "select">;

/** Write the belt fields of every ended step of a treadmill run again, where they are still the belt's. */
export async function rewriteBeltResults(ex: Executor, userId: string, view: Pick<RideView, "plan" | "events" | "serverNow" | "ride">) {
  if (planSport(view.plan) !== "run" || view.plan.mode !== "indoor") return;
  const t = rideTimeline(view.plan, view.events, view.serverNow, { heartbeatAt: view.ride.heartbeatAt });
  const [session] = await ex
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.id, view.ride.sessionId), eq(workoutSessions.userId, userId)));
  if (!session) return;
  for (const r of t.steps) {
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
