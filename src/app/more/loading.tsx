import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Skeleton for the More menu, and the fallback boundary for every /more
 * subroute without its own loading.tsx. The rows mirror MoreClient's
 * `min-h-[56px]` icon + label list.
 */
export default function MoreLoading() {
  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <header className="flex-none px-4 pt-6 pb-4 border-b border-border">
        <h1 className="text-3xl font-bold tracking-tight">More</h1>
      </header>
      <main className="flex-1 overflow-y-auto pb-nav-safe">
        <div className="divide-y divide-border">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 min-h-[56px]">
              <Skeleton className="w-5 h-5 flex-none" />
              <Skeleton className="h-5 w-32" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
