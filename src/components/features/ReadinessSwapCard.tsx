"use client";

/**
 * The readiness swap on the home screen (docs/plans/limits-strength-readiness.md,
 * section 5; decision D4): on a low-readiness morning, one tap makes today's
 * hard session easy. Rendered only with the endurance switch on and a
 * suggestion from the server; the server reads the suggestion again on the
 * tap. No dismiss button (hub decision 12): the card goes when the session
 * is done or the day ends.
 */

import { makeSessionEasy } from "@/lib/actions/readiness";
import { callAction } from "@/lib/utils/stale-bundle";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type ReadinessSwapView = { sessionId: number; label: string; minutes: number; text: string };

export function ReadinessSwapCard({ swap }: { swap: ReadinessSwapView }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (pending) return;
    setPending(true);
    setError(null);
    const r = await callAction(makeSessionEasy({ plannedSessionId: swap.sessionId }));
    setPending(false);
    if (!r.success) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 shrink-0" data-testid="readiness-swap">
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-1">Low readiness</p>
      <p className="text-sm">{swap.text}</p>
      <button
        type="button"
        onClick={apply}
        disabled={pending}
        className="mt-2 inline-flex min-h-[44px] items-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Make it easy"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
