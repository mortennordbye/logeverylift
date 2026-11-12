import { getAllExercises } from "@/lib/actions/exercises";
import { ExercisesClient } from "@/components/features/ExercisesClient";
import { enduranceEnabledFor } from "@/lib/endurance";
import { requireSession } from "@/lib/utils/session";

export default async function ExercisesPage() {
  const session = await requireSession();
  const [result, enduranceEnabled] = await Promise.all([getAllExercises(), enduranceEnabledFor(session.user.id)]);
  const exerciseList = result.success ? result.data : [];

  return (
    <div className="h-[100dvh] bg-background overflow-hidden">
      <ExercisesClient exercises={exerciseList} enduranceEnabled={enduranceEnabled} />
    </div>
  );
}
