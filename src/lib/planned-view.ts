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
import { getBikeNumbers } from "@/lib/bike-numbers";
import { getUserSettings } from "@/lib/user-settings";
import { formatEnduranceDistance } from "@/lib/utils/format";
import { plannedRows, workoutPlannedLoad, type PlannedRow } from "@/lib/utils/step-results";
import type { Units } from "@/lib/utils/units";
import { flattenWorkout, workoutHash } from "@/lib/utils/workout-player";
import {
  cadenceText,
  estimateWorkout,
  hrZoneLabel,
  pctFtpText,
  resolveTarget,
  resolveWorkout,
  type ThresholdValues,
  type Workout,
  type WorkoutEstimate,
  type WorkoutStep,
  type ZoneSet,
} from "@/lib/utils/workout-steps";

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

export function playerSession(id: number, workout: Workout, anchors: ThresholdValues, units: Units, zones: ZoneSet | null = null): PlayerSession {
  const flat = flattenWorkout(workout);
  const rows = plannedRows(workout, anchors, units);
  const steps: PlayerStepView[] = flat.map((p, i) => {
    const step = p.step as WorkoutStep;
    const row = rows[i];
    const main = step.target ? resolveTarget(step.target, workout.sport, anchors, units, zones) : null;
    const second = step.secondary ? resolveTarget(step.secondary, workout.sport, anchors, units, zones) : null;
    return {
      key: p.key,
      type: step.type,
      round: p.round,
      seconds: p.seconds,
      text: row.text,
      targetText: main?.text ?? null,
      targetLow: main?.low ?? null,
      targetHigh: main?.high ?? null,
      targetUnit: main?.unit ?? null,
      pctFtpText: pctFtpText(main?.forms ?? null),
      secondaryText: second?.text ?? null,
      secondaryZoneText: hrZoneLabel(second?.forms ?? null),
      cadenceText: step.cadence ? cadenceText(step.cadence) : null,
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
  const [anchors, { units }, results, zones] = await Promise.all([
    thresholdValues(userId),
    getUserSettings(userId),
    getStepResults(userId, { plannedSessionId: id }),
    workout.sport === "bike" ? getBikeNumbers(userId).then((b) => b.zones) : null,
  ]);
  return {
    session,
    workout,
    units,
    rows: plannedRows(workout, anchors, units),
    player: playerSession(id, workout, anchors, units, zones),
    estimate: estimateWorkout(workout, anchors),
    plannedLoad: workoutPlannedLoad(workout, anchors),
    missingAnchors: resolveWorkout(workout, anchors, units, zones).missingAnchors,
    results,
  };
}
