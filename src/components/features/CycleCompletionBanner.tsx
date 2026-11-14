"use client";

/**
 * CycleCompletionBanner
 *
 * The completed state of the cycle detail (docs/design/plan-redesign/J3_CycleDone.dc.html):
 * "Cycle complete", the user's end message, and what comes next. A scheduled
 * next cycle can start now, unless it starts tomorrow anyway or another cycle
 * is running (a start would end it, so the card only links on); with nothing
 * next, the end action can lead to a new cycle. "Not now" hides the card.
 */

import { startTrainingCycle } from "@/lib/actions/training-cycles";
import type { RunningCycle } from "@/lib/utils/cycle-start";
import { keepDates } from "@/lib/utils/keep-dates";
import { callAction } from "@/lib/utils/stale-bundle";
import type { TrainingCycle } from "@/types/workout";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type NextCycle = { id: number; name: string; startsLabel: string; startsTomorrow: boolean };

const primary = "flex h-[52px] items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground active:opacity-80 disabled:opacity-50";

export function CycleCompletionBanner({
  cycle,
  lengthLabel,
  endedLabel,
  next,
  running = null,
}: {
  cycle: TrainingCycle;
  lengthLabel: string;
  endedLabel: string;
  next: NextCycle | null;
  /** Another cycle that is running: then the card offers no start. */
  running?: RunningCycle | null;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (dismissed) return null;

  async function startNext() {
    if (!next) return;
    setLoading(true);
    setError(null);
    const result = await callAction(startTrainingCycle(next.id));
    setLoading(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.push(`/cycles/${next.id}`);
  }

  const newCycle = !next && (cycle.endAction === "new_cycle" || cycle.endAction === "deload");
  const canStartNext = next != null && !next.startsTomorrow && running == null;

  return (
    <div className="flex flex-col gap-3.5 rounded-[20px] bg-widget p-[18px]" data-testid="cycle-complete">
      <div className="flex items-center gap-2.5">
        <Check className="w-[22px] h-[22px] text-brand" strokeWidth={2.5} aria-hidden />
        <span className="text-xl font-semibold">Cycle complete</span>
      </div>
      <span className="text-sm text-muted-foreground">{keepDates(`${lengthLabel} · ${endedLabel}`)}</span>
      {cycle.endMessage && <p className="text-sm italic text-foreground/80">&ldquo;{cycle.endMessage}&rdquo;</p>}
      {next && (
        <>
          <div className="h-px bg-hairline" />
          <Link href={`/cycles/${next.id}`} className="flex flex-col gap-0.5 active:opacity-70">
            <span className="text-xs font-semibold tracking-[1px] uppercase text-muted-foreground">Next</span>
            <span className="text-base font-medium">
              {/* The chevron stays with the last word, never on a line of its own. */}
              {next.name} starts {keepDates(next.startsLabel)}
              {"\u00a0"}
              <span className="text-brand">›</span>
            </span>
          </Link>
          {canStartNext && (
            <button type="button" onClick={startNext} disabled={loading} className={primary}>
              {loading ? "Starting…" : "Start now instead"}
            </button>
          )}
        </>
      )}
      {newCycle && (
        <Link href="/cycles/new" className={primary}>
          {cycle.endAction === "deload" ? "Start a deload week" : "Start a new cycle"}
        </Link>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {(next ? canStartNext : newCycle) && (
        <button type="button" onClick={() => setDismissed(true)} className="min-h-11 text-[15px] font-medium text-foreground/80 active:opacity-70">
          Not now
        </button>
      )}
    </div>
  );
}
