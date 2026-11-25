import { ProgramAddExerciseWrapper } from "@/components/features/ProgramAddExerciseWrapper";
import { getAllExercises } from "@/lib/actions/exercises";
import { enduranceEnabledFor } from "@/lib/endurance";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProgramAddExercisePage({ params }: Props) {
  const { id } = await params;
  const programId = Number(id);
  if (isNaN(programId)) notFound();

  const session = await requireSession();
  const [result, enduranceEnabled] = await Promise.all([getAllExercises(), enduranceEnabledFor(session.user.id)]);
  const exercises = result.success ? result.data : [];

  return <ProgramAddExerciseWrapper programId={programId} exercises={exercises} enduranceEnabled={enduranceEnabled} />;
}
