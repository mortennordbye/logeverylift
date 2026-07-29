import { ExerciseSetsSkeleton } from "@/components/ui/PageSkeletons";

/**
 * Mirrors WorkoutSetsClient. See the sibling comment in
 * `programs/[id]/workout/loading.tsx` — this is the boundary the exercise
 * slide actually animates, so its geometry has to match the real screen.
 */
export default function WorkoutExerciseLoading() {
  return <ExerciseSetsSkeleton />;
}
