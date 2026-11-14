import { Play } from "lucide-react";
import Link from "next/link";

/**
 * No-cycle action, pinned above the nav bar (pinned kind). The cycle prompt
 * lives in the Today widget, so only the train-now action is pinned here. It
 * is the only start without a cycle, so the layout cannot hide it.
 */
export function StartBar() {
  return (
    <div className="px-4 pb-3 pt-1 shrink-0" data-testid="start-bar">
      <Link
        href="/new-workout"
        className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-fill text-[17px] font-bold text-white transition-transform active:scale-[0.97]"
      >
        <Play className="h-[18px] w-[18px] fill-current" aria-hidden />
        Start a Workout
      </Link>
    </div>
  );
}
