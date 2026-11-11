import { Skeleton } from "@/components/ui/Skeleton";

export default function InsightsLoading() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="px-4 pt-8 pb-3 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight mb-3">Insights</h1>
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {[200, 160, 160].map((h, i) => (
          <Skeleton key={i} className="w-full rounded-2xl" style={{ height: h }} />
        ))}
      </div>
    </div>
  );
}
