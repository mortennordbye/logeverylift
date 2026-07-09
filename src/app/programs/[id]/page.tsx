import { ProgramDetailClient } from "@/components/features/ProgramDetailClient";
import { getFriends } from "@/lib/actions/friends";
import { getProgramWithExercises } from "@/lib/actions/programs";
import { getLastCompletedSession } from "@/lib/actions/workout-sessions";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ editing?: string }>;
};

export default async function ProgramDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { editing } = await searchParams;
  const programId = Number(id);
  if (isNaN(programId)) notFound();

  await requireSession();
  const [programResult, lastSessionResult, friendsResult] = await Promise.all([
    getProgramWithExercises(programId),
    getLastCompletedSession(programId),
    getFriends(),
  ]);
  if (!programResult.success) notFound();

  const program = programResult.data;
  const exercises = program.programExercises.map((pe) => ({
    id: pe.id,
    name: pe.exercise.name,
    isTimed: pe.exercise.isTimed,
    isRunning: pe.exercise.name === "Running" || pe.exercise.discipline != null,
    discipline: pe.exercise.discipline,
    sets: pe.programSets,
  }));

  return (
    <ProgramDetailClient
      programId={programId}
      programName={program.name}
      exercises={exercises}
      initialEditing={editing === "true"}
      lastSession={lastSessionResult.success ? lastSessionResult.data : null}
      friends={friendsResult.success ? friendsResult.data : []}
    />
  );
}
