/**
 * Cycle Detail Page
 *
 * Shows the cycle's schedule builder, status, and actions.
 */

import { CycleCompletionBanner } from "@/components/features/CycleCompletionBanner";
import { DeleteCycleButton, RestartCycleButton, StartCycleButton } from "@/components/features/CycleDetailClient";
import { CycleScheduleBuilder } from "@/components/features/CycleScheduleBuilder";
import { getCyclePeriodization, getTrainingCycleWithSlots } from "@/lib/actions/training-cycles";
import { getPrograms } from "@/lib/actions/programs";
import { formatPeriodizationSummary } from "@/lib/utils/periodization";
import { requireSession } from "@/lib/utils/session";
import { seasonOfCycle } from "@/lib/seasons";
import { syncLimitWarnings } from "@/lib/training-limits";
import { dayLabel } from "@/lib/utils/seasons";

import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";

export default async function CycleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cycleId = Number(id);
  if (isNaN(cycleId)) notFound();

  const auth = await requireSession();
  const [cycleResult, programsResult, periodizationResult] = await Promise.all([
    getTrainingCycleWithSlots(cycleId),
    getPrograms(),
    getCyclePeriodization(cycleId),
  ]);

  if (!cycleResult.success) notFound();

  const cycle = cycleResult.data;
  // A phase of a season shows where it sits and the season's races (D8).
  const season = await seasonOfCycle(auth.user.id, cycle);
  // T4: limits this week's sync broke (only an endurance user's sync stores any).
  const limitWarnings = cycle.status === "active" ? await syncLimitWarnings(auth.user.id, cycle.id, cycle.lastSyncedWeek) : [];
  const programs = programsResult.success ? programsResult.data : [];
  const periodization = periodizationResult.success ? periodizationResult.data : null;

  const { headline: periodizationHeadline, note: periodizationNote } = periodization
    ? formatPeriodizationSummary(periodization)
    : { headline: "", note: "" };

  const scheduleLabel =
    cycle.scheduleType === "day_of_week" ? "Day of week" : "Rotation";

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: "/cycles", label: "Cycles" }} />
        <div className="flex items-center gap-4">
          <Link
            href={`/cycles/${cycle.id}/history`}
            className="text-primary text-sm font-medium min-h-[44px] flex items-center active:opacity-70"
          >
            History
          </Link>
          <Link
            href={`/cycles/${cycle.id}/edit`}
            className="text-primary text-sm font-medium min-h-[44px] flex items-center active:opacity-70"
          >
            Edit
          </Link>
        </div>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight truncate">{cycle.name}</h1>
      </div>

      <div className="flex flex-col gap-6 px-4 pb-nav-safe">
        {/* Meta */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">
            {cycle.durationDays != null ? `${cycle.durationDays} days` : `${cycle.durationWeeks} weeks`} · {scheduleLabel}
          </span>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
              cycle.status === "active"
                ? "bg-green-500/15 text-green-600"
                : cycle.status === "completed"
                  ? "bg-muted text-muted-foreground"
                  : "bg-amber-500/15 text-amber-600"
            }`}
          >
            {cycle.status}
          </span>
        </div>

        {season && (
          <Link href={`/seasons/${season.id}`} data-testid="cycle-season" className="rounded-2xl bg-card px-4 py-3 min-h-[44px] active:bg-muted/50">
            <p className="text-sm font-medium">
              Phase {season.position} of {season.phaseCount} in {season.name}
            </p>
            {season.races.map((r) => (
              <p key={r.id} className="text-xs text-muted-foreground">
                {r.priority} race: {r.name}, {dayLabel(r.raceDate)}
              </p>
            ))}
            {season.replan.flagged && <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Race changed, plan not updated</p>}
          </Link>
        )}

        {limitWarnings.length > 0 && (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3" data-testid="sync-limit-warning">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-1">This week breaks a training limit</p>
            {limitWarnings.map((w) => (
              <p key={w.rule} className="text-sm">
                {w.message}
              </p>
            ))}
          </div>
        )}

        {/* Periodization summary (triathlon cycles) */}
        {periodization && (
          <div className="rounded-2xl bg-primary/10 px-4 py-3.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-primary">{periodizationHeadline}</p>
              <span className="text-xs font-semibold text-primary">
                {Math.round(periodization.multiplier * 100)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{periodizationNote}</p>
          </div>
        )}

        {/* Completion banner */}
        {cycle.status === "completed" && (
          <CycleCompletionBanner cycle={cycle} />
        )}

        {/* Start cycle CTA (draft only) */}
        {cycle.status === "draft" && <StartCycleButton cycle={cycle} />}

        {/* Schedule section header */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {cycle.scheduleType === "day_of_week"
              ? "Weekly Schedule"
              : "Rotation Order"}
          </p>
          <CycleScheduleBuilder cycle={cycle} programs={programs} />
        </div>

        {/* Destructive zone */}
        <div className="flex flex-col items-center pt-4 gap-1">
          <RestartCycleButton cycle={cycle} />
          <DeleteCycleButton cycleId={cycle.id} />
        </div>
      </div>
    </div>
  );
}
