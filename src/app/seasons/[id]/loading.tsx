import { HOME_UI } from "@/components/features/home/fonts";
import { BackLabel } from "@/components/ui/BackLink";
import { Skeleton } from "@/components/ui/Skeleton";
import { ChevronLeft } from "lucide-react";

/**
 * Mirrors the season page (SeasonDetailClient): Back and the round ⋯ button,
 * the display title and its dates, the hero card with the countdown and the
 * phase bar, then the phase rows with a drag handle. Same paddings, so the
 * page does not jump when it lands.
 */
export default function SeasonLoading() {
  return (
    <div className={`${HOME_UI} h-[100dvh] overflow-hidden bg-home`} data-testid="season-skeleton">
      <header className="flex items-center justify-between px-4 pt-4">
        <span className="flex items-center gap-0.5 text-primary -ml-1 min-h-[44px]">
          <ChevronLeft className="w-5 h-5 shrink-0" />
          <span className="text-sm font-medium">
            <BackLabel fallback={{ href: "/cycles", label: "Plan" }} />
          </span>
        </span>
        <span className="h-11 w-11 rounded-full bg-widget" aria-hidden />
      </header>
      <div className="flex flex-col gap-4 px-4 pt-1">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex flex-col gap-3.5 rounded-[20px] bg-widget px-[18px] py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-5 w-44" />
            </div>
            <Skeleton className="h-10 w-16" />
          </div>
          <Skeleton className="h-2.5 w-full rounded" />
        </div>
        <div className="flex flex-col gap-2">
          <span className="mx-1 text-xs font-semibold uppercase tracking-[1px] text-muted-foreground">Phases</span>
          <div className="flex flex-col overflow-hidden rounded-[20px] bg-widget">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex min-h-14 items-center border-b border-hairline last:border-0">
                <span className="w-11 shrink-0" />
                <div className="flex flex-1 flex-col gap-1.5 py-3 pr-3">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
