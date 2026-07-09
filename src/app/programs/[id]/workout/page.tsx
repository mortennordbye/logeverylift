/**
 * Active Workout Session Page
 *
 * Shows the workout in progress for a selected program.
 * Users can check off exercises and see their progress.
 */

import { WorkoutSessionClient } from "@/components/features/WorkoutSessionClient";
import { getProgramWithExercises } from "@/lib/actions/programs";
import { getProgramPeriodization } from "@/lib/actions/training-cycles";
import { getLastCompletedSession } from "@/lib/actions/workout-sessions";
import { getWorkoutInsight } from "@/lib/actions/workout-sets";
import { formatPeriodizationSummary } from "@/lib/utils/periodization";
import { requireSession } from "@/lib/utils/session";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function WorkoutSessionPage({ params }: Props) {
  const { id } = await params;
  const programId = Number(id);
  if (isNaN(programId)) notFound();

  await requireSession();

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

  const exercises = program.programExercises.map((pe) => ({
    id: pe.id,
    name: pe.exercise.name,
    exerciseId: pe.exercise.id,
    isTimed: pe.exercise.isTimed,
    isRunning: pe.exercise.name === "Running" || pe.exercise.discipline != null,
    discipline: pe.exercise.discipline,
    sets: pe.programSets,
  }));

  return (
    <WorkoutSessionClient
      programId={programId}
      programName={program.name}
      exercises={exercises}
      lastSession={lastSessionResult.success ? lastSessionResult.data : null}
      insight={insight}
      periodization={periodizationSummary}
    />
  );
}
