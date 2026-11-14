/**
 * Add a phase, step 2 of 2 (J4_WeekBuilder): the week of the phase made in
 * step 1, built with the schedule builder, and a pinned "Add phase" that goes
 * back to the season. The phase already exists; each slot saves as it is set.
 */

import { AddPhaseFinish } from "@/components/features/AddPhaseForm";
import { CycleScheduleBuilder } from "@/components/features/CycleScheduleBuilder";
import { HOME_UI } from "@/components/features/home/fonts";
import { StepProgress } from "@/components/features/season-ui";
import { BackLink } from "@/components/ui/BackLink";
import { getPrograms } from "@/lib/actions/programs";
import { getTrainingCycleWithSlots } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { PHASE_TYPE_LABELS } from "@/lib/utils/seasons";
import { requireSession } from "@/lib/utils/session";
import { notFound } from "next/navigation";

export default async function AddPhaseWeekPage({ params }: { params: Promise<{ id: string; cycleId: string }> }) {
  const { id, cycleId: rawCycleId } = await params;
  const seasonId = Number(id);
  const cycleId = Number(rawCycleId);
  if (!Number.isInteger(seasonId) || !Number.isInteger(cycleId)) notFound();

  const auth = await requireSession();
  const [cycleResult, programsResult, endurance] = await Promise.all([getTrainingCycleWithSlots(cycleId), getPrograms(), enduranceEnabledFor(auth.user.id)]);
  // The cycle read checks the owner; it must also be a phase of this season.
  if (!cycleResult.success || cycleResult.data.seasonId !== seasonId) notFound();
  const cycle = cycleResult.data;
  const programs = programsResult.success ? programsResult.data : [];
  const weekday = cycle.scheduleType === "day_of_week";

  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-y-auto`}>
      <header className="flex items-center px-4 pt-4 shrink-0">
        <BackLink fallback={{ href: `/seasons/${seasonId}`, label: "Season" }} />
      </header>
      <div className="flex flex-col gap-4 px-4 pt-2 pb-40">
        <div className="flex flex-col gap-2">
          <h1 className="home-display text-[34px] leading-9 uppercase break-words">{weekday ? "Build the week" : "Rotation order"}</h1>
          <StepProgress step={2} of={2} />
          <span className="text-sm text-foreground/75">
            {cycle.name}
            {endurance && cycle.phaseType ? ` · ${PHASE_TYPE_LABELS[cycle.phaseType]}` : ""}
          </span>
        </div>
        <CycleScheduleBuilder cycle={cycle} programs={programs} endurance={endurance} />
      </div>
      <AddPhaseFinish seasonId={seasonId} />
    </div>
  );
}
