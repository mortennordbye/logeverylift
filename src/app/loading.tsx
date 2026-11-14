import { Skeleton } from "@/components/ui/Skeleton";

/**
 * The home while it loads: the title, one card and one strip. It cannot know
 * the user's layout or type, so it stays neutral (docs/home-widgets-audit.md,
 * 6.4; closes docs/ui-polish-audit.md B2).
 */
export default function HomeLoading() {
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden">
      <div className="px-6 pt-6 pb-3 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-center">LogEveryLift</h1>
      </div>
      <div className="flex-1 flex flex-col gap-3 px-6 min-h-0 pb-4">
        <Skeleton className="h-44 rounded-2xl shrink-0" />
        <Skeleton className="flex-1 rounded-2xl" />
      </div>
    </div>
  );
}
