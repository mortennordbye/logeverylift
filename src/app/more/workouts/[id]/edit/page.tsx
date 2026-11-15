import { WorkoutEditor } from "@/components/features/workout-editor/WorkoutEditor";
import { editorNumbers } from "@/components/features/workout-editor/load";
import { enduranceEnabledFor } from "@/lib/endurance";
import { requireSession } from "@/lib/utils/session";
import { getLibraryWorkout } from "@/lib/workouts";
import { notFound, redirect } from "next/navigation";

/** Edit a library workout (docs/plans/bike-sessions.md, 5.3): sessions that follow it change on Save. */
export default async function EditLibraryWorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/more");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [w, numbers] = await Promise.all([getLibraryWorkout(user.id, id), editorNumbers(user.id)]);
  if (!w || w.sport !== "bike") notFound();
  return <WorkoutEditor initial={w.workout} numbers={numbers} context={{ kind: "library", workoutId: id }} title="Edit workout" back={{ href: "/more/workouts", label: "Workouts" }} />;
}
