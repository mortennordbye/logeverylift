import { StepResultsForm } from "@/components/features/guided/StepResultsForm";
import { enduranceEnabledFor } from "@/lib/endurance";
import { plannedSessionView } from "@/lib/planned-view";
import { requireSession } from "@/lib/utils/session";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
        <Link href={`/planned/${id}`} className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]">
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Session</span>
        </Link>
      </div>
      <StepResultsForm session={v.player} units={v.units} existing={existing} fromPlayer={from === "player"} />
    </div>
  );
}
