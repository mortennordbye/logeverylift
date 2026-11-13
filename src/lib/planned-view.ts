/**
 * One planned session with a structured workout, as the session detail, the
 * guided player, the pool view and the results screen show it
 * (docs/plans/endurance-app.md, 4.3-5.3). Targets resolve on the server with
 * the user's current thresholds and units, so client components get plain
 * text and never format numbers or dates with Intl.
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import type { PlayerSession, PlayerStepView } from "@/components/features/guided/types";
import { oneSession } from "@/lib/session-answers";
import { storedWorkout, thresholdValues, type SessionCompliance } from "@/lib/session-compliance";
import { getStepResults, type StepResultsView } from "@/lib/step-results";
import { getUserSettings } from "@/lib/user-settings";
import { formatEnduranceDistance } from "@/lib/utils/format";
import { plannedRows, workoutPlannedLoad, type PlannedRow } from "@/lib/utils/step-results";
import type { Units } from "@/lib/utils/units";
import { flattenWorkout, workoutHash } from "@/lib/utils/workout-player";
import { estimateWorkout, resolveWorkout, type ThresholdValues, type Workout, type WorkoutEstimate, type WorkoutStep } from "@/lib/utils/workout-steps";

export type PlannedSessionView = {
  session: SessionCompliance;
  workout: Workout;
  units: Units;
  rows: PlannedRow[];
  player: PlayerSession;
  estimate: WorkoutEstimate;
  plannedLoad: { load: number; partial: boolean };
  missingAnchors: string[];
  results: StepResultsView | null;
};

/** "1.5 km" or "400 m" (swim in the user's swim unit). */
export function distanceLabel(meters: number, sport: Workout["sport"], units: Units): string {
  return formatEnduranceDistance(sport === "swim" ? "m" : "km", Math.round(meters), units);
}

export function playerSession(id: number, workout: Workout, anchors: ThresholdValues, units: Units): PlayerSession {
  const flat = flattenWorkout(workout);
  const rows = plannedRows(workout, anchors, units);
  const steps: PlayerStepView[] = flat.map((p, i) => {
    const step = p.step as WorkoutStep;
    const row = rows[i];
    return {
      key: p.key,
      type: step.type,
      round: p.round,
      seconds: p.seconds,
      text: row.text,
      targetText: row.target?.text ?? null,
      targetLow: row.target?.low ?? null,
      targetHigh: row.target?.high ?? null,
      targetUnit: row.target?.unit ?? null,
      plannedMeters: row.plannedMeters,
      distanceText: step.end.type === "distance" ? distanceLabel(step.end.meters, workout.sport, units) : null,
      note: step.note ?? null,
      stroke: step.stroke ?? null,
      sendOff: step.sendOffSeconds !== undefined,
    };
  });
  return { plannedSessionId: id, workoutHash: workoutHash(workout), name: workout.name, sport: workout.sport, poolLengthM: workout.poolLengthM ?? null, steps };
}

/** Null when the session is not the user's, not live, or runs a program. */
export async function plannedSessionView(userId: string, id: number): Promise<PlannedSessionView | null> {
  const session = await oneSession(userId, id);
  if (!session?.workout) return null;
  const workout = storedWorkout(session.workout, session.id);
  if (!workout) return null;
  const [anchors, { units }, results] = await Promise.all([thresholdValues(userId), getUserSettings(userId), getStepResults(userId, { plannedSessionId: id })]);
  return {
    session,
    workout,
    units,
    rows: plannedRows(workout, anchors, units),
    player: playerSession(id, workout, anchors, units),
    estimate: estimateWorkout(workout, anchors),
    plannedLoad: workoutPlannedLoad(workout, anchors),
    missingAnchors: resolveWorkout(workout, anchors, units).missingAnchors,
    results,
  };
}
