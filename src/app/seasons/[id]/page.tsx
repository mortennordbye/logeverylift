import { HOME_UI } from "@/components/features/home/fonts";
import { PlanItemDeleted } from "@/components/features/PlanItemDeleted";
import { SeasonDetailClient } from "@/components/features/SeasonDetailClient";
import { enduranceEnabledFor } from "@/lib/endurance";
import { getSeasonDetail, seasonStartContext } from "@/lib/seasons";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { ownDeletedSeason } from "@/lib/plan-deleted";
import { requireSession } from "@/lib/utils/session";

import { notFound } from "next/navigation";

/** A season (J4_SeasonDetail): goal, the A race, phases, races and the re-plan flag (docs/plans/seasons.md, 2.10). */
export default async function SeasonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seasonId = Number(id);
  if (!Number.isInteger(seasonId) || seasonId <= 0) notFound();
  const auth = await requireSession();
  const [detail, enduranceEnabled, today] = await Promise.all([
    getSeasonDetail(auth.user.id, seasonId),
    enduranceEnabledFor(auth.user.id),
    userToday(auth.user.id),
  ]);
  // Delete season renders this page again in its response.
  const deleted = detail ? null : await ownDeletedSeason(auth.user.id, seasonId);
  if (deleted) return <PlanItemDeleted item={deleted} />;
  if (!detail) notFound();
  const s = detail.season;
  // Resume takes the scheduled start: its confirm says what that ends and drops.
  const { running, scheduled } = await seasonStartContext(auth.user.id, toDateStr(today));

  return (
    <div className={`${HOME_UI} h-[100dvh] overflow-y-auto bg-home`}>
      <SeasonDetailClient
        season={{ id: s.id, name: s.name, goal: s.goal, startDate: s.startDate, endDate: s.endDate, nextGoal: s.nextGoal }}
        today={toDateStr(today)}
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
        aRaceId={detail.aRace?.id ?? null}
        phases={detail.phases.map((p) => ({
          id: p.id,
          name: p.name,
          phaseType: p.phaseType,
          durationWeeks: p.durationWeeks,
          durationDays: p.durationDays,
          start: p.start,
          end: p.end,
          lengthDays: p.lengthDays,
          state: p.state,
        }))}
        taperFit={detail.taperFit}
        next={detail.next}
        gapBefore={detail.gapBefore}
        overrunAfter={detail.overrunAfter}
        running={running}
        scheduled={scheduled}
      />
    </div>
  );
}
