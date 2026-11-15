/**
 * Reads for the bike session page (docs/plans/bike-sessions.md, 5.2): the
 * Auto Lap hint from the last ride's FIT laps, and what the move and skip
 * actions need.
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import { db } from "@/db";
import { garminActivities, garminActivityStreams, plannedSessions, trainingCycles } from "@/db/schema";
import { liveCycles, livePlannedSessions } from "@/lib/plan-live";
import { autoLapKm } from "@/lib/utils/bike-view";
import { cycleLengthDays } from "@/lib/utils/cycle-position";
import { addDaysStr } from "@/lib/utils/seasons";
import { and, desc, eq, ilike, or } from "drizzle-orm";

/** The Auto Lap distance of the newest ride with parsed laps; null when its laps were not made by distance. */
export async function lastRideAutoLapKm(userId: string): Promise<number | null> {
  const [ride] = await db
    .select({ laps: garminActivityStreams.laps })
    .from(garminActivities)
    .innerJoin(
      garminActivityStreams,
      and(eq(garminActivityStreams.userId, garminActivities.userId), eq(garminActivityStreams.garminActivityId, garminActivities.garminActivityId)),
    )
    .where(
      and(
        eq(garminActivities.userId, userId),
        or(ilike(garminActivities.activityType, "%cycling%"), ilike(garminActivities.activityType, "%biking%"), ilike(garminActivities.activityType, "%virtual_ride%")),
      ),
    )
    .orderBy(desc(garminActivities.startTimeLocal))
    .limit(1);
  return ride ? autoLapKm(ride.laps) : null;
}

/** The session's template day and the last day of its block, for Move and Skip. */
export async function sessionActionContext(userId: string, plannedSessionId: number): Promise<{ templateDate: string | null; lastDay: string | null; fromLibrary: boolean }> {
  const [row] = await db
    .select({ templateDate: plannedSessions.templateDate, workoutId: plannedSessions.workoutId, startDate: trainingCycles.startDate, durationWeeks: trainingCycles.durationWeeks, durationDays: trainingCycles.durationDays })
    .from(plannedSessions)
    .innerJoin(trainingCycles, and(eq(trainingCycles.id, plannedSessions.cycleId), eq(trainingCycles.userId, userId), liveCycles))
    .where(and(eq(plannedSessions.id, plannedSessionId), eq(plannedSessions.userId, userId), livePlannedSessions));
  if (!row) return { templateDate: null, lastDay: null, fromLibrary: false };
  return { templateDate: row.templateDate, lastDay: row.startDate ? addDaysStr(row.startDate, cycleLengthDays(row) - 1) : null, fromLibrary: row.workoutId != null };
}
