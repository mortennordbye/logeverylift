import { ProgramAddExerciseWrapper } from "@/components/features/ProgramAddExerciseWrapper";
import { getAllExercises } from "@/lib/actions/exercises";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProgramAddExercisePage({ params }: Props) {
  const { id } = await params;
  const programId = Number(id);
  if (isNaN(programId)) notFound();

  const result = await getAllExercises();
  const exercises = result.success ? result.data : [];

  return <ProgramAddExerciseWrapper programId={programId} exercises={exercises} />;
}
