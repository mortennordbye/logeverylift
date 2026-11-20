/**
 * A ride that is the first half of a brick, once it has ended
 * (docs/plans/run-logger.md, section 5 "Brick"): "Start run" is the pinned
 * primary, and the ride's results and summary wait until after the run.
 */

import { BackLink } from "@/components/ui/BackLink";
import Link from "next/link";

export function BrickRideDone({
  programId,
  exerciseName,
  doneLine,
  endedEarly,
  runHref,
}: {
  programId: number;
  exerciseName: string;
  doneLine: string;
  endedEarly: boolean;
  runHref: string;
}) {
  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden" data-testid="brick-ride-done">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: `/programs/${programId}/workout`, label: "Workout" }} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{exerciseName}</p>
          <h1 className="text-3xl font-bold tracking-tight">{endedEarly ? "Ride ended early" : "Ride done"}</h1>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">{doneLine}</p>
        </div>
        <p className="rounded-xl bg-muted px-4 py-3 text-sm">Brick · the run is next</p>
      </div>
      <div data-pinned-bar className="shrink-0 px-4 pt-2 pb-3 flex flex-col gap-1 border-t border-border bg-background">
        <Link href={runHref} className="min-h-12 rounded-2xl bg-brand-fill px-4 text-base font-semibold text-white inline-flex items-center justify-center active:opacity-80">
          Start run
        </Link>
        <p className="min-h-11 inline-flex items-center justify-center text-sm text-muted-foreground">Ride numbers later</p>
      </div>
    </div>
  );
}
