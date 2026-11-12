import { CyclesListClient } from "@/components/features/CyclesListClient";
import { RecentlyDeleted } from "@/components/features/RecentlyDeleted";
import { getDeletedPlans } from "@/lib/actions/plan-revisions";
import { getTrainingCycles } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { getUserSettings } from "@/lib/user-settings";
import { shortDateTime } from "@/lib/utils/user-date";
import { requireSession } from "@/lib/utils/session";

export default async function CyclesPage() {
  const session = await requireSession();
  const [result, enduranceEnabled, deletedResult, { timeZone }] = await Promise.all([
    getTrainingCycles(),
    enduranceEnabledFor(session.user.id),
    getDeletedPlans({ type: "cycle" }),
    getUserSettings(session.user.id),
  ]);
  const cycles = result.success ? result.data : [];
  const deleted = deletedResult.success
    ? deletedResult.data.map((d) => ({ id: d.id, name: d.name, revisionId: d.revisionId, deletedOn: shortDateTime(d.deletedAt, timeZone) }))
    : [];
  return (
    <CyclesListClient
      cycles={cycles}
      enduranceEnabled={enduranceEnabled}
      recentlyDeleted={<RecentlyDeleted kind="cycle" items={deleted} />}
    />
  );
}
