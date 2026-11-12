import { TriathlonPlanForm } from "@/components/features/TriathlonPlanForm";
import { enduranceEnabledFor } from "@/lib/endurance";
import { requireSession } from "@/lib/utils/session";
import { redirect } from "next/navigation";

export default async function TriathlonPlanPage() {
  const session = await requireSession();
  // Part of the endurance add-on (src/lib/endurance.ts).
  if (!(await enduranceEnabledFor(session.user.id))) redirect("/cycles");
  return <TriathlonPlanForm />;
}
