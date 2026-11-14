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
import { programExercises, trainingCycles } from "@/db/schema";
import { CreateCycleForm, CycleSetupSessions } from "@/components/features/CreateCycleForm";
import { HOME_UI } from "@/components/features/home/fonts";
import { getActiveCycleForUser, getTrainingCycleWithSlots } from "@/lib/actions/training-cycles";
import { getPrograms } from "@/lib/actions/programs";
import { enduranceEnabledFor } from "@/lib/endurance";
import { MAX_SCHEDULE_DAYS } from "@/lib/mcp/tools/cycles";
import { userToday } from "@/lib/user-settings";
import { addDays, toDateStr } from "@/lib/utils/cycle-position";
import { nextMonday, type StartDays } from "@/lib/utils/cycle-setup";
import { requireSession } from "@/lib/utils/session";
import { and, asc, count, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The other cycle set to start on a later day, if any. Only one can be
 * (scheduleCycle), so a later start for this draft replaces it; step 1 says so.
 */
async function otherScheduled(userId: string, draftId: number | null) {
  const [row] = await db
    .select({ name: trainingCycles.name, day: trainingCycles.scheduledStartDate })
    .from(trainingCycles)
    .where(
      and(
        eq(trainingCycles.userId, userId),
        isNotNull(trainingCycles.scheduledStartDate),
        isNull(trainingCycles.deletedAt),
        draftId ? ne(trainingCycles.id, draftId) : undefined,
      ),
    )
    .orderBy(asc(trainingCycles.scheduledStartDate))
    .limit(1);
  return row?.day ? { name: row.name, day: row.day } : null;
}

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

  if (!params.cycle) {
    return (
      <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-y-auto`}>
        <CreateCycleForm days={days} scheduled={await otherScheduled(auth.user.id, null)} />
      </div>
    );
  }

  const cycleId = Number(params.cycle);
  if (!Number.isInteger(cycleId) || cycleId <= 0) notFound();
  const cycleResult = await getTrainingCycleWithSlots(cycleId);
  if (!cycleResult.success) notFound();
  const cycle = cycleResult.data;
  // The setup is for a draft; a started or scheduled cycle lives on its own page.
  if (cycle.status !== "draft" || cycle.scheduledStartDate) redirect(`/cycles/${cycle.id}`);

  if (params.step === "1") {
    return (
      <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-y-auto`}>
        <CreateCycleForm days={days} draft={cycle} start={start} scheduled={await otherScheduled(auth.user.id, cycle.id)} />
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
