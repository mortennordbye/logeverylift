/**
 * One planned session that runs a program with steps, as the session detail, the
 * guided player, the pool view and the results screen show it
 * (docs/plans/endurance-app.md, 4.3-5.3). Targets resolve on the server with
 * the user's current thresholds and units, so client components get plain
 * text and never format numbers or dates with Intl.
 *
 * Plain server code: callers resolve the user and check the endurance switch.
 */

import type { PlayerSession, PlayerStepView } from "@/components/features/guided/types";
import { oneSession } from "@/lib/session-answers";
import { thresholdValues, type SessionCompliance } from "@/lib/session-compliance";
import { getStepResults, type StepResultsView } from "@/lib/step-results";
import { getUserSettings } from "@/lib/user-settings";
import { formatEnduranceDistance } from "@/lib/utils/format";
import { workoutPlannedLoad, type PlannedRow } from "@/lib/utils/step-results";
import { programPlay } from "@/lib/program-step-results";
import type { Units } from "@/lib/utils/units";
import { workoutHash, type PlayStep } from "@/lib/utils/workout-player";
import { estimateWorkout, resolveWorkout, type Workout, type WorkoutEstimate, type WorkoutStep } from "@/lib/utils/workout-steps";

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

function stepViews(flat: PlayStep[], rows: PlannedRow[], workout: Workout, units: Units): PlayerStepView[] {
  return flat.map((p, i) => {
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
}

/**
 * A planned session that runs a program with steps (docs/plans/one-program-model.md, 2):
 * every structured exercise in order, as one run.
 */
async function programSessionView(userId: string, session: SessionCompliance): Promise<PlannedSessionView | null> {
  const all = session.programWorkouts;
  if (!all.length) return null;
  const [anchors, { units }, results] = await Promise.all([thresholdValues(userId), getUserSettings(userId), getStepResults(userId, { plannedSessionId: session.id })]);
  const plays = programPlay(all, anchors, units);
  const first = all[0].workout;
  const estimates = all.map((p) => estimateWorkout(p.workout, anchors));
  const loads = all.map((p) => workoutPlannedLoad(p.workout, anchors));
  const name = session.label ?? session.programName ?? first.name;
  const swim = all.find((p) => p.sport === "swim");
  return {
    session,
    workout: { ...first, name, steps: all.flatMap((p) => p.workout.steps) },
    units,
    rows: plays.flatMap((p) => p.rows),
    player: {
      plannedSessionId: session.id,
      workoutHash: workoutHash(all.map((p) => p.workout)),
      name,
      sport: first.sport,
      poolLengthM: swim?.workout.poolLengthM ?? null,
      steps: plays.flatMap((p) => stepViews(p.play, p.rows, p.pw.workout, units)),
    },
    estimate: {
      durationSeconds: estimates.reduce((a, e) => a + e.durationSeconds, 0),
      distanceMeters: estimates.reduce((a, e) => a + e.distanceMeters, 0),
      durationComplete: estimates.every((e) => e.durationComplete),
      distanceComplete: estimates.every((e) => e.distanceComplete),
    },
    plannedLoad: { load: loads.reduce((a, l) => a + l.load, 0), partial: loads.some((l) => l.partial) },
    missingAnchors: [...new Set(all.flatMap((p) => resolveWorkout(p.workout, anchors, units).missingAnchors))],
    results,
  };
}

/** Null when the session is not the user's, not live, or has no structured steps. */
export async function plannedSessionView(userId: string, id: number): Promise<PlannedSessionView | null> {
  const session = await oneSession(userId, id);
  if (!session) return null;
  return programSessionView(userId, session);
}
