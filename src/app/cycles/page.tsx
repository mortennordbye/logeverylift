import { CyclesListClient } from "@/components/features/CyclesListClient";
import { RecentlyDeleted } from "@/components/features/RecentlyDeleted";
import { SeasonsSection } from "@/components/features/SeasonsSection";
import { getDeletedPlans } from "@/lib/actions/plan-revisions";
import { getTrainingCycles } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { listSeasons } from "@/lib/seasons";
import { getUserSettings } from "@/lib/user-settings";
import { localDateStr, shortDateTime } from "@/lib/utils/user-date";
import { requireSession } from "@/lib/utils/session";

export default async function CyclesPage() {
  const session = await requireSession();
  const [result, enduranceEnabled, deletedResult, deletedSeasonsResult, { timeZone }, seasons] = await Promise.all([
    getTrainingCycles(),
    enduranceEnabledFor(session.user.id),
    getDeletedPlans({ type: "cycle" }),
    getDeletedPlans({ type: "season" }),
    getUserSettings(session.user.id),
    listSeasons(session.user.id),
  ]);
  const cycles = result.success ? result.data : [];
  const deletedOf = (r: typeof deletedResult) =>
    r.success ? r.data.map((d) => ({ id: d.id, name: d.name, revisionId: d.revisionId, deletedOn: shortDateTime(d.deletedAt, timeZone) })) : [];
  return (
    <CyclesListClient
      cycles={cycles}
      enduranceEnabled={enduranceEnabled}
      seasons={<SeasonsSection seasons={seasons} today={localDateStr(new Date(), timeZone)} enduranceEnabled={enduranceEnabled} />}
      recentlyDeleted={
        <>
          <RecentlyDeleted kind="cycle" items={deletedOf(deletedResult)} />
          <RecentlyDeleted kind="season" items={deletedOf(deletedSeasonsResult)} />
        </>
      }
    />
  );
}
