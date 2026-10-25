import { Skeleton } from "@/components/ui/Skeleton";
import { ChevronLeftIcon } from "lucide-react";

/** Mirrors ExerciseDetailClient. */
export default function ExerciseDetailLoading() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-4 shrink-0">
        <span className="flex items-center gap-0.5 text-primary -ml-1 min-h-[44px]">
          <ChevronLeftIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Back</span>
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe space-y-4">
        <div>
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-16 w-full mt-2 rounded-xl" />
        </div>
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
      </div>
    </div>
  );
}
