import { Skeleton } from "@/components/ui/Skeleton";
import { ChevronLeftIcon } from "lucide-react";

/**
 * Route-level skeletons shared by more than one `loading.tsx`.
 *
 * These exist so the page-transition slide carries a card shaped like the
 * screen it is standing in for. Geometry has to track the real component —
 * same paddings, same row heights — or the placeholder→content swap shifts and
 * the transition pops. Each one names the component it mirrors; change them
 * together.
 */

/** Back / Edit header used by WorkoutSetsClient, ProgramDetailClient. */
export function BackEditHeader({ backLabel = "Back" }: { backLabel?: string }) {
  return (
    <div className="flex items-center px-4 pt-6 pb-4 shrink-0">
      <div className="w-20 shrink-0 flex items-center">
        <span className="flex items-center gap-0.5 text-primary -ml-1 min-h-[44px]">
          <ChevronLeftIcon className="h-5 w-5" />
          <span className="text-sm font-medium">{backLabel}</span>
        </span>
      </div>
      <div className="flex-1" />
      <div className="w-20 shrink-0 flex items-center justify-end">
        <span className="text-primary text-sm font-medium">Edit</span>
      </div>
    </div>
  );
}

/** Mirrors WorkoutSetsClient — used by both the workout and program-edit
 *  variants of the exercise sets screen. */
export function ExerciseSetsSkeleton({ backLabel }: { backLabel?: string }) {
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <BackEditHeader backLabel={backLabel} />
      <div className="px-4 pb-4 shrink-0">
        <Skeleton className="h-9 w-52" />
      </div>
      <div className="px-4 pb-4 shrink-0 flex items-center gap-2">
        <Skeleton className="h-[30px] w-24 rounded-full" />
        <Skeleton className="h-[30px] w-20 rounded-full" />
      </div>
      <div className="flex-1 px-4 overflow-y-auto">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 py-4 border-t border-b border-border">
            <div className="w-7 h-7 rounded-full border-2 border-primary shrink-0" />
            <div className="w-7 h-7 rounded-full bg-muted shrink-0" />
            <div className="flex-1">
              <Skeleton className="h-5 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Mirrors the Edit Set / New Set routes wrapping SetEditView. */
export function SetEditSkeleton() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col pb-nav-safe overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-6 pb-4">
        <span className="flex items-center gap-1 text-primary">
          <ChevronLeftIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Sets</span>
        </span>
        <div className="text-lg font-bold">Edit Set</div>
        <div className="w-16" />
      </div>
      <div className="px-4 pb-6 flex justify-center">
        <div className="inline-flex items-center gap-2">
          <span className="text-sm text-muted-foreground">SET</span>
          <div className="w-8 h-8 rounded-full bg-muted" />
          <Skeleton className="h-4 w-10" />
        </div>
      </div>
      <div className="flex-1 px-4 space-y-4">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
      <div className="px-4 pb-4">
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** Mirrors the exercise-picker routes (add-exercise): search field + long list. */
export function ExercisePickerSkeleton() {
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-6 pb-4 shrink-0">
        <span className="flex items-center gap-1 text-primary">
          <ChevronLeftIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Back</span>
        </span>
        <div className="text-lg font-bold">Add Exercise</div>
        <div className="w-16" />
      </div>
      <div className="px-4 pb-3 shrink-0">
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        <div className="divide-y divide-border">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex items-center gap-3 py-3.5">
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Generic "header + card list" skeleton for the simpler /more subroutes. */
export function ListPageSkeleton({
  title,
  rows = 5,
}: {
  title: string;
  rows?: number;
}) {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="px-4 pt-6 pb-2 shrink-0">
        <span className="flex items-center gap-0.5 text-primary -ml-1 min-h-[44px]">
          <ChevronLeftIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Back</span>
        </span>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe">
        <div className="space-y-3">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="bg-card rounded-2xl p-4 flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-full flex-none" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
