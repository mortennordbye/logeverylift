import { StepResultsForm } from "@/components/features/guided/StepResultsForm";
import { enduranceEnabledFor } from "@/lib/endurance";
import { plannedSessionView } from "@/lib/planned-view";
import { requireSession } from "@/lib/utils/session";

import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";

/** Per-step results of one planned session (docs/plans/endurance-app.md, 5.3). */
export default async function ResultsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const v = await plannedSessionView(user.id, id);
  if (!v) notFound();
  const { from } = await searchParams;
  const existing = v.results
    ? { steps: v.results.rows.flatMap((r) => (r.result ? [r.result] : [])), sessionRpe: v.results.sessionRpe, distanceMeters: v.results.distanceMeters }
    : null;
  return (
    <div className="h-[100dvh] bg-background flex flex-col">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: `/planned/${id}`, label: "Session" }} />
      </div>
      <StepResultsForm session={v.player} units={v.units} existing={existing} fromPlayer={from === "player"} />
    </div>
  );
}
