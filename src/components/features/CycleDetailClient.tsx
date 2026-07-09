"use client";

/**
 * CycleDetailClient
 *
 * Client-side actions for the cycle detail page:
 * - Start cycle button
 * - Delete cycle
 */

import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  deleteTrainingCycle,
  restartTrainingCycle,
  startTrainingCycle,
} from "@/lib/actions/training-cycles";
import type { TrainingCycle } from "@/types/workout";
import { PlayIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartCycleButton({ cycle }: { cycle: TrainingCycle }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleStart() {
    setLoading(true);
    const result = await startTrainingCycle(cycle.id);
    setLoading(false);
    if (result.success) {
      router.refresh();
    }
  }

  if (cycle.status !== "draft") return null;

  return (
    <button
      onClick={handleStart}
      disabled={loading}
      className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:scale-95 transition-transform"
    >
      <PlayIcon className="w-4 h-4" />
      {loading ? "Starting…" : "Start Cycle"}
    </button>
  );
}

export function RestartCycleButton({ cycle }: { cycle: TrainingCycle }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  if (cycle.status === "draft") return null;

  async function handleRestart() {
    setLoading(true);
    const result = await restartTrainingCycle(cycle.id);
    setLoading(false);
    if (result.success) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-3 text-sm text-primary active:opacity-70"
      >
        <RotateCcwIcon className="w-4 h-4" />
        Restart cycle
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)}>
        <div className="w-full px-4 pb-8 space-y-4">
          <div className="bg-card rounded-2xl overflow-hidden text-center">
            <div className="px-4 pt-5 pb-2 border-b border-border">
              <p className="font-semibold text-base">Restart this cycle?</p>
              <p className="text-sm text-muted-foreground mt-1">
                The cycle will restart from today (Week 1).
                {cycle.status === "completed" && " It will become active again."}
              </p>
            </div>
            {cycle.scheduleType === "rotation" && (
              <div className="px-4 py-3 border-b border-border">
                <p className="text-xs text-muted-foreground">
                  Rotation position is based on your total completed sessions — it won&apos;t reset when the cycle restarts.
                </p>
              </div>
            )}
            <button
              onClick={handleRestart}
              disabled={loading}
              className="w-full py-4 text-base font-semibold text-primary active:bg-muted/50 transition-colors border-b border-border disabled:opacity-50"
            >
              {loading ? "Restarting…" : "Yes, restart"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="w-full py-4 text-base font-medium text-muted-foreground active:bg-muted/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}

export function DeleteCycleButton({ cycleId }: { cycleId: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    await deleteTrainingCycle(cycleId);
    router.push("/cycles");
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-4">
        <span className="text-sm text-destructive font-medium">Delete this cycle?</span>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-sm text-muted-foreground min-h-[44px] px-1"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={loading}
          className="text-sm text-destructive font-semibold min-h-[44px] px-1 disabled:opacity-50"
        >
          {loading ? "Deleting…" : "Delete"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="flex items-center gap-2 px-4 py-3 text-sm text-destructive active:opacity-70"
    >
      <Trash2Icon className="w-4 h-4" />
      Delete cycle
    </button>
  );
}
