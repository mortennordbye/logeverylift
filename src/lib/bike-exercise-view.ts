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
import { getRide, type RideView } from "@/lib/actions/rides";
import { thresholdValues } from "@/lib/session-compliance";
import { getUserSettings, userToday } from "@/lib/user-settings";
import { bikeStepRows, defaultRideMode, plannedRideNumbers, rideChart, type BikeStepRow, type RideChart, type RideNumbers } from "@/lib/utils/bike-ride-view";
import { toDateStr } from "@/lib/utils/cycle-position";
import { buildWorkout, type StepRow } from "@/lib/utils/program-steps";
import { buildRidePlan } from "@/lib/utils/ride-timeline";
import { parseWorkout } from "@/lib/utils/workout-steps";
import { and, desc, eq, gt, sql } from "drizzle-orm";

export type BikeModeView = { numbers: RideNumbers; chart: RideChart; rows: BikeStepRow[] };

export type BikeExerciseData = {
  defaultMode: RideMode;
  indoor: BikeModeView;
  outdoor: BikeModeView;
  ftp: number | null;
  lthr: number | null;
  /** The user's ride of this exercise is running or paused: the screen offers Resume, not Start ride. */
  liveRide: boolean;
  /** The last ride of this exercise ended in the last 12 hours: the screen says "Ride done". */
  doneRide: { endedEarly: boolean; sessionOpen: boolean } | null;
};

/** A ride counts as this workout's for this long after its start (step 3 choice, section 9). */
export const RIDE_RECENT_MS = 12 * 60 * 60 * 1000;

/** The user's latest ride of this program exercise started in the last 12 hours, with whether its workout is still open. */
async function recentRide(userId: string, programExerciseId: number) {
  const [row] = await db
    .select({ id: rides.id, status: rides.status, sessionOpen: sql<boolean>`not ${workoutSessions.isCompleted}` })
    .from(rides)
    .innerJoin(workoutSessions, eq(workoutSessions.id, rides.sessionId))
    .where(and(eq(rides.userId, userId), eq(rides.programExerciseId, programExerciseId), gt(rides.startedAt, new Date(Date.now() - RIDE_RECENT_MS))))
    .orderBy(desc(rides.startedAt))
    .limit(1);
  return row ?? null;
}

/**
 * The ride ride mode shows for this exercise: the user's live ride of it, or
 * one that has ended while its workout is still open (the app was closed when
 * it ended), so ride mode saves its last steps and finishes the workout.
 * Null when there is none: the page shows the bike screen.
 */
export async function rideOfExercise(userId: string, programExerciseId: number): Promise<{ view: RideView; sessionCompleted: boolean } | null> {
  const active = await getRide({});
  let view = active.success && active.data?.ride.programExerciseId === programExerciseId ? active.data : null;
  if (!view) {
    const recent = await recentRide(userId, programExerciseId);
    if (!recent?.sessionOpen) return null;
    const r = await getRide({ rideId: recent.id });
    view = r.success ? r.data : null;
  }
  if (!view) return null;
  const [session] = await db
    .select({ isCompleted: workoutSessions.isCompleted })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.id, view.ride.sessionId), eq(workoutSessions.userId, userId)));
  return { view, sessionCompleted: session?.isCompleted ?? false };
}

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

  // getRide settles the active ride first, so one whose last step ran out is not live.
  const [thresholds, { units }, today, lastMode, active] = await Promise.all([
    thresholdValues(userId),
    getUserSettings(userId),
    userToday(userId),
    lastRideMode(userId, programExerciseId),
    getRide({}),
  ]);
  const view = (mode: RideMode): BikeModeView => {
    const plan = buildRidePlan(tree.workout, rows.map((r) => r.id), thresholds, mode);
    return { numbers: plannedRideNumbers(plan), chart: rideChart(plan), rows: bikeStepRows(plan, units) };
  };
  const liveRide = active.success && active.data?.ride.programExerciseId === programExerciseId;
  // After getRide settled the active ride, so a ride that ran out reads as ended.
  const recent = liveRide ? null : await recentRide(userId, programExerciseId);
  return {
    // Planned sessions hold no ride mode yet (no column, no writer): D6 starts at the last ride.
    defaultMode: defaultRideMode({ plannedMode: null, lastMode, month: Number(toDateStr(today).slice(5, 7)) }),
    indoor: view("indoor"),
    outdoor: view("outdoor"),
    ftp: thresholds.ftp ?? null,
    lthr: thresholds.lthr_bike ?? null,
    liveRide,
    doneRide:
      recent && (recent.status === "finished" || recent.status === "ended_early")
        ? { endedEarly: recent.status === "ended_early", sessionOpen: recent.sessionOpen }
        : null,
  };
}
