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
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CycleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cycleId = Number(id);
  if (isNaN(cycleId)) notFound();

  await requireSession();
  const [cycleResult, programsResult, periodizationResult] = await Promise.all([
    getTrainingCycleWithSlots(cycleId),
    getPrograms(),
    getCyclePeriodization(cycleId),
  ]);

  if (!cycleResult.success) notFound();

  const cycle = cycleResult.data;
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
        <Link
          href="/cycles"
          className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]"
        >
          <ChevronLeftIcon className="w-5 h-5" />
          <span className="text-sm font-medium">Back</span>
        </Link>
        <Link
          href={`/cycles/${cycle.id}/edit`}
          className="text-primary text-sm font-medium min-h-[44px] flex items-center active:opacity-70"
        >
          Edit
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight truncate">{cycle.name}</h1>
      </div>

      <div className="flex flex-col gap-6 px-4 pb-nav-safe">
        {/* Meta */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground">
            {cycle.durationWeeks} weeks · {scheduleLabel}
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
