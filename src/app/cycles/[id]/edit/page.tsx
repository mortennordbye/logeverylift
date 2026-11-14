import { EditCycleForm } from "@/components/features/EditCycleForm";
import { HOME_UI } from "@/components/features/home/fonts";
import { getTrainingCycleWithSlots } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { db } from "@/db";
import { liveSeasonId } from "@/lib/plan-revisions";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { requireSession } from "@/lib/utils/session";

import { notFound } from "next/navigation";

/** Edit details of a cycle; the form draws its own header and pinned Save bar. */
export default async function EditCyclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cycleId = Number(id);
  if (isNaN(cycleId)) notFound();

  const session = await requireSession();
  const [cycleResult, enduranceEnabled, today] = await Promise.all([
    getTrainingCycleWithSlots(cycleId),
    enduranceEnabledFor(session.user.id),
    userToday(session.user.id),
  ]);

  if (!cycleResult.success) notFound();

  const cycle = cycleResult.data;

  return (
    <div className={`${HOME_UI} h-[100dvh] bg-home flex flex-col overflow-y-auto`}>
      <EditCycleForm cycle={cycle} enduranceEnabled={enduranceEnabled} liveSeasonId={await liveSeasonId(db, cycle.seasonId)} today={toDateStr(today)} />
    </div>
  );
}
