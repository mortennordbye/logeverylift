import { HOME_UI } from "@/components/features/home/fonts";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Skeleton for the Plan list, and the fallback boundary for /cycles
 * subroutes without their own loading.tsx. Mirrors the hero card and a
 * section of rows.
 */
export default function CyclesLoading() {
  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-hidden`}>
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <h1 className="home-display text-[40px] uppercase tracking-[0.5px]">Plan</h1>
        <div className="h-11 w-11 rounded-full bg-brand" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-nav-safe space-y-5">
        <div className="rounded-[20px] bg-widget p-[18px] space-y-3.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-5 w-48" />
          <div className="grid grid-cols-7 gap-1">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-16 rounded-[10px] bg-widget-2" />
            ))}
          </div>
        </div>
        <div className="rounded-[20px] bg-widget overflow-hidden divide-y divide-hairline">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-1.5 px-4 py-3.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
