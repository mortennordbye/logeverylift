import { EditCycleForm } from "@/components/features/EditCycleForm";
import { getTrainingCycleWithSlots } from "@/lib/actions/training-cycles";
import { enduranceEnabledFor } from "@/lib/endurance";
import { db } from "@/db";
import { liveSeasonId } from "@/lib/plan-revisions";
import { userToday } from "@/lib/user-settings";
import { toDateStr } from "@/lib/utils/cycle-position";
import { requireSession } from "@/lib/utils/session";

import { notFound } from "next/navigation";
import { BackLink } from "@/components/ui/BackLink";

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
    <div className="h-[100dvh] bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: `/cycles/${cycleId}`, label: "Cycle" }} />
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Edit Cycle</h1>
      </div>

      {/* Scrollable content — flex-1 so it fills remaining height, overflow-y-auto does the actual scrolling */}
      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe">
        <EditCycleForm cycle={cycle} enduranceEnabled={enduranceEnabled} liveSeasonId={await liveSeasonId(db, cycle.seasonId)} today={toDateStr(today)} />
      </div>
    </div>
  );
}
