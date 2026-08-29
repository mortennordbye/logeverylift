/**
 * Workout Exercise Sets Page
 */

import { WorkoutSetsClient } from "@/components/features/WorkoutSetsClient";
import { getProgramWithExercises } from "@/lib/actions/programs";
import { getProgressiveSuggestions } from "@/lib/actions/workout-sets";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string; programExerciseId: string }>;
};

export default async function WorkoutExerciseSetsPage({ params }: Props) {
  const { id, programExerciseId } = await params;
  const programId = Number(id);
  const peId = Number(programExerciseId);
  if (isNaN(programId) || isNaN(peId)) notFound();

  await requireSession();
  const [result, suggestionsResult] = await Promise.all([
    getProgramWithExercises(programId),
    getProgressiveSuggestions(programId),
  ]);
  if (!result.success) notFound();

  const program = result.data;
  const pe = program.programExercises.find((e) => e.id === peId);
  if (!pe) notFound();

  const suggestions = suggestionsResult.success ? suggestionsResult.data : {};

  return (
    <WorkoutSetsClient
      programId={programId}
      programExerciseId={peId}
      exerciseName={pe.exercise.name}
      exerciseId={pe.exercise.id}
      sets={pe.programSets}
      isWorkout={true}
      exerciseCategory={pe.exercise.category ?? undefined}
      exerciseIsTimed={pe.exercise.isTimed}
      exerciseDiscipline={pe.exercise.discipline}
      suggestions={suggestions}
      overloadIncrementKg={pe.overloadIncrementKg != null ? Number(pe.overloadIncrementKg) : null}
      overloadIncrementReps={Number(pe.overloadIncrementReps ?? 0)}
      progressionAdvance={pe.progressionAdvance}
      progressionRequiredHits={pe.progressionRequiredHits}
      progressionScope={pe.progressionScope}
      progressionRegress={pe.progressionRegress}
      progressionBackoffPct={pe.progressionBackoffPct}
      progressionBackoffAfter={pe.progressionBackoffAfter}
      progressionReadiness={pe.progressionReadiness}
      progressionApplyToPlan={pe.progressionApplyToPlan}
      exerciseTypeDefault={pe.exercise.exerciseType}
      exerciseTypeOverride={pe.exerciseType}
    />
  );
}
