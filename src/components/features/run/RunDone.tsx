"use client";

/**
 * The run exercise after its run (docs/plans/run-logger.md, section 5 "Run
 * done / Run ended early"): when it ended, the steps that are saved, and for
 * a run ended early the reason chips (R15). Pain links to the injury log.
 * The exercise shows this, not Start run, as the bike shows its summary; the
 * results table and the summary come with step 4.
 */

import { BackLink } from "@/components/ui/BackLink";
import type { EndReason } from "@/db/schema/rides";
import { setRideEndReason } from "@/lib/actions/rides";
import type { RunDoneData } from "@/lib/run-exercise-view";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { useState } from "react";

const REASONS: { value: EndReason; label: string }[] = [
  { value: "tired", label: "Tired" },
  { value: "pain", label: "Pain" },
  { value: "time", label: "Time" },
  { value: "other", label: "Other" },
];

/** Where an injury is logged: Injuries and limits on Account. */
export const INJURY_HREF = "/more/account/injuries";

export function RunDone({ programId, exerciseName, data, doneHref }: { programId: number; exerciseName: string; data: RunDoneData; doneHref: string }) {
  const [reason, setReason] = useState<EndReason | null>(data.endReason);
  const [error, setError] = useState<string | null>(null);
  const early = data.status === "ended_early";

  async function pick(r: EndReason) {
    const next = reason === r ? null : r;
    const before = reason;
    setReason(next);
    setError(null);
    const res = await callAction(setRideEndReason({ rideId: data.rideId, reason: next }));
    if (!res.success) {
      setReason(before);
      setError(res.error);
    }
  }

  return (
    <div className="h-[100dvh] pb-nav-safe bg-background flex flex-col overflow-hidden" data-testid="run-done">
      <div className="flex items-center px-4 pt-6 pb-2 shrink-0">
        <BackLink fallback={{ href: `/programs/${programId}/workout`, label: "Workout" }} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{exerciseName}</p>
          <h1 className="text-3xl font-bold tracking-tight">{early ? "Run ended early" : "Run done"}</h1>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums" data-testid="run-done-line">
            {data.doneLine}
          </p>
        </div>
        <p className="rounded-xl bg-muted px-4 py-3 text-sm" data-testid="run-kept">
          {data.kept}
        </p>
        {early && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">Why did the run end early</p>
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Why the run ended early" data-testid="run-end-reason">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={reason === r.value}
                  onClick={() => void pick(r.value)}
                  className={`min-h-11 rounded-lg text-sm font-semibold active:opacity-70 ${reason === r.value ? "bg-background text-foreground" : "text-muted-foreground"}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {reason === "pain" && (
              <Link href={INJURY_HREF} className="flex items-center justify-between rounded-xl bg-muted pl-4 pr-2 min-h-12 text-sm" data-testid="log-injury">
                <span className="text-muted-foreground">Pain during the run</span>
                <span className="min-h-11 px-3 inline-flex items-center font-semibold text-primary">Log an injury</span>
              </Link>
            )}
            {error && (
              <p role="alert" className="text-sm text-muted-foreground">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
      <div data-pinned-bar className="shrink-0 px-4 pt-2 pb-3 border-t border-border bg-background">
        <Link href={doneHref} className="min-h-12 w-full rounded-2xl bg-brand-fill px-4 text-base font-semibold text-white inline-flex items-center justify-center active:opacity-80">
          Done
        </Link>
      </div>
    </div>
  );
}
