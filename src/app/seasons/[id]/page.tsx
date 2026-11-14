import { dayLabel } from "@/lib/utils/seasons";
import { SeasonDetailClient } from "@/components/features/SeasonDetailClient";
import { enduranceEnabledFor } from "@/lib/endurance";
import { getSeasonDetail, seasonlessCycles } from "@/lib/seasons";
import { requireSession } from "@/lib/utils/session";

import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";

/** A season: goal, races, phases and the re-plan flag (docs/plans/seasons.md, 2.10). */
export default async function SeasonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isInteger(seasonId) || seasonId <= 0) notFound();
  const auth = await requireSession();
  const [detail, enduranceEnabled, candidates] = await Promise.all([
    getSeasonDetail(auth.user.id, seasonId),
    enduranceEnabledFor(auth.user.id),
    seasonlessCycles(auth.user.id),
  ]);
  if (!detail) notFound();
  const s = detail.season;

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/cycles", label: "Cycles" }} />
        <div className="flex items-center gap-4">
          <Link href={`/seasons/${s.id}/history`} className="text-primary text-sm font-medium min-h-[44px] flex items-center active:opacity-70">
            History
          </Link>
          <Link href={`/seasons/${s.id}/edit`} className="text-primary text-sm font-medium min-h-[44px] flex items-center active:opacity-70">
            Edit
          </Link>
        </div>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight truncate">{s.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {dayLabel(s.startDate)} to {dayLabel(s.endDate)}
        </p>
        {s.goal && <p className="text-sm mt-2">{s.goal}</p>}
        {s.nextGoal && <p className="text-sm text-muted-foreground mt-1">Next: {s.nextGoal}</p>}
      </div>
      <div className="px-4 pb-nav-safe flex flex-col gap-6">
        <SeasonDetailClient
          seasonId={s.id}
          enduranceEnabled={enduranceEnabled}
          replan={detail.replan.flagged ? { reason: detail.replan.reason } : null}
          races={detail.races.map((r) => ({
            id: r.id,
            name: r.name,
            raceDate: r.raceDate,
            discipline: r.discipline,
            distance: r.distance,
            distanceMeters: r.distanceMeters,
            priority: r.priority,
          }))}
          phases={detail.phases.map((p) => ({
            id: p.id,
            name: p.name,
            phaseType: p.phaseType,
            durationWeeks: p.durationWeeks,
            durationDays: p.durationDays,
            start: p.start,
            end: p.end,
            state: p.state,
          }))}
          taperFit={detail.taperFit}
          next={detail.next}
          gapBefore={detail.gapBefore}
          overrunAfter={detail.overrunAfter}
          candidates={candidates}
        />
      </div>
    </div>
  );
}
