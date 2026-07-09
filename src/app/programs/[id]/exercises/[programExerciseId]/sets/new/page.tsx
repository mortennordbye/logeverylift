/**
 * New Set Page
 *
 * Full-page view for adding a new set with picker-based input.
 */

import { NewSetView } from "@/components/features/NewSetView";
import { getProgramWithExercises } from "@/lib/actions/programs";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{
    id: string;
    programExerciseId: string;
  }>;
};

export default async function NewSetPage({ params }: Props) {
  const { id, programExerciseId } = await params;
  const programId = Number(id);
  const peId = Number(programExerciseId);

  if (isNaN(programId) || isNaN(peId)) notFound();

  const result = await getProgramWithExercises(programId);
  if (!result.success) notFound();

  const program = result.data;
  const pe = program.programExercises.find((e) => e.id === peId);
  if (!pe) notFound();

  const nextSetNumber = pe.programSets.length + 1;
  const lastSet = pe.programSets[pe.programSets.length - 1];

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-4">
        <Link
          href={`/programs/${programId}/exercises/${peId}?edit=true`}
          className="flex items-center gap-1 text-primary"
        >
          <ChevronLeftIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Back</span>
        </Link>
        <div className="text-xl font-bold">Add Set</div>
        <div className="w-16" /> {/* Spacer for centering */}
      </div>

      {/* Set indicator */}
      <div className="px-4 pb-6 text-center">
        <div className="inline-flex items-center gap-2">
          <span className="text-sm text-muted-foreground">SET</span>
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <span className="text-sm font-bold text-primary-foreground">
              {nextSetNumber}
            </span>
          </div>
        </div>
      </div>

      {/* Add view */}
      <NewSetView
        programId={programId}
        programExerciseId={peId}
        nextSetNumber={nextSetNumber}
        lastSet={lastSet}
        isTimed={pe.exercise.isTimed}
        isRunning={pe.exercise.name === "Running" || pe.exercise.discipline != null}
        discipline={pe.exercise.discipline}
      />
    </div>
  );
}
