/**
 * The data of the bike exercise screen (docs/plans/bike-ride-logger.md,
 * section 5): the ride as `startRide` would freeze it now, in both modes, and
 * the mode it opens in (D6). Null when the exercise holds no steps to ride,
 * so the page keeps today's set list.
 *
 * Not a Server Action: it takes a resolved userId from a Server Component.
 */

import { db } from "@/db";
import { rides, workoutSessions, type RideMode } from "@/db/schema";
import { thresholdValues } from "@/lib/session-compliance";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { bikeStepRows, defaultRideMode, plannedRideNumbers, rideChart, type BikeStepRow, type RideChart, type RideNumbers } from "@/lib/utils/bike-ride-view";
import { toDateStr } from "@/lib/utils/cycle-position";
import { buildWorkout, type StepRow } from "@/lib/utils/program-steps";
import { buildRidePlan } from "@/lib/utils/ride-timeline";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { and, desc, eq, sql } from "drizzle-orm";

export type BikeModeView = { numbers: RideNumbers; chart: RideChart; rows: BikeStepRow[] };

export type BikeExerciseData = {
  defaultMode: RideMode;
  indoor: BikeModeView;
  outdoor: BikeModeView;
  ftp: number | null;
  lthr: number | null;
};

/** The mode of the user's last ride of this program exercise: Garmin's correction on the session first, else the ride's own. */
async function lastRideMode(userId: string, programExerciseId: number): Promise<RideMode | null> {
  const [row] = await db
    .select({ mode: sql<RideMode>`coalesce(${workoutSessions.rideMode}, ${rides.mode})` })
    .from(rides)
    .leftJoin(workoutSessions, eq(workoutSessions.id, rides.sessionId))
    .where(and(eq(rides.userId, userId), eq(rides.programExerciseId, programExerciseId)))
    .orderBy(desc(rides.startedAt))
    .limit(1);
  return row?.mode ?? null;
}

export async function bikeExerciseView(
  userId: string,
  programExerciseId: number,
  name: string,
  sets: (StepRow & { id: number })[],
): Promise<BikeExerciseData | null> {
  // The order startRide reads the rows in, so each step keeps its program set.
  const rows = sets.filter((s) => s.stepKind != null).sort((a, b) => a.setNumber - b.setNumber || a.id - b.id);
  if (!rows.length) return null;
  const built = buildWorkout(rows, { sport: "bike", name });
  const tree = "workout" in built ? parseWorkout(built.workout) : null;
  if (!tree?.ok) return null;

  const [thresholds, { units }, today, lastMode] = await Promise.all([thresholdValues(userId), getUserSettings(userId), userToday(userId), lastRideMode(userId, programExerciseId)]);
  const view = (mode: RideMode): BikeModeView => {
    const plan = buildRidePlan(tree.workout, rows.map((r) => r.id), thresholds, mode);
    return { numbers: plannedRideNumbers(plan), chart: rideChart(plan), rows: bikeStepRows(plan, units) };
  };
  return {
    // Planned sessions hold no ride mode yet (no column, no writer): D6 starts at the last ride.
    defaultMode: defaultRideMode({ plannedMode: null, lastMode, month: Number(toDateStr(today).slice(5, 7)) }),
    indoor: view("indoor"),
    outdoor: view("outdoor"),
    ftp: thresholds.ftp ?? null,
    lthr: thresholds.lthr_bike ?? null,
  };
}
