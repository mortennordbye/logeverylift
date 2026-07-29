import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Mirrors WorkoutSessionClient's chrome so the page-transition slide carries a
 * card that already looks like the workout screen. Without a boundary here,
 * Next.js falls back to `programs/loading.tsx`, which slides in a blank card
 * titled "Programs" and then pops the real content in after the motion ends.
 *
 * Geometry must stay in sync with WorkoutSessionClient — same paddings, same
 * row heights — otherwise the swap shifts and the pop comes back.
 */
export default function WorkoutLoading() {
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      {/* Header — Finished / Workout / Edit + add */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <span className="text-primary text-sm font-medium">Finished</span>
        <h1 className="text-3xl font-bold tracking-tight">Workout</h1>
        <div className="flex items-center gap-3">
          <span className="text-primary text-sm font-medium">Edit</span>
          <div className="w-7 h-7 rounded-full border-2 border-primary" />
        </div>
      </div>

      {/* Program name + elapsed time */}
      <div className="px-4 pb-3 shrink-0 flex flex-col items-center gap-0.5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-12 mt-0.5" />
      </div>

      {/* Reserved for the exercise-insight pill row. That row is populated from
          client session state after mount, so without the space held here the
          exercise list jumps down a second time once the slide has finished. */}
      <div className="px-4 pb-3 shrink-0">
        <Skeleton className="h-[26px] w-28 rounded-full" />
      </div>

      {/* Exercise rows */}
      <div className="flex-1 px-4 overflow-y-auto">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 py-3.5 border-b border-border">
            <div className="w-7 h-7 rounded-full border-2 border-muted-foreground/30 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
