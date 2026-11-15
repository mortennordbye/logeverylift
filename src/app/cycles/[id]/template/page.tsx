/**
 * A cycle's template (docs/plans/plan-tab-redesign.md, P2): the weekly
 * template of a weekday cycle, or the order of a rotation, edited with the
 * schedule builder. Reached from "Edit weekly template" and "Edit order" on
 * the cycle detail.
 */

import { CycleScheduleBuilder } from "@/components/features/CycleScheduleBuilder";
import { HOME_UI } from "@/components/features/home/fonts";
import { BackLink } from "@/components/ui/BackLink";
import { getPrograms } from "@/lib/actions/programs";
import { getTrainingCycleWithSlots } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

export default async function CycleTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cycleId = Number(id);
  if (isNaN(cycleId)) notFound();

  const auth = await requireSession();
  const [cycleResult, programsResult, endurance] = await Promise.all([
    getTrainingCycleWithSlots(cycleId),
    getPrograms(),
    enduranceEnabledFor(auth.user.id),
  ]);
  if (!cycleResult.success) notFound();
  const cycle = cycleResult.data;
  const programs = programsResult.success ? programsResult.data : [];

  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-y-auto`}>
      <header className="flex items-center px-4 pt-4 shrink-0">
        <BackLink fallback={{ href: `/cycles/${cycle.id}`, label: cycle.name }} />
      </header>
      <div className="flex flex-col gap-4 px-4 pt-2 pb-nav-safe">
        <div className="flex flex-col gap-1.5">
          <h1 className="home-display text-[34px] leading-9 uppercase break-words">{cycle.scheduleType === "day_of_week" ? "Weekly template" : "Rotation order"}</h1>
          <span className="text-sm text-muted-foreground">{cycle.name}</span>
        </div>
        <CycleScheduleBuilder cycle={cycle} programs={programs} endurance={endurance} />
      </div>
    </div>
  );
}
