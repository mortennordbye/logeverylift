import { TriathlonPlanForm } from "@/components/features/TriathlonPlanForm";
import { requireSession } from "@/lib/utils/session";

export const dynamic = "force-dynamic";

export default async function TriathlonPlanPage() {
  await requireSession();
  return <TriathlonPlanForm />;
}
