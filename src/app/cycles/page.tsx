import { CyclesListClient } from "@/components/features/CyclesListClient";
import { getActiveCycleForUser } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { deletedPlanCount } from "@/lib/plan-deleted";
import { loadPlanList } from "@/lib/plan-list";
import { requireSession } from "@/lib/utils/session";

/** The Plan tab (docs/plans/plan-tab-redesign.md, P1). The route keeps its old name. */
export default async function PlanPage() {
  const session = await requireSession();
  // Like home: a block whose day has come starts, and one that is over completes, before the list is read.
  const [, enduranceEnabled] = await Promise.all([getActiveCycleForUser(), enduranceEnabledFor(session.user.id)]);
  const [data, deletedCount] = await Promise.all([
    loadPlanList(session.user.id, enduranceEnabled),
    // A failed count hides Recently deleted, as a failed list read did.
    deletedPlanCount(session.user.id).catch((e: unknown) => {
      console.error("[PlanPage] deleted_count_failed", { error: e instanceof Error ? e.name : "unknown" });
      return 0;
    }),
  ]);
  return <CyclesListClient data={data} deletedCount={deletedCount} />;
}
