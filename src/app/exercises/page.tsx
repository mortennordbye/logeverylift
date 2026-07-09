import { getAllExercises } from "@/lib/actions/exercises";
import { ExercisesClient } from "@/components/features/ExercisesClient";

export const dynamic = "force-dynamic";

export default async function ExercisesPage() {
  const result = await getAllExercises();
  const exerciseList = result.success ? result.data : [];

  return (
    <div className="h-[100dvh] bg-background overflow-hidden">
      <ExercisesClient exercises={exerciseList} />
    </div>
  );
}
