import { ExerciseSetsSkeleton } from "@/components/ui/PageSkeletons";

// Program-edit variant of the exercise sets screen (same WorkoutSetsClient),
// reached from the program detail page rather than from a live workout.
export default function ProgramExerciseLoading() {
  return <ExerciseSetsSkeleton />;
}
