"use client";

import type { ThresholdKind } from "@/db/schema/athlete-profile";
import { acceptThresholdProposal, declineThresholdProposal } from "@/lib/actions/athlete-profile";
import { formatDateShort } from "@/lib/utils/format";
import { callAction } from "@/lib/utils/stale-bundle";
import { THRESHOLD_LABEL, formatThreshold, sameThresholdValue } from "@/lib/utils/thresholds";
import type { Units } from "@/lib/utils/units";
import type { ActionResult } from "@/types/workout";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type ProposalView = { id: number; kind: ThresholdKind; value: number; reason: string; proposedOn: string };

/**
 * One coach proposal with Decline and Accept (docs/plans/strict-targets.md,
 * decision 5; the card in docs/design/strict-targets/plan.html, section 4).
 * The current value shows struck through before the new one.
 */
export function ProposalCard({ proposal, current, units }: { proposal: ProposalView; current: number | null; units: Units }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { kind, value } = proposal;
  const showOld = current !== null && !sameThresholdValue(kind, current, value);

  async function answer(accept: boolean) {
    setBusy(true);
    setError(null);
    const r = await callAction<ActionResult<unknown>>(accept ? acceptThresholdProposal({ id: proposal.id }) : declineThresholdProposal({ id: proposal.id }));
    setBusy(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-2xl bg-card p-3 flex flex-col gap-1.5" data-testid={`proposal-${kind}`}>
      <p className="text-xs text-muted-foreground">Coach proposes · {formatDateShort(proposal.proposedOn)}</p>
      <p className="text-[17px] font-semibold">
        {showOld && (
          <>
            <s className="font-normal text-muted-foreground">{formatThreshold(kind, current, units)}</s> →{" "}
          </>
        )}
        {formatThreshold(kind, value, units)} {THRESHOLD_LABEL[kind]}
      </p>
      <p className="text-xs text-muted-foreground">{proposal.reason}</p>
      <div className="flex gap-2 mt-1">
        <button
          onClick={() => answer(false)}
          disabled={busy}
          className="flex-1 min-h-[44px] rounded-xl bg-muted text-sm font-semibold active:opacity-60 disabled:opacity-50"
        >
          Decline
        </button>
        <button
          onClick={() => answer(true)}
          disabled={busy}
          className="flex-1 min-h-[44px] rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:opacity-80 disabled:opacity-50"
        >
          Accept
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** A dot that says something waits for the user, next to a row label. */
export function OpenDot({ label }: { label: string }) {
  return <span role="img" aria-label={label} className="h-2 w-2 rounded-full bg-primary shrink-0" data-testid="open-dot" />;
}
