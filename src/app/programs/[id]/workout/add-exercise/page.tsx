import { WorkoutAddExerciseClient } from "@/components/features/WorkoutAddExerciseClient";
import { getAllExercises } from "@/lib/actions/exercises";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function WorkoutAddExercisePage({ params }: Props) {
  const { id } = await params;
  const programId = Number(id);
  if (isNaN(programId)) notFound();

  const result = await getAllExercises();
  if (!result.success) notFound();

  return (
    <WorkoutAddExerciseClient
      programId={programId}
      exercises={result.data}
    />
  );
}
