import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Skeleton for the cycles list, and the fallback boundary for /cycles
 * subroutes without their own loading.tsx. Mirrors the ActiveCycleCard
 * (rounded-2xl card with a progress bar) plus the flat draft/past rows.
 */
export default function CyclesLoading() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Cycles</h1>
        <div className="w-7 h-7 rounded-full border-2 border-primary" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-nav-safe space-y-4">
        <div className="rounded-2xl bg-card p-4">
          <div className="flex items-start justify-between mb-3">
            <Skeleton className="h-5 w-36" />
            <span className="w-2 h-2 rounded-full bg-muted mt-1.5 shrink-0" />
          </div>
          <Skeleton className="h-3 w-24 mb-1" />
          <div className="w-full h-1.5 bg-border rounded-full overflow-hidden mb-2" />
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="rounded-2xl bg-card overflow-hidden divide-y divide-border">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
