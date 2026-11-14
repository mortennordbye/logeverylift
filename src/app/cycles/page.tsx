import { CyclesListClient } from "@/components/features/CyclesListClient";
import { getDeletedPlans } from "@/lib/actions/plan-revisions";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { loadPlanList } from "@/lib/plan-list";
import { requireSession } from "@/lib/utils/session";

/** The Plan tab (docs/plans/plan-tab-redesign.md, P1). The route keeps its old name. */
export default async function PlanPage() {
  const session = await requireSession();
  // Like home: a block whose day has come starts, and one that is over completes, before the list is read.
  await getActiveCycleForUser();
  const enduranceEnabled = await enduranceEnabledFor(session.user.id);
  const [data, deletedCycles, deletedSeasons] = await Promise.all([
    loadPlanList(session.user.id, enduranceEnabled),
    getDeletedPlans({ type: "cycle" }),
    getDeletedPlans({ type: "season" }),
  ]);
  const deletedCount = (deletedCycles.success ? deletedCycles.data.length : 0) + (deletedSeasons.success ? deletedSeasons.data.length : 0);
  return <CyclesListClient data={data} deletedCount={deletedCount} />;
}
