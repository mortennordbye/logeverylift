"use client";

/**
 * CycleCompletionBanner
 *
 * Shown on the cycle detail page when a cycle is completed.
 * Displays the user's end message and a CTA based on endAction.
 */

import type { TrainingCycle } from "@/types/workout";
import Link from "next/link";
import { useState } from "react";

const END_ACTION_LABELS: Record<TrainingCycle["endAction"], string> = {
  deload: "Start Deload Week",
  new_cycle: "Start New Cycle",
  rest: "Take a Rest Period",
  none: "Dismiss",
};

export function CycleCompletionBanner({ cycle }: { cycle: TrainingCycle }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const ctaLabel = END_ACTION_LABELS[cycle.endAction];

  return (
    <div className="rounded-2xl bg-green-500/10 border border-green-500/20 p-4 flex flex-col gap-3">
      <div>
        <p className="font-bold text-base">Cycle Complete!</p>
        {cycle.endMessage && (
          <p className="text-sm text-muted-foreground mt-1 italic">
            &ldquo;{cycle.endMessage}&rdquo;
          </p>
        )}
      </div>

      <div className="flex gap-2">
        {cycle.endAction === "new_cycle" || cycle.endAction === "deload" ? (
          <Link
            href="/cycles/new"
            className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground text-center active:opacity-80"
          >
            {ctaLabel}
          </Link>
        ) : (
          <button
            onClick={() => setDismissed(true)}
            className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground active:opacity-80"
          >
            {ctaLabel}
          </button>
        )}

        {(cycle.endAction === "new_cycle" || cycle.endAction === "deload") && (
          <button
            onClick={() => setDismissed(true)}
            className="px-4 rounded-xl bg-muted text-sm font-medium text-muted-foreground active:opacity-80"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
