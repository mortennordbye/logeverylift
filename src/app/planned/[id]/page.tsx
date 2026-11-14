import { SavedRunLink } from "@/components/features/guided/SavedRunLink";
import { STEP_WORD } from "@/components/features/guided/types";
import { enduranceEnabledFor } from "@/lib/endurance";
import { distanceLabel, plannedSessionView } from "@/lib/planned-view";
import { formatTime } from "@/lib/utils/format";
import { shortDay } from "@/lib/utils/seasons";
import { THRESHOLD_LABEL } from "@/lib/utils/thresholds";
import { requireSession } from "@/lib/utils/session";
import type { ThresholdKind } from "@/db/schema/athlete-profile";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";

const BAND_TEXT: Record<string, string> = { green: "On plan", yellow: "Partly", orange: "Far off plan", red: "Missed", done: "Done", illness: "Sick" };

/**
 * One planned session with a structured workout (docs/plans/endurance-app.md,
 * 4.3): its steps in the user's own numbers, totals and planned load, and the
 * way in to the guided player, the pool view and the step results.
 */
export default async function PlannedSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireSession();
  if (!(await enduranceEnabledFor(user.id))) redirect("/");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const v = await plannedSessionView(user.id, id);
  if (!v) notFound();
  const { session, workout, units, estimate } = v;
  const done = session.state === "done";
  const swim = workout.sport === "swim";

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-y-auto">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/week", label: "Week" }} />
      </div>
      <div className="px-4 pt-2 pb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {shortDay(session.date)} · {session.priority}
          {session.band ? ` · ${BAND_TEXT[session.band]}` : ""}
        </p>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="planned-name">
          {workout.name}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {estimate.durationSeconds > 0 ? `${estimate.durationComplete ? "" : "at least "}${formatTime(estimate.durationSeconds)}` : "time open"}
          {estimate.distanceMeters > 0 ? ` · ${estimate.distanceComplete ? "" : "at least "}${distanceLabel(estimate.distanceMeters, workout.sport, units)}` : ""}
          {` · load about ${Math.round(v.plannedLoad.load)}${v.plannedLoad.partial ? " (estimate)" : ""}`}
        </p>
        {v.missingAnchors.length > 0 && (
          <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm">
            Set {v.missingAnchors.map((k) => THRESHOLD_LABEL[k as ThresholdKind] ?? k).join(", ")} to see these targets in your own numbers.{" "}
            <Link href="/more/thresholds" className="text-primary underline">
              Thresholds
            </Link>
          </p>
        )}
      </div>

      <ol className="px-4 flex flex-col gap-1" data-testid="planned-steps">
        {v.rows.map((r) => (
          <li key={r.key} className="flex items-start justify-between gap-3 rounded-xl bg-muted px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {STEP_WORD[r.type]}
                {r.round ? ` · ${r.round.index}/${r.round.of}` : ""}
              </p>
              <p className="text-sm">{r.text}</p>
            </div>
            {r.target && <p className="shrink-0 text-sm font-semibold tabular-nums">{r.target.text}</p>}
          </li>
        ))}
      </ol>

      <div className="mt-auto flex flex-col gap-2 px-4 pt-4 pb-6">
        {!done && <SavedRunLink plannedSessionId={id} />}
        {!done && !swim && (
          <Link href={`/planned/${id}/play`} className="min-h-12 rounded-2xl bg-primary px-4 py-3 text-center text-base font-semibold text-primary-foreground active:opacity-80">
            Start guided
          </Link>
        )}
        {swim && (
          <Link href={`/planned/${id}/pool`} className="min-h-12 rounded-2xl bg-primary px-4 py-3 text-center text-base font-semibold text-primary-foreground active:opacity-80">
            Pool view
          </Link>
        )}
        <Link href={`/planned/${id}/results`} className="min-h-12 rounded-2xl border border-border px-4 py-3 text-center text-base font-medium active:opacity-70">
          {v.results ? "Step results" : done ? "Add step results" : "Log results by hand"}
        </Link>
      </div>
    </div>
  );
}
