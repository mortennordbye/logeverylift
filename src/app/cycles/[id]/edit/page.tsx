import { EditCycleForm } from "@/components/features/EditCycleForm";
import { getTrainingCycleWithSlots } from "@/lib/actions/training-cycles";
import { requireSession } from "@/lib/utils/session";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function EditCyclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const cycleId = Number(id);
  if (isNaN(cycleId)) notFound();

  await requireSession();
  const cycleResult = await getTrainingCycleWithSlots(cycleId);

  if (!cycleResult.success) notFound();

  const cycle = cycleResult.data;

  return (
    <div className="h-[100dvh] bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-6 pb-2 shrink-0">
        <Link
          href={`/cycles/${cycleId}`}
          className="flex items-center gap-0.5 text-primary active:opacity-70 -ml-1 min-h-[44px]"
        >
          <ChevronLeftIcon className="w-5 h-5" />
          <span className="text-sm font-medium">Back</span>
        </Link>
      </div>
      <div className="px-4 pt-2 pb-4 shrink-0">
        <h1 className="text-3xl font-bold tracking-tight">Edit Cycle</h1>
      </div>

      {/* Scrollable content — flex-1 so it fills remaining height, overflow-y-auto does the actual scrolling */}
      <div className="flex-1 overflow-y-auto px-4 pb-nav-safe">
        <EditCycleForm cycle={cycle} />
      </div>
    </div>
  );
}
