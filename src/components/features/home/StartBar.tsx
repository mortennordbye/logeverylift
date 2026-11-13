import Link from "next/link";

/**
 * No-cycle action, pinned above the nav bar (pinned kind). The cycle prompt
 * lives in the Today widget, so only the train-now action is pinned here. It
 * is the only start without a cycle, so the layout cannot hide it.
 */
export function StartBar() {
  return (
    <div className="px-6 pb-4 shrink-0" data-testid="start-bar">
      <Link
        href="/new-workout"
        className="flex items-center justify-center w-full rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground active:opacity-80"
      >
        Start a Workout
      </Link>
    </div>
  );
}
