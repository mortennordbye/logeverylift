import { Skeleton } from "@/components/ui/Skeleton";
import { ChevronLeftIcon } from "lucide-react";

/** Mirrors the cycle detail screen: Back/Edit header, cycle title, week strip,
 *  then the per-day slot rows. */
export default function CycleDetailLoading() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <span className="flex items-center gap-0.5 text-primary -ml-1 min-h-[44px]">
          <ChevronLeftIcon className="w-5 h-5" />
          <span className="text-sm font-medium">Back</span>
        </span>
        <span className="text-primary text-sm font-medium min-h-[44px] flex items-center">
          Edit
        </span>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-32 mt-2" />
      </div>
      <div className="px-4 pb-4">
        <Skeleton className="h-16 w-full rounded-2xl" />
      </div>
      <div className="px-4 pb-nav-safe space-y-2">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center justify-between bg-card rounded-2xl px-4 py-3.5">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-36" />
          </div>
        ))}
      </div>
    </div>
  );
}
