import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Skeleton for the programs *list*. It is also the fallback boundary for any
 * route under /programs without a loading.tsx of its own, so keep it generic
 * enough not to look actively wrong there — the deep routes that matter get
 * their own file (see programs/[id]/workout/loading.tsx).
 */
export default function ProgramsLoading() {
  return (
    <div className="h-[100dvh] bg-background overflow-y-auto pb-nav-safe">
      <div className="flex items-center justify-between px-4 pt-6 pb-2">
        <h1 className="text-3xl font-bold tracking-tight">Programs</h1>
        <div className="flex items-center gap-3">
          <Skeleton className="w-5 h-5" />
          <div className="w-7 h-7 rounded-full border-2 border-primary" />
        </div>
      </div>
      <div className="px-4 pt-4">
        <div className="flex flex-col divide-y divide-border rounded-2xl bg-card overflow-hidden mb-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
