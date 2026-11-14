import { HOME_UI } from "@/components/features/home/fonts";
import { Skeleton } from "@/components/ui/Skeleton";

/** Skeleton for Add a phase step 2: the form header, the step bar and the seven days. */
export default function AddPhaseWeekLoading() {
  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-hidden`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-2 pt-4 min-h-[60px]">
        <span />
        <span className="text-base font-semibold">Add a phase</span>
        <span />
      </div>
      <div className="flex flex-col gap-[18px] px-4 pt-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-44" />
        <div className="flex flex-col overflow-hidden rounded-[20px] bg-widget">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex h-[57px] items-center gap-3 border-b border-hairline px-4 last:border-0">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
