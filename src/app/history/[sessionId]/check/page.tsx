import { SessionCheckSteps } from "@/components/features/session-check/SessionCheckSteps";
import { enduranceEnabledFor } from "@/lib/endurance";
import { workoutSessionCheck } from "@/lib/session-check";
import { requireSession } from "@/lib/utils/session";
import { notFound, redirect } from "next/navigation";

/** Every step of the rides and runs of a logged workout, kept for good (docs/plans/session-check.md, decision 7). */
export default async function HistoryCheckPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/");
  const id = Number((await params).sessionId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const view = await workoutSessionCheck(user.id, id);
  if (!view) notFound();
  return <SessionCheckSteps view={view} back={{ href: `/history/${id}`, label: "Workout" }} />;
}
