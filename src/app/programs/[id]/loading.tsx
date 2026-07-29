import { BackEditHeader } from "@/components/ui/PageSkeletons";
import { Skeleton } from "@/components/ui/Skeleton";

/** Mirrors ProgramDetailClient: Back/Edit header, program title, exercise rows. */
export default function ProgramDetailLoading() {
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <BackEditHeader />
      <div className="px-4 pb-4 shrink-0">
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="flex-1 px-4 overflow-y-auto">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 py-4 border-b border-border last:border-0">
            <div className="w-7 h-7 rounded-full border-2 border-muted-foreground/30 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
            <div className="w-10 flex justify-end">
              <Skeleton className="h-5 w-5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
