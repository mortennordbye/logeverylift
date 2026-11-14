/**
 * New Cycle Page
 *
 * Two steps (docs/plans/plan-tab-redesign.md, P3): step 1 the basics (name,
 * schedule type, length, start, end), which makes a draft; step 2 the
 * sessions, built on that draft (`?cycle=<id>`), whose last button starts it
 * or schedules it for the chosen day (`start`). `step=1` with a cycle goes
 * back to step 1 to change the draft.
 */

import { db } from "@/db";
import { programExercises } from "@/db/schema";
import { CreateCycleForm, CycleSetupSessions } from "@/components/features/CreateCycleForm";
import { HOME_UI } from "@/components/features/home/fonts";
import { PlanItemDeleted } from "@/components/features/PlanItemDeleted";
import { getActiveCycleForUser, getTrainingCycleWithSlots } from "@/lib/actions/training-cycles";
import { cycleStartContext } from "@/lib/cycle-start";
import { getPrograms } from "@/lib/actions/programs";
import { enduranceEnabledFor } from "@/lib/endurance";
import { MAX_SCHEDULE_DAYS } from "@/lib/mcp/tools/cycles";
import { ownDeletedCycle } from "@/lib/plan-deleted";
import { userToday } from "@/lib/user-settings";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { nextMonday, type StartDays } from "@/lib/utils/cycle-setup";
import { requireSession } from "@/lib/utils/session";
import { and, count, inArray, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function NewCyclePage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string; start?: string; step?: string }>;
}) {
  const auth = await requireSession();
  const params = await searchParams;
  // Like home: a block whose day has come starts, and one that is over completes, first.
  const active = await getActiveCycleForUser();
  const todayDate = await userToday(auth.user.id);
  const today = toDateStr(todayDate);
  const days: StartDays = {
    today,
    nextMonday: nextMonday(today),
    afterCurrent: active.success && active.data ? active.data.endDate : null,
    latest: toDateStr(addDays(todayDate, MAX_SCHEDULE_DAYS)),
  };
  const start = params.start && DAY.test(params.start) ? params.start : today;
  // Only one cycle is scheduled at a time (scheduleCycle): step 1 says what the start drops.
  const scheduled = async () => (await cycleStartContext(auth.user.id, today)).scheduled;

  if (!params.cycle) {
    return (
      <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-y-auto`}>
        <CreateCycleForm days={days} scheduled={await scheduled()} />
      </div>
    );
  }

  const cycleId = Number(params.cycle);
  if (!Number.isInteger(cycleId) || cycleId <= 0) notFound();
  const cycleResult = await getTrainingCycleWithSlots(cycleId);
  // Discard deletes the draft and renders this page again in its response.
  if (!cycleResult.success && (await ownDeletedCycle(auth.user.id, cycleId))) return <PlanItemDeleted what="cycle" />;
  if (!cycleResult.success) notFound();
  const cycle = cycleResult.data;
  // The setup is for a draft; a started or scheduled cycle lives on its own page.
  if (cycle.status !== "draft" || cycle.scheduledStartDate) redirect(`/cycles/${cycle.id}`);

  if (params.step === "1") {
    return (
      <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-y-auto`}>
        <CreateCycleForm days={days} draft={cycle} start={start} scheduled={await scheduled()} />
      </div>
    );
  }

  const [programsResult, endurance] = await Promise.all([getPrograms(), enduranceEnabledFor(auth.user.id)]);
  const programs = programsResult.success ? programsResult.data : [];
  // "6 exercises" under each program in the picker.
  const counts = programs.length
    ? await db
        .select({ programId: programExercises.programId, n: count() })
        .from(programExercises)
        .where(and(inArray(programExercises.programId, programs.map((p) => p.id)), isNull(programExercises.deletedAt)))
        .groupBy(programExercises.programId)
    : [];
  const countOf = new Map(counts.map((c) => [c.programId, c.n]));

  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-y-auto`}>
      <CycleSetupSessions
        cycle={cycle}
        programs={programs.map((p) => ({ ...p, exerciseCount: countOf.get(p.id) ?? 0 }))}
        start={start}
        endurance={endurance}
      />
    </div>
  );
}
