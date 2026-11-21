"use client";

/**
 * Why a run ended early (docs/plans/run-logger.md, R15, section 5 "Run ended
 * early"): the steps that are saved and the reason chips. A second tap on a
 * chip clears it. Pain links to the injury log. The run summary shows it on a
 * run that ended early.
 */

import type { EndReason } from "@/db/schema/rides";
import { setRideEndReason } from "@/lib/actions/rides";
import { callAction } from "@/lib/utils/stale-bundle";
import Link from "next/link";
import { useState } from "react";

const REASONS: { value: EndReason; label: string }[] = [
  { value: "tired", label: "Tired" },
  { value: "pain", label: "Pain" },
  { value: "time", label: "Time" },
  { value: "other", label: "Other" },
];

/** Where an injury is logged: Injuries and limits, on Account's Body and health page. */
export const INJURY_HREF = "/more/account/body-and-health";

export function RunEndReason({ rideId, kept, endReason }: { rideId: number; kept: string; endReason: EndReason | null }) {
  const [reason, setReason] = useState<EndReason | null>(endReason);
  const [error, setError] = useState<string | null>(null);

  async function pick(r: EndReason) {
    const next = reason === r ? null : r;
    const before = reason;
    setReason(next);
    setError(null);
    const res = await callAction(setRideEndReason({ rideId, reason: next }));
    if (!res.success) {
      setReason(before);
      setError(res.error);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="rounded-xl bg-muted px-4 py-3 text-sm" data-testid="run-kept">
        {kept}
      </p>
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
  );
}
