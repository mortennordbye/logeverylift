/**
 * Add a phase, step 2 of 2 (J4_WeekBuilder): the week of the phase made in
 * step 1, built with the schedule builder, and a pinned "Add phase" that goes
 * back to the season. The phase already exists; each slot saves as it is set.
 */

import { AddPhaseCancel, AddPhaseFinish } from "@/components/features/AddPhaseForm";
import { CycleScheduleBuilder } from "@/components/features/CycleScheduleBuilder";
import { HOME_UI } from "@/components/features/home/fonts";
import { FormHeader, StepProgress } from "@/components/features/season-ui";
import { getPrograms } from "@/lib/actions/programs";
import { getTrainingCycleWithSlots } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { PHASE_TYPE_LABELS } from "@/lib/utils/seasons";
import { db } from "@/db";
import { trainingCycles } from "@/db/schema";
import { requireSession } from "@/lib/utils/session";
import { and, eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function AddPhaseWeekPage({ params }: { params: Promise<{ id: string; cycleId: string }> }) {
  const { id, cycleId: rawCycleId } = await params;
  const seasonId = Number(id);
  const cycleId = Number(rawCycleId);
  if (!Number.isInteger(seasonId) || !Number.isInteger(cycleId)) notFound();

  const auth = await requireSession();
  const [cycleResult, programsResult, endurance] = await Promise.all([getTrainingCycleWithSlots(cycleId), getPrograms(), enduranceEnabledFor(auth.user.id)]);
  if (!cycleResult.success && (await removedPhase(auth.user.id, seasonId, cycleId))) {
    // Cancel removed this phase. The delete's revalidatePath renders this
    // page again in the action response while the client goes back to the
    // season; a notFound() here reached React as an uncaught error 441.
    return (
      <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col gap-4 px-4 pt-4`}>
        <p className="text-base text-foreground/75">This phase was removed.</p>
        <Link href={`/seasons/${seasonId}`} className="flex min-h-11 items-center text-base text-primary active:opacity-70">
          Back to the season
        </Link>
      </div>
    );
  }
  // The cycle read checks the owner; it must also be a phase of this season.
  if (!cycleResult.success || cycleResult.data.seasonId !== seasonId) notFound();
  const cycle = cycleResult.data;
  const programs = programsResult.success ? programsResult.data : [];
  const weekday = cycle.scheduleType === "day_of_week";

  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-y-auto`}>
      {/* The same header as New cycle step 2: Cancel left as on step 1, the title centred, Back. */}
      <FormHeader
        title="Add a phase"
        left={<AddPhaseCancel seasonId={seasonId} cycleId={cycleId} name={cycle.name} />}
        right={
          <Link replace href={`/seasons/${seasonId}`} className="flex items-center min-h-11 px-2 text-base text-brand active:opacity-70">
            Back
          </Link>
        }
      />
      <div className="flex flex-col gap-[18px] px-4 pt-3 pb-40">
        <StepProgress step={2} of={2} />
        <div className="flex flex-col gap-1">
          <h2 className="text-[22px] font-semibold">{weekday ? "Build the week" : "Rotation order"}</h2>
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

/** A deleted cycle of this user that was a phase of this season. */
async function removedPhase(userId: string, seasonId: number, cycleId: number): Promise<boolean> {
  const [row] = await db
    // plan-read: includes deleted (only a deleted phase of this season matches)
    .select({ id: trainingCycles.id })
    .from(trainingCycles)
    .where(and(eq(trainingCycles.id, cycleId), eq(trainingCycles.userId, userId), eq(trainingCycles.seasonId, seasonId), isNotNull(trainingCycles.deletedAt)));
  return row != null;
}
