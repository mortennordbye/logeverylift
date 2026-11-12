import { CyclesListClient } from "@/components/features/CyclesListClient";
import { RecentlyDeleted } from "@/components/features/RecentlyDeleted";
import { getDeletedPlans } from "@/lib/actions/plan-revisions";
import { getTrainingCycles } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { requireSession } from "@/lib/utils/session";

export default async function CyclesPage() {
  const session = await requireSession();
  const [result, enduranceEnabled, deletedResult] = await Promise.all([
    getTrainingCycles(),
    enduranceEnabledFor(session.user.id),
    getDeletedPlans({ type: "cycle" }),
  ]);
  const cycles = result.success ? result.data : [];
  const deleted = deletedResult.success
    ? deletedResult.data.map((d) => ({ ...d, deletedAt: d.deletedAt.toISOString() }))
    : [];
  return (
    <CyclesListClient
      cycles={cycles}
      enduranceEnabled={enduranceEnabled}
      recentlyDeleted={<RecentlyDeleted kind="cycle" items={deleted} />}
    />
  );
}
