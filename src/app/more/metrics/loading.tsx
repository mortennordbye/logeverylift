import { Skeleton } from "@/components/ui/Skeleton";

export default function MetricsLoading() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0" />
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Metrics</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe">
        <div className="space-y-4">
          {/* Tab bar */}
          <Skeleton className="h-10 w-full rounded-xl" />
          {/* Section blocks */}
          {[160, 180, 220, 200, 160].map((h, i) => (
            <Skeleton key={i} className="w-full rounded-2xl" style={{ height: h }} />
          ))}
        </div>
      </div>
    </div>
  );
}
