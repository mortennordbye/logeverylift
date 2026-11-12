import { CyclesListClient } from "@/components/features/CyclesListClient";
import { getTrainingCycles } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { requireSession } from "@/lib/utils/session";

export default async function CyclesPage() {
  const session = await requireSession();
  const [result, enduranceEnabled] = await Promise.all([
    getTrainingCycles(),
    enduranceEnabledFor(session.user.id),
  ]);
  const cycles = result.success ? result.data : [];
  return <CyclesListClient cycles={cycles} enduranceEnabled={enduranceEnabled} />;
}
