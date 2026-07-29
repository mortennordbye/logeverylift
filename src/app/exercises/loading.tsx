import { ExercisePickerSkeleton } from "@/components/ui/PageSkeletons";

// The exercise library uses the same search-plus-long-list shape as the
// in-workout picker.
export default function ExercisesLoading() {
  return <ExercisePickerSkeleton />;
}
