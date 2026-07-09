import { CyclesListClient } from "@/components/features/CyclesListClient";
import { getTrainingCycles } from "@/lib/actions/training-cycles";
import { requireSession } from "@/lib/utils/session";

export const dynamic = "force-dynamic";

export default async function CyclesPage() {
  await requireSession();
  const result = await getTrainingCycles();
  const cycles = result.success ? result.data : [];
  return <CyclesListClient cycles={cycles} />;
}
