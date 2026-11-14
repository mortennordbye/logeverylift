import { AddPhaseForm } from "@/components/features/AddPhaseForm";
import { HOME_UI } from "@/components/features/home/fonts";
import { enduranceEnabledFor } from "@/lib/endurance";
import { getSeasonDetail, seasonlessCycles } from "@/lib/seasons";
import { addDaysStr } from "@/lib/utils/seasons";
import { requireSession } from "@/lib/utils/session";

import { notFound } from "next/navigation";

/** Add a phase to a season (J4_AddPhase); a new cycle continues to /seasons/[id]/phases/[cycleId]/week for its week. */
export default async function AddPhasePage({ params }: { params: Promise<{ id: string }> }) {
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
  const last = detail.phases.at(-1) ?? null;

  return (
    <div className={`${HOME_UI} h-[100dvh] overflow-y-auto bg-home`}>
      <AddPhaseForm
        seasonId={seasonId}
        seasonName={detail.season.name}
        position={detail.phases.length + 1}
        afterName={last?.name ?? null}
        startsOn={last ? addDaysStr(last.end, 1) : detail.season.startDate}
        enduranceEnabled={enduranceEnabled}
        taperDays={detail.taperDays}
        candidates={candidates}
      />
    </div>
  );
}
