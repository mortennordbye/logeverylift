"use client";

import { ExercisesClient } from "@/components/features/ExercisesClient";
import { addExerciseToProgram } from "@/lib/actions/programs";
import type { Exercise } from "@/types/workout";
import { useRouter } from "next/navigation";

type Props = {
  programId: number;
  exercises: Exercise[];
};

export function ProgramAddExerciseWrapper({ programId, exercises }: Props) {
  const router = useRouter();

  async function handleSelect(exercise: Exercise) {
    await addExerciseToProgram({ programId, exerciseId: exercise.id });
    router.push(`/programs/${programId}?editing=true`);
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col overflow-hidden">
      <ExercisesClient
        exercises={exercises}
        onSelectExercise={handleSelect}
        onBack={() => router.push(`/programs/${programId}`)}
      />
    </div>
  );
}
