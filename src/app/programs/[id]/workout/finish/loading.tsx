import { Skeleton } from "@/components/ui/Skeleton";

/** Mirrors the workout finish/review screen: centred title, summary card,
 *  feeling picker, notes box, pinned save button. */
export default function WorkoutFinishLoading() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col pb-nav-safe">
      <div className="flex items-center justify-center px-4 pt-6 pb-4 shrink-0">
        <div className="text-lg font-bold">Workout Complete</div>
      </div>
      <div className="flex-1 px-4 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-4">
          <div className="bg-card rounded-2xl p-5 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
        <div className="py-4">
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
