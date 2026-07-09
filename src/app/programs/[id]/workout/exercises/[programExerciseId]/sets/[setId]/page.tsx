/**
 * Set Edit Page
 *
 * Full-page edit view for a single set with picker-based input.
 */

import { SetEditView } from "@/components/features/SetEditView";
import { getProgramWithExercises } from "@/lib/actions/programs";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{
    id: string;
    programExerciseId: string;
    setId: string;
  }>;
};

export default async function SetEditPage({ params }: Props) {
  const { id, programExerciseId, setId } = await params;
  const programId = Number(id);
  const peId = Number(programExerciseId);
  const setIdNum = Number(setId);

  if (isNaN(programId) || isNaN(peId) || isNaN(setIdNum)) notFound();

  const result = await getProgramWithExercises(programId);
  if (!result.success) notFound();

  const program = result.data;
  const pe = program.programExercises.find((e) => e.id === peId);
  if (!pe) notFound();

  const set = pe.programSets.find((s) => s.id === setIdNum);
  if (!set) notFound();

  const setIndex = pe.programSets.indexOf(set);
  const totalSets = pe.programSets.length;

  return (
    <div className="h-[100dvh] bg-background flex flex-col pb-nav-safe overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-4">
        <Link
          href={`/programs/${programId}/workout/exercises/${peId}`}
          className="flex items-center gap-1 text-primary"
        >
          <ChevronLeftIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Sets</span>
        </Link>
        <div className="text-lg font-bold">Edit Set</div>
        <div className="w-16" /> {/* Spacer for centering */}
      </div>

      {/* Set indicator */}
      <div className="px-4 pb-6 text-center">
        <div className="inline-flex items-center gap-2">
          <span className="text-sm text-muted-foreground">SET</span>
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <span className="text-sm font-bold text-primary-foreground">
              {setIndex + 1}
            </span>
          </div>
          <span className="text-sm text-muted-foreground">OF {totalSets}</span>
        </div>
      </div>

      {/* Edit view */}
      <SetEditView set={set} isWorkout={true} isTimed={pe.exercise.isTimed} isRunning={pe.exercise.name === "Running" || pe.exercise.discipline != null} discipline={pe.exercise.discipline} exerciseId={pe.exercise.id} setNumber={setIndex + 1} exerciseTypeDefault={pe.exercise.exerciseType} exerciseTypeOverride={pe.exerciseType} />
    </div>
  );
}
