import { SessionCheckSteps } from "@/components/features/session-check/SessionCheckSteps";
import { enduranceEnabledFor } from "@/lib/endurance";
import { plannedSessionCheck } from "@/lib/session-check";
import { requireSession } from "@/lib/utils/session";
import { notFound, redirect } from "next/navigation";

/** Every step of a done planned bike or run session, from the app or the watch alone (docs/plans/session-check.md, decision 7). */
export default async function PlannedCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const view = await plannedSessionCheck(user.id, id);
  if (!view) notFound();
  return <SessionCheckSteps view={view} back={{ href: `/planned/${id}`, label: "Session" }} />;
}
