import { Skeleton } from "@/components/ui/Skeleton";
import { ChevronLeftIcon, Trash2 } from "lucide-react";

/** Mirrors SessionDetailClient. Without this the slide carried the History
 *  list skeleton, which is the wrong shape and the wrong title. */
export default function SessionDetailLoading() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-6 pb-4 shrink-0">
        <span className="flex items-center gap-0.5 text-primary -ml-1 min-h-[44px]">
          <ChevronLeftIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Back</span>
        </span>
        <span className="w-10 h-10 flex items-center justify-center text-destructive">
          <Trash2 className="h-5 w-5" />
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-5 w-36 mt-2" />
        <div className="flex gap-2 mt-4">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="space-y-3 mt-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-card rounded-2xl p-4 space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
