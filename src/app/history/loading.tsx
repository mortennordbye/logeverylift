import { Skeleton } from "@/components/ui/Skeleton";

export default function HistoryLoading() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="px-4 pt-6 pb-2 shrink-0" />
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">History</h1>
      </div>
      <div className="px-4 pb-3 shrink-0">
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        <div className="space-y-3 pb-nav-safe">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-card rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-3 w-12" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
