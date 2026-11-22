/**
 * Active Workout Session Page
 *
 * Shows the workout in progress for a selected program.
 * Users can check off exercises and see their progress.
 */

import { enduranceEnabledFor } from "@/lib/endurance";
import { WorkoutSessionClient } from "@/components/features/WorkoutSessionClient";
import { getProgramWithExercises } from "@/lib/actions/programs";
import {
  getProgramPeriodization,
  syncActiveCyclePeriodization,
} from "@/lib/actions/training-cycles";
import { getLastCompletedSession } from "@/lib/actions/workout-sessions";
import { getWorkoutInsight } from "@/lib/actions/workout-sets";
import { formatPeriodizationSummary } from "@/lib/utils/periodization";
import { programStepsView } from "@/lib/program-steps-view";
import { requireSession } from "@/lib/utils/session";
import { notFound, redirect } from "next/navigation";
import { WorkoutSessionStart } from "./session-start";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function WorkoutSessionPage({ params }: Props) {
  const { id } = await params;
  const programId = Number(id);
  if (isNaN(programId)) notFound();

  const { user } = await requireSession();
  // Before the reads below, not beside them: they show this week's targets, and
  // the sync is what writes them (PZ-29).
  await syncActiveCyclePeriodization();

  const [result, lastSessionResult, insight, periodizationResult] = await Promise.all([
    getProgramWithExercises(programId),
    getLastCompletedSession(programId),
    getWorkoutInsight(programId),
    getProgramPeriodization(programId),
  ]);

  if (!result.success) {
    // The Workout tab persists a pointer to this program; if the program was
    // deleted out from under it, don't dead-end on a 404 — send the user home and
    // signal the client to clear the stale active-workout pointer. A transient DB
    // error (a different message) still 404s, leaving the active workout intact.
    if (result.error === "Program not found") {
      redirect("/?staleWorkout=1");
    }
    notFound();
  }

  const program = result.data;

  const periodization = periodizationResult.success ? periodizationResult.data : null;
  // Precompute plain strings in the server body (Turbopack SWC chokes on complex
  // inline JSX expressions — see cycles/[id]/page.tsx).
  const periodizationSummary = periodization
    ? formatPeriodizationSummary(periodization)
    : null;

  // Structured endurance steps (docs/plans/one-program-model.md, 3): a summary
  // per exercise, the session's totals, and the guided player when today's
  // planned session runs this program.
  const [steps, endurance] = await Promise.all([programStepsView(user.id, programId), enduranceEnabledFor(user.id)]);

  const exercises = program.programExercises.map((pe) => ({
    id: pe.id,
    name: pe.exercise.name,
    exerciseId: pe.exercise.id,
    isTimed: pe.exercise.isTimed,
    isRunning: pe.exercise.name === "Running" || pe.exercise.discipline != null,
    discipline: pe.exercise.discipline,
    sets: pe.programSets,
    stepSummary: steps?.summaries.get(pe.id) ?? null,
    // A ride or a run (docs/plans/bike-ride-logger.md, docs/plans/run-logger.md): the ring opens the exercise screen.
    opensExercise: endurance && (pe.exercise.discipline === "bike" || pe.exercise.discipline === "run") && pe.programSets.some((s) => s.stepKind != null),
  }));

  return (
    <>
      <WorkoutSessionStart programId={programId} />
      <WorkoutSessionClient
        programId={programId}
        programName={program.name}
        exercises={exercises}
        lastSession={lastSessionResult.success ? lastSessionResult.data : null}
        insight={insight}
        periodization={periodizationSummary}
        guided={steps?.guided ?? null}
      />
    </>
  );
}
