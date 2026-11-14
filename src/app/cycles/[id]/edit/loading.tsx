import { HOME_UI } from "@/components/features/home/fonts";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Skeleton for Edit details: its header and first fields. The page reads the
 * session and the cycle, so without this boundary the dev server reports
 * uncached data outside Suspense on every load.
 */
export default function EditCycleLoading() {
  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-hidden`}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-4 pt-4 min-h-[60px]">
        <span />
        <span className="text-base font-semibold">Edit details</span>
        <span />
      </div>
      <div className="flex flex-col gap-[22px] px-4 pt-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    </div>
  );
}
