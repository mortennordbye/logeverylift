/**
 * Program Exercise Detail Page
 *
 * Shows all planned sets for a specific exercise within a program,
 * and allows adding or removing sets.
 */

import { WorkoutSetsClient } from "@/components/features/WorkoutSetsClient";
import { getProgramWithExercises } from "@/lib/actions/programs";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string; programExerciseId: string }>;
  searchParams: Promise<{ edit?: string }>;
};

export default async function ProgramExerciseDetailPage({ params, searchParams }: Props) {
  const { id, programExerciseId } = await params;
  const { edit } = await searchParams;
  const programId = Number(id);
  const peId = Number(programExerciseId);
  if (isNaN(programId) || isNaN(peId)) notFound();

  const result = await getProgramWithExercises(programId);
  if (!result.success) notFound();

  const program = result.data;
  const pe = program.programExercises.find((e) => e.id === peId);
  if (!pe) notFound();

  const progressionMode = (pe.progressionMode ?? "manual") as "manual" | "weight" | "smart" | "reps" | "time" | "distance";

  return (
    <WorkoutSetsClient
      programId={programId}
      programExerciseId={peId}
      exerciseName={pe.exercise.name}
      exerciseCategory={pe.exercise.category ?? ""}
      exerciseIsTimed={pe.exercise.isTimed}
      exerciseDiscipline={pe.exercise.discipline}
      sets={pe.programSets}
      isWorkout={false}
      initialEditing={edit === "true"}
      overloadIncrementKg={pe.overloadIncrementKg != null ? Number(pe.overloadIncrementKg) : null}
      overloadIncrementReps={Number(pe.overloadIncrementReps ?? 0)}
      progressionMode={progressionMode}
      exerciseTypeDefault={pe.exercise.exerciseType}
      exerciseTypeOverride={pe.exerciseType}
    />
  );
}
